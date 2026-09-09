import {
  reportQuerySchema,
  reportFiltersSchema,
  reportResponseSchema,
  reportCandidatesQuerySchema,
  reportCandidatesResponseSchema,
  reportMovementsResponseSchema,
  staffQuerySchema,
  staffResponseSchema,
  warehouseCodes,
} from '@glorychips/contracts';
import type { SessionPrincipal } from '../auth/types.js';
import { AuthDomainError } from '../auth/errors.js';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { RequestQueryService } from '../requests/request-query-service.js';
import { readReportPage, reportWarehouses } from './report-query.js';

export async function currentReportPrincipal(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<SessionPrincipal> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    include: {
      userRoles: { include: { role: true } },
      warehouseAdminScopes: { include: { warehouse: true } },
    },
  });
  if (!user || user.status !== 'ACTIVE') throw new AuthDomainError('USER_INACTIVE', '账号已停用。');
  return {
    userId,
    sessionId: '',
    feishuUserId: user.feishuUserId ?? '',
    name: user.name,
    avatarUrl: user.avatarUrl,
    roles: user.userRoles.map((r) => r.role.code),
    warehouses: user.warehouseAdminScopes.flatMap((s) =>
      warehouseCodes.filter((c) => c === s.warehouse.code && s.warehouse.isActive),
    ),
    expiresAt: new Date(0),
  };
}

export class ReportService {
  public constructor(private readonly database: PrismaClient) {}

  public async query(raw: unknown, actor: SessionPrincipal) {
    const query = reportQuerySchema.parse(raw);
    const { limit, cursor, ...rawFilters } = query;
    const filters = reportFiltersSchema.parse(rawFilters);
    const warehouses = reportWarehouses(actor, filters.warehouse);
    return this.database.$transaction(
      async (tx) =>
        reportResponseSchema.parse(await readReportPage(tx, filters, warehouses, limit, cursor)),
      { isolationLevel: 'RepeatableRead', timeout: 20_000 },
    );
  }

  public async claimants(raw: unknown, actor: SessionPrincipal) {
    const query = reportCandidatesQuerySchema.parse(raw);
    const warehouses = reportWarehouses(actor, query.warehouse);
    const rows = await this.database.user.findMany({
      where: {
        ...(query.cursor ? { id: { gt: query.cursor } } : {}),
        name: { contains: query.query, mode: 'insensitive' },
        requests: { some: { warehouse: { code: { in: warehouses } } } },
      },
      select: { id: true, name: true, status: true },
      orderBy: { id: 'asc' },
      take: query.limit + 1,
    });
    return reportCandidatesResponseSchema.parse({
      items: rows.slice(0, query.limit),
      nextCursor: rows.length > query.limit ? rows[query.limit - 1]?.id : null,
    });
  }

  public async movements(id: string, actor: SessionPrincipal, cursor?: string) {
    await new RequestQueryService(this.database).getVisibleDetail(id, actor);
    const rows = await this.database.inventoryMovement.findMany({
      where: { requestId: id, ...(cursor ? { id: { gt: cursor } } : {}) },
      include: { variant: { include: { product: true } } },
      orderBy: { id: 'asc' },
      take: 51,
    });
    return reportMovementsResponseSchema.parse({
      items: rows.slice(0, 50).map((r) => ({
        id: r.id,
        businessNumber: r.businessNumber,
        type: r.type,
        productName: r.productNameSnapshot ?? r.variant.product.officialName,
        size: r.variant.size,
        quantityDelta: r.quantityDelta,
        effectiveBefore: r.quantityBefore,
        effectiveAfter: r.quantityAfter,
        actorName: r.actorNameSnapshot,
        syncStatus: r.syncStatus,
        occurredAt: r.occurredAt.toISOString(),
      })),
      nextCursor: rows.length > 50 ? rows[49]?.id : null,
    });
  }

  public async staff(raw: unknown, actor: SessionPrincipal) {
    if (!actor.roles.includes('SYSTEM_ADMIN'))
      throw new AuthDomainError('FORBIDDEN_ROLE', '需要系统管理员权限。');
    const query = staffQuerySchema.parse(raw);
    const rows = await this.database.user.findMany({
      where: {
        lastLoginAt: { not: null },
        ...(query.cursor ? { id: { gt: query.cursor } } : {}),
        name: { contains: query.query, mode: 'insensitive' },
        ...(query.status ? { status: query.status } : {}),
        ...(query.role ? { userRoles: { some: { role: { code: query.role } } } } : {}),
      },
      include: {
        userRoles: { include: { role: true } },
        warehouseAdminScopes: { include: { warehouse: true } },
      },
      orderBy: { id: 'asc' },
      take: query.limit + 1,
    });
    return staffResponseSchema.parse({
      items: rows.slice(0, query.limit).map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        access: {
          roles: r.userRoles.map((role) => role.role.code),
          warehouses: r.userRoles.some((role) => role.role.code === 'SYSTEM_ADMIN')
            ? []
            : r.warehouseAdminScopes.map((s) => s.warehouse.code),
        },
      })),
      nextCursor: rows.length > query.limit ? rows[query.limit - 1]?.id : null,
    });
  }
}
