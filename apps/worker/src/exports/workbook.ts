import ExcelJS from 'exceljs';
import { Transform } from 'node:stream';
import { finished } from 'node:stream/promises';
import {
  Prisma,
  readReportPage,
  reportSql,
  assertExportAccess,
  ReportError,
  ExportService,
} from '@glorychips/database';
import type { DatabaseClient, RequestExport, ExportStorage } from '@glorychips/database';
import { reportFiltersSchema } from '@glorychips/contracts';
import type { ExportEnvironment } from '@glorychips/config';

export const workbookText = (value: unknown): string | number => {
  if (typeof value === 'number') return value;
  const text = value === null || value === undefined ? '' : String(value);
  if (
    text.length > 32_767 ||
    [...text].some((c) => c.charCodeAt(0) < 32 && ![9, 10, 13].includes(c.charCodeAt(0)))
  )
    throw new ReportError('EXPORT_INVALID_TEXT', '文本超过 Excel 限制或含非法控制字符。');
  return text;
};
const labels: Record<string, string> = {
  ONLINE: '正常领用',
  OFFLINE: '线下登记',
  EXPRESS: '临时领用',
  INTERNAL: '内部领用',
  GIFT: '赠送',
  SALE: '销售',
  EXHIBIT: '展品',
  SMART_RING: '智能指环',
  SMART_WATCH: '智能腕表',
  DRAFT: '草稿',
  PENDING_APPROVAL: '待审核',
  PENDING_RELEASE: '待发放',
  PENDING_PAPERWORK: '待补手续',
  COMPLETED: '已完成',
  REJECTED: '已退回',
  CANCELLED: '已取消',
  NOT_REQUIRED: '不适用',
  PENDING: '待同步',
  SYNCED: '已同步',
  FAILED: '失败',
  APPROVED: '通过',
  BY_DATE: '指定日期归还',
  ON_DEPARTURE: '离职归还',
};
const label = (v: string | null) => (v === null ? '' : (labels[v] ?? v));
const localTime = (v: string | Date | null) =>
  v === null
    ? ''
    : new Date(new Date(v).getTime() + 8 * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);
const summaryColumns = [
  '业务单号',
  '来源',
  '仓库',
  '领用人',
  '类型',
  '用途/对象',
  '最终去向',
  '备注',
  '提交日期时间',
  '实际发放日期时间',
  '整单流程状态',
  '整单同步状态',
  '筛选明细行数',
  '筛选明细数量',
  '命中明细已归还数量',
  '命中明细待归还数量',
  '最近审核人',
  '最近审核时间',
  '最近审核结论',
  '发放人',
  '归还方式',
  '预计归还日期',
];
const detailColumns = [
  '业务单号',
  '明细ID',
  '仓库',
  '领用人',
  '来源',
  '商品大类',
  '产品/款式',
  '尺码',
  '申请数量',
  '已发放数量',
  '已归还数量',
  '待归还数量',
  '明细同步状态',
  '提交日期时间',
  '实际发放日期时间',
  '整单流程状态',
];

