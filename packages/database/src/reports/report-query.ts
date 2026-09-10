import {
  reportFiltersSchema,
  reportRowSchema,
  reportCursorSchema,
  warehouseCodeSchema,
  warehouseCodes,
} from '@glorychips/contracts';
import type { ReportFilters, ReportRow, WarehouseCode } from '@glorychips/contracts';
import { Prisma } from '../generated/prisma/client.js';
import type { SessionPrincipal } from '../auth/types.js';
import { AuthDomainError } from '../auth/errors.js';
import { hashCommand } from '../inventory/stable-json.js';

export function reportWarehouses(principal: SessionPrincipal, warehouse?: WarehouseCode) {
  const allowed = principal.roles.includes('SYSTEM_ADMIN')
    ? [...warehouseCodes]
    : principal.roles.includes('WAREHOUSE_ADMIN')
      ? principal.warehouses
      : [];
  if (!allowed.length) throw new AuthDomainError('FORBIDDEN_ROLE', '需要管理员权限。');
  if (warehouse && !allowed.includes(warehouse))
    throw new AuthDomainError('FORBIDDEN_WAREHOUSE', '仓库不在授权范围内。');
  return warehouse ? [warehouse] : [...allowed];
}

export const reportItemsWhere = (filters: ReportFilters): Prisma.RequestItemWhereInput => ({
  ...(filters.productId ? { productId: filters.productId } : {}),
  ...(filters.size ? { sizeSnapshot: filters.size } : {}),
  ...(filters.category ? { product: { category: { code: filters.category } } } : {}),
});
export const reportInclude = {
  warehouse: true,
  claimant: true,
  items: { orderBy: { id: 'asc' as const } },
  fulfillment: { include: { executor: true } },
  approvals: {
    take: 1,
    orderBy: [{ reviewedAt: 'desc' as const }, { id: 'desc' as const }],
    include: { reviewer: true },
  },
  returnObligations: true,
} satisfies Prisma.RequestInclude;
export type ReportRecord = Prisma.RequestGetPayload<{ include: typeof reportInclude }>;

export function reportProjection(record: ReportRecord): ReportRow {
  const matched = new Set(record.items.map((i) => i.variantId));
  const obligations = record.returnObligations.filter((o) => matched.has(o.variantId));
  const approval = record.approvals[0];
  const fulfillment = record.fulfillment?.status === 'COMPLETED' ? record.fulfillment : null;
  return reportRowSchema.parse({
    id: record.id,
    requestNumber: record.requestNumber,
    warehouse: warehouseCodeSchema.parse(record.warehouse.code),
    warehouseName: record.warehouse.name,
    claimantId: record.claimantId,
    claimantName: record.claimant.name,
    origin: record.origin,
    type: record.type,
    purposeObject: record.purposeObject,
    finalDestination: record.finalDestination,
    notes: record.notes,
    submittedAt: (record.submittedAt ?? record.createdAt).toISOString(),
    fulfilledAt: fulfillment?.fulfilledAt.toISOString() ?? null,
    status: record.status,
    syncStatus: record.syncStatus,
    matchedItemCount: record.items.length,
    matchedQuantity: record.items.reduce((n, i) => n + i.quantity, 0),
    returnedQuantity: obligations.reduce((n, o) => n + o.returnedQuantity, 0),
    pendingReturnQuantity: obligations.reduce(
      (n, o) =>
        n +
        (['PENDING', 'PARTIAL'].includes(o.status)
          ? Math.max(0, o.requiredQuantity - o.returnedQuantity)
          : 0),
      0,
    ),
    reviewerName: approval?.reviewer.name ?? null,
    reviewedAt: approval?.reviewedAt.toISOString() ?? null,
    reviewDecision: approval?.decision ?? null,
    executorName: fulfillment?.executor.name ?? null,
    returnMode: record.returnMode,
    expectedReturnDate: record.expectedReturnDate?.toISOString().slice(0, 10) ?? null,
  });
}

export function reportDateBoundary(day: string, nextDay = false): Date {
  const start = new Date(`${day}T00:00:00+08:00`);
  return new Date(start.getTime() + (nextDay ? 86_400_000 : 0));
}
export const reportHash = (filters: ReportFilters, warehouses: readonly string[]) =>
  hashCommand({ filters: reportFiltersSchema.parse(filters), warehouses: [...warehouses].sort() });
