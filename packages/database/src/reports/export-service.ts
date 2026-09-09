import { randomUUID } from 'node:crypto';
import {
  exportJobSchema,
  reportFiltersSchema,
  exportListQuerySchema,
  idempotencyKeySchema,
  warehouseCodes,
  exportListCursorSchema,
} from '@glorychips/contracts';
import type { ExportJob } from '@glorychips/contracts';
import type { Prisma } from '../generated/prisma/client.js';
import type { PrismaClient, RequestExport } from '../generated/prisma/client.js';
import type { SessionPrincipal } from '../auth/types.js';
import { AuthDomainError } from '../auth/errors.js';
import { executeIdempotently } from '../idempotency/execute-idempotently.js';
import { hashCommand } from '../inventory/stable-json.js';
import { currentReportPrincipal } from './report-service.js';
import { reportWarehouses } from './report-query.js';
import { ReportError } from './errors.js';
import { RequestDomainError } from '../requests/errors.js';

const lifetimeMs = 86_400_000;
export const exportLeaseMs = 60_000;
const toJson = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;
export function exportProjection(job: RequestExport, now = new Date()): ExportJob {
  return exportJobSchema.parse({
    id: job.id,
    status: job.expiresAt && job.expiresAt <= now ? 'EXPIRED' : job.status,
    createdAt: job.createdAt.toISOString(),
    snapshotAt: job.snapshotAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    expiresAt: job.expiresAt?.toISOString() ?? null,
    summaryCount: job.summaryCount,
    detailCount: job.detailCount,
    fileSize: job.fileSize,
    errorCode: job.errorCode,
  });
}
export async function assertExportAccess(
  tx: Prisma.TransactionClient,
  job: Pick<RequestExport, 'actorUserId' | 'warehouses'>,
) {
  const actor = await currentReportPrincipal(tx, job.actorUserId);
  const allowed = reportWarehouses(actor);
  if (
    !job.warehouses.length ||
    job.warehouses.some((w) => !warehouseCodes.some((c) => c === w && allowed.includes(c)))
  )
    throw new AuthDomainError('FORBIDDEN_WAREHOUSE', '导出包含已撤销授权的仓库。');
}
const audit = (
  tx: Prisma.TransactionClient,
  job: Pick<RequestExport, 'id' | 'actorUserId'>,
  action: string,
  detail: Prisma.InputJsonValue = {},
) =>
  tx.auditLog.create({
    data: {
      actorUserId: job.actorUserId,
      action,
      entityType: 'REQUEST_EXPORT',
      entityId: job.id,
      after: detail,
    },
  });

export class ExportService {
  public constructor(public readonly database: PrismaClient) {}