export async function generateWorkbook(
  database: DatabaseClient,
  job: RequestExport,
  storage: ExportStorage,
  options: ExportEnvironment,
) {
  const service = new ExportService(database);
  const prefix = `${job.id}.${job.leaseToken}`;
  const partial = `${prefix}.partial`;
  const key = `${prefix}.xlsx`;
  const filters = reportFiltersSchema.parse(job.filters);
  let summaryCount = 0;
  let detailCount = 0;
  let snapshotAt = new Date();
  const output = await storage.writer(partial);
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(
        bytes > options.EXPORT_MAX_BYTES
          ? new ReportError('EXPORT_TOO_LARGE', '导出文件超过容量限制。')
          : null,
        chunk,
      );
    },
  });
  limiter.pipe(output);
  let streamError: Error | null = null;
  const stop = (e: Error) => {
    streamError ??= e;
    limiter.destroy(e);
    output.destroy(e);
  };
  limiter.on('error', (e) => {
    streamError ??= e;
    output.destroy(e);
  });
  output.on('error', (e) => {
    streamError ??= e;
    limiter.destroy(e);
  });
  const completion = Promise.all([finished(limiter), finished(output)]);
  void completion.catch(() => undefined);
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: limiter,
    useSharedStrings: false,
    useStyles: true,
    zip: { zlib: { level: 1 } },
  });
  const timer = setTimeout(
    () => stop(new ReportError('EXPORT_TIMEOUT', '导出生成超时，请缩小范围。')),
    options.EXPORT_TIMEOUT_MS,
  );
  let heartbeat: Promise<void> | undefined;
  const pulse = () => {
    heartbeat ??= service
      .heartbeat(job)
      .catch((error: unknown) => {
        stop(error instanceof Error ? error : new Error('Export heartbeat failed.'));
      })
      .finally(() => {
        heartbeat = undefined;
      });
    return heartbeat;
  };
  const heartbeatTimer = setInterval(() => {
    void pulse();
  }, 10_000);
  const check = async () => {
    if (streamError) throw streamError;
  };
  const sheet = (name: string, columns: string[]) => {
    const result = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 3 }] });
    result.columns = columns.map(() => ({ width: 22 }));
    result
      .addRow([
        '数据截至（上海时间）',
        localTime(snapshotAt),
        '日期口径',
        filters.dateMode === 'SUBMITTED' ? '提交日期' : '实际发放日期',
      ])
      .commit();
    result.addRow(['筛选条件', workbookText(JSON.stringify(filters))]).commit();
    const heading = result.addRow(columns);
    heading.font = { bold: true };
    heading.commit();
    result.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: columns.length } };
    return result;
  };
  try {
    await assertExportAccess(database, job);
    await database.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(options.EXPORT_TIMEOUT_MS)}, true)`;
        const started = await tx.$queryRaw<{ at: Date }[]>`SELECT transaction_timestamp() AS at`;
        snapshotAt = started[0]!.at;
        const sql = reportSql(filters, job.warehouses);
        const detailFrom = Prisma.sql`FROM request_items i JOIN requests r ON r.id = i.request_id
        JOIN warehouses w ON w.id = r.warehouse_id LEFT JOIN fulfillments f ON f.request_id = r.id
        JOIN products p ON p.id = i.product_id JOIN product_categories c ON c.id = p.category_id`;
        const count = await tx.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count ${detailFrom}
        WHERE ${sql.where} AND ${sql.itemWhere}`;
        if (Number(count[0]!.count) > options.EXPORT_MAX_ROWS)
          throw new ReportError('EXPORT_TOO_LARGE', '商品明细超过导出上限，请缩小范围。');
        const summary = sheet('领用单汇总', summaryColumns);
        let cursor: string | undefined;
        do {
          await check();
          const page = await readReportPage(tx, filters, job.warehouses, 500, cursor);
          for (const r of page.items) {
            summary
              .addRow(
                [
                  r.requestNumber,
                  label(r.origin),
                  r.warehouseName,
                  r.claimantName,
                  label(r.type),
                  r.purposeObject,
                  r.finalDestination,
                  r.notes,
                  localTime(r.submittedAt),
                  localTime(r.fulfilledAt),
                  label(r.status),
                  label(r.syncStatus),
                  r.matchedItemCount,
                  r.matchedQuantity,
                  r.returnedQuantity,
                  r.pendingReturnQuantity,
                  r.reviewerName,
                  localTime(r.reviewedAt),
                  label(r.reviewDecision),
                  r.executorName,
                  label(r.returnMode),
                  r.expectedReturnDate,
                ].map(workbookText),
              )
              .commit();
            summaryCount++;
          }
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        summary.commit();
        const details = sheet('商品明细', detailColumns);
        let itemCursor: string | undefined;
        for (;;) {
          await check();
          const seek = itemCursor ? Prisma.sql`AND i.id > ${itemCursor}::uuid` : Prisma.empty;
          const ids = await tx.$queryRaw<{ id: string }[]>`SELECT i.id ${detailFrom}
          WHERE ${sql.where} AND ${sql.itemWhere} ${seek} ORDER BY i.id LIMIT 500`;
          if (!ids.length) break;
          const items = await tx.requestItem.findMany({
            where: { id: { in: ids.map((i) => i.id) } },
            orderBy: { id: 'asc' },
            include: {
              product: { include: { category: true } },
              request: {
                include: { warehouse: true, claimant: true, fulfillment: true },
              },
            },
          });
          const requests = [...new Set(items.map((i) => i.requestId))];
          const [obligations, movements] = await Promise.all([
            tx.returnObligation.findMany({ where: { requestId: { in: requests } } }),
            tx.inventoryMovement.findMany({
              where: { requestId: { in: requests }, type: 'ISSUE' },
              select: { requestId: true, variantId: true, syncStatus: true, quantityDelta: true },
            }),
          ]);
          const returns = new Map(obligations.map((o) => [`${o.requestId}:${o.variantId}`, o]));
          const issues = new Map<string, typeof movements>();
          for (const m of movements) {
            const k = `${m.requestId}:${m.variantId}`;
            issues.set(k, [...(issues.get(k) ?? []), m]);
          }
          for (const i of items) {
            const r = i.request;
            const returned = returns.get(`${i.requestId}:${i.variantId}`);
            const issued = issues.get(`${i.requestId}:${i.variantId}`) ?? [];
            const fulfilled = r.fulfillment?.status === 'COMPLETED';
            const state = !fulfilled
              ? 'NOT_REQUIRED'
              : issued.length !== 1
                ? 'FAILED'
                : issued[0]!.syncStatus;
            details
              .addRow(
                [
                  r.requestNumber,
                  i.id,
                  r.warehouse.name,
                  r.claimant.name,
                  label(r.origin),
                  label(i.product.category.code),
                  i.productNameSnapshot,
                  i.sizeSnapshot,
                  i.quantity,
                  issued.reduce((n, m) => n - m.quantityDelta, 0),
                  returned?.returnedQuantity ?? 0,
                  returned && ['PENDING', 'PARTIAL'].includes(returned.status)
                    ? Math.max(0, returned.requiredQuantity - returned.returnedQuantity)
                    : 0,
                  label(state),
                  localTime(r.submittedAt ?? r.createdAt),
                  localTime(fulfilled ? r.fulfillment!.fulfilledAt : null),
                  label(r.status),
                ].map(workbookText),
              )
              .commit();
            detailCount++;
          }
          itemCursor = ids.at(-1)!.id;
        }
        details.commit();
      },
      { isolationLevel: 'RepeatableRead', timeout: options.EXPORT_TIMEOUT_MS, maxWait: 5000 },
    );
    await check();
    await Promise.all([workbook.commit(), completion]);
    await completion;
    const info = await storage.info(partial);
    if (info.size > options.EXPORT_MAX_BYTES)
      throw new ReportError('EXPORT_TOO_LARGE', '导出文件超过容量限制。');
    await assertExportAccess(database, job);
    await service.heartbeat(job);
    await storage.publish(partial, key);
    return { key, ...info, summaryCount, detailCount, snapshotAt };
  } catch (error) {
    // Destruction may emit a secondary stream error; preserve the original rejection.
    const failure = streamError ?? error;
    limiter.destroy();
    output.destroy();
    await completion.catch(() => undefined);
    await storage.remove(partial);
    await storage.remove(key);
    throw failure;
  } finally {
    clearTimeout(timer);
    clearInterval(heartbeatTimer);
    await heartbeat;
  }
}