export function decodeReportCursor(cursor: string, hash: string) {
  try {
    const parsed = reportCursorSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    if (parsed.hash !== hash) throw new Error('filter changed');
    return parsed;
  } catch {
    throw new AuthDomainError('VALIDATION_ERROR', '分页条件已变化，请重新查询。');
  }
}
export const encodeReportCursor = (id: string, date: Date, hash: string) =>
  Buffer.from(JSON.stringify({ id, date: date.toISOString(), hash })).toString('base64url');

export function reportSql(filters: ReportFilters, warehouses: readonly string[]) {
  const date =
    filters.dateMode === 'FULFILLED'
      ? Prisma.sql`f.fulfilled_at`
      : Prisma.sql`COALESCE(r.submitted_at, r.created_at)`;
  const itemConditions = [Prisma.sql`i.request_id = r.id`];
  if (filters.productId) itemConditions.push(Prisma.sql`i.product_id = ${filters.productId}::uuid`);
  if (filters.size) itemConditions.push(Prisma.sql`i.size_snapshot = ${filters.size}`);
  if (filters.category) itemConditions.push(Prisma.sql`c.code::text = ${filters.category}`);
  const conditions = [
    Prisma.sql`w.code::text IN (${Prisma.join(warehouses)})`,
    Prisma.sql`EXISTS (SELECT 1 FROM request_items i JOIN products p ON p.id = i.product_id
      JOIN product_categories c ON c.id = p.category_id WHERE ${Prisma.join(itemConditions, ' AND ')})`,
  ];
  if (filters.dateMode === 'FULFILLED') conditions.push(Prisma.sql`f.status::text = 'COMPLETED'`);
  if (filters.from) conditions.push(Prisma.sql`${date} >= ${reportDateBoundary(filters.from)}`);
  if (filters.to) conditions.push(Prisma.sql`${date} < ${reportDateBoundary(filters.to, true)}`);
  if (filters.claimantId) conditions.push(Prisma.sql`r.claimant_id = ${filters.claimantId}::uuid`);
  if (filters.type) conditions.push(Prisma.sql`r.type::text = ${filters.type}`);
  if (filters.origin) conditions.push(Prisma.sql`r.origin::text = ${filters.origin}`);
  if (filters.status) conditions.push(Prisma.sql`r.status::text = ${filters.status}`);
  if (filters.syncStatus) conditions.push(Prisma.sql`r.sync_status::text = ${filters.syncStatus}`);
  if (filters.finalDestination)
    conditions.push(
      Prisma.sql`strpos(lower(r.final_destination), lower(${filters.finalDestination})) > 0`,
    );
  return {
    date,
    from: Prisma.sql`FROM requests r JOIN warehouses w ON w.id = r.warehouse_id
      LEFT JOIN fulfillments f ON f.request_id = r.id`,
    where: Prisma.join(conditions, ' AND '),
    itemWhere: Prisma.join(itemConditions, ' AND '),
  };
}

export async function readReportPage(
  tx: Prisma.TransactionClient,
  filters: ReportFilters,
  warehouses: readonly string[],
  limit: number,
  cursor?: string,
) {
  const hash = reportHash(filters, warehouses);
  const after = cursor ? decodeReportCursor(cursor, hash) : null;
  const sql = reportSql(filters, warehouses);
  const seek = after
    ? Prisma.sql`AND (${sql.date}, r.id) < (${new Date(after.date)}, ${after.id}::uuid)`
    : Prisma.empty;
  const ids = await tx.$queryRaw<{ id: string; date: Date }[]>`
    SELECT r.id, ${sql.date} AS date ${sql.from} WHERE ${sql.where} ${seek}
    ORDER BY ${sql.date} DESC, r.id DESC LIMIT ${limit + 1}`;
  const selected = ids.slice(0, limit);
  const records = await tx.request.findMany({
    where: { id: { in: selected.map((r) => r.id) } },
    include: {
      ...reportInclude,
      items: { ...reportInclude.items, where: reportItemsWhere(filters) },
    },
  });
  const byId = new Map(records.map((r) => [r.id, r]));
  const items = selected.map((r) => {
    const record = byId.get(r.id);
    if (!record) throw new Error('Report snapshot lost a request.');
    return reportProjection(record);
  });
  const last = selected.at(-1);
  return {
    items,
    nextCursor: ids.length > limit && last ? encodeReportCursor(last.id, last.date, hash) : null,
  };
}