  public async create(raw: unknown, key: string, principal: SessionPrincipal) {
    const filters = reportFiltersSchema.parse(raw);
    idempotencyKeySchema.parse(key);
    reportWarehouses(principal, filters.warehouse);
    const result = await executeIdempotently({
      database: this.database,
      key,
      operation: 'REQUEST_EXPORT_CREATE',
      command: { actor: principal.userId, filters },
      invalidKeyError: () => new AuthDomainError('VALIDATION_ERROR', '缺少操作标识。'),
      conflictError: () =>
        new RequestDomainError('IDEMPOTENCY_CONFLICT', '操作标识已用于不同条件。'),
      execute: async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`report-user:${principal.userId}`}))`;
        const actor = await currentReportPrincipal(tx, principal.userId);
        const warehouses = reportWarehouses(actor, filters.warehouse);
        const active = await tx.requestExport.count({
          where: { actorUserId: actor.userId, status: { in: ['QUEUED', 'RUNNING'] } },
        });
        if (active >= 2) throw new ReportError('EXPORT_LIMIT', '已有两个未完成导出，请稍后再试。');
        const job = await tx.requestExport.create({
          data: {
            actorUserId: actor.userId,
            filters: toJson(filters),
            filterHash: hashCommand(filters),
            warehouses,
          },
        });
        await audit(tx, job, 'REQUEST_EXPORT_CREATED', { filterHash: job.filterHash, warehouses });
        return { id: job.id };
      },
    });
    return { job: await this.get(result.id, principal) };
  }

  private async owned(id: string, principal: SessionPrincipal) {
    reportWarehouses(principal);
    const job = await this.database.requestExport.findFirst({
      where: { id, actorUserId: principal.userId },
    });
    if (!job) throw new ReportError('EXPORT_NOT_FOUND', '导出任务不存在。');
    return job;
  }
  public async get(id: string, principal: SessionPrincipal) {
    return exportProjection(await this.owned(id, principal));
  }
  public async list(raw: unknown, principal: SessionPrincipal) {
    reportWarehouses(principal);
    const page = exportListQuerySchema.parse(raw);
    let cursor: { id: string; createdAt: string } | undefined;
    if (page.cursor) {
      try {
        cursor = exportListCursorSchema.parse(
          JSON.parse(Buffer.from(page.cursor, 'base64url').toString('utf8')),
        );
      } catch {
        throw new AuthDomainError('VALIDATION_ERROR', '导出分页条件无效。');
      }
    }
    const rows = await this.database.requestExport.findMany({
      where: {
        actorUserId: principal.userId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(cursor.createdAt) } },
                { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: page.limit + 1,
    });
    const last = rows[page.limit - 1];
    return {
      items: rows.slice(0, page.limit).map((j) => exportProjection(j)),
      nextCursor:
        rows.length > page.limit && last
          ? Buffer.from(
              JSON.stringify({
                id: last.id,
                createdAt: last.createdAt.toISOString(),
              }),
            ).toString('base64url')
          : null,
    };
  }
  public async download(id: string, principal: SessionPrincipal) {
    const job = await this.owned(id, principal);
    await assertExportAccess(this.database, job);
    if (job.expiresAt && job.expiresAt <= new Date())
      throw new ReportError('EXPORT_EXPIRED', '文件已过期，请重新导出。');
    if (job.status !== 'SUCCEEDED' || !job.fileKey)
      throw new ReportError('EXPORT_NOT_READY', '文件尚未生成或已失效。');
    await audit(this.database, job, 'REQUEST_EXPORT_DOWNLOAD_REQUESTED');
    return { key: job.fileKey, size: job.fileSize!, name: `warehouse-${job.id}.xlsx` };
  }
  public async claim() {
    return this.database.$transaction(async (tx) => {
      const stale = await tx.requestExport.findMany({
        where: { status: 'RUNNING', leaseUntil: { lt: new Date() } },
        take: 100,
      });
      for (const j of stale) {
        const updated = await tx.requestExport.updateMany({
          where: {
            id: j.id,
            status: 'RUNNING',
            leaseToken: j.leaseToken,
            leaseUntil: { lt: new Date() },
          },
          data: {
            status: j.attemptCount >= 3 ? 'FAILED' : 'QUEUED',
            errorCode: 'EXPORT_TIMEOUT',
            leaseToken: null,
            leaseUntil: null,
          },
        });
        if (updated.count)
          await audit(
            tx,
            j,
            j.attemptCount >= 3 ? 'REQUEST_EXPORT_FAILED' : 'REQUEST_EXPORT_RECOVERED',
          );
      }
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM request_exports WHERE status = 'QUEUED'
        ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1`;
      if (!rows[0]) return null;
      return tx.requestExport.update({
        where: { id: rows[0].id },
        data: {
          status: 'RUNNING',
          attemptCount: { increment: 1 },
          leaseToken: randomUUID(),
          leaseUntil: new Date(Date.now() + exportLeaseMs),
          errorCode: null,
        },
      });
    });
  }
  public async heartbeat(job: RequestExport) {
    const result = await this.database.requestExport.updateMany({
      where: {
        id: job.id,
        status: 'RUNNING',
        leaseToken: job.leaseToken,
        leaseUntil: { gt: new Date() },
      },
      data: { leaseUntil: new Date(Date.now() + exportLeaseMs) },
    });
    if (!result.count) throw new ReportError('EXPORT_LEASE_LOST', '导出执行权已失效。');
  }
  public async complete(
    job: RequestExport,
    artifact: {
      key: string;
      size: number;
      hash: string;
      summaryCount: number;
      detailCount: number;
      snapshotAt: Date;
    },
  ) {
    await this.database.$transaction(async (tx) => {
      await assertExportAccess(tx, job);
      const now = new Date();
      const result = await tx.requestExport.updateMany({
        where: {
          id: job.id,
          status: 'RUNNING',
          leaseToken: job.leaseToken,
          leaseUntil: { gt: now },
        },
        data: {
          status: 'SUCCEEDED',
          fileKey: artifact.key,
          fileSize: artifact.size,
          fileHash: artifact.hash,
          summaryCount: artifact.summaryCount,
          detailCount: artifact.detailCount,
          snapshotAt: artifact.snapshotAt,
          completedAt: now,
          expiresAt: new Date(now.getTime() + lifetimeMs),
          leaseUntil: null,
          leaseToken: null,
        },
      });
      if (!result.count) throw new ReportError('EXPORT_LEASE_LOST', '导出执行权已失效。');
      await audit(tx, job, 'REQUEST_EXPORT_SUCCEEDED', {
        detailCount: artifact.detailCount,
        hash: artifact.hash,
      });
    });
  }
  public async fail(job: RequestExport, code: string, retryable: boolean) {
    await this.database.$transaction(async (tx) => {
      const retry = retryable && job.attemptCount < 3;
      const updated = await tx.requestExport.updateMany({
        where: { id: job.id, status: 'RUNNING', leaseToken: job.leaseToken },
        data: {
          status: retry ? 'QUEUED' : 'FAILED',
          errorCode: code,
          completedAt: retry ? null : new Date(),
          expiresAt: retry ? null : new Date(Date.now() + lifetimeMs),
          leaseUntil: null,
          leaseToken: null,
        },
      });
      if (updated.count)
        await audit(tx, job, retry ? 'REQUEST_EXPORT_RETRY' : 'REQUEST_EXPORT_FAILED', { code });
    });
  }
  public async expire(now = new Date()) {
    const expired = await this.database.requestExport.findMany({
      where: {
        expiresAt: { lte: now },
        OR: [
          { status: { in: ['SUCCEEDED', 'FAILED'] } },
          { status: 'EXPIRED', fileKey: { not: null } },
        ],
      },
      take: 200,
      orderBy: { expiresAt: 'asc' },
    });
    for (const job of expired) {
      await this.database.$transaction(async (tx) => {
        const result = await tx.requestExport.updateMany({
          where: { id: job.id, status: { in: ['SUCCEEDED', 'FAILED'] }, expiresAt: { lte: now } },
          data: { status: 'EXPIRED', filters: {} },
        });
        if (result.count)
          await audit(tx, job, 'REQUEST_EXPORT_EXPIRED', { filterHash: job.filterHash });
      });
    }
    return expired;
  }
}
