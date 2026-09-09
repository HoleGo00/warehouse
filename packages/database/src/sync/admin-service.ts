import {
  migrationBatchesResponseSchema,
  movementOutboxPayloadSchema,
  retrySyncJobSchema,
  runSyncReconciliationSchema,
  syncBindingsResponseSchema,
  syncErrorCodeSchema,
  syncJobIdSchema,
  syncJobResponseSchema,
  syncJobsQuerySchema,
  syncJobsResponseSchema,
  syncReconciliationsQuerySchema,
  syncReconciliationsResponseSchema,
  syncReconciliationEvidenceSchema,
} from '@glorychips/contracts';
import type {
  SyncJob,
  SyncJobResponse,
  RunSyncReconciliationResponse,
  OutboxStepTarget,
} from '@glorychips/contracts';
import type { SessionPrincipal } from '../auth/types.js';
import type { OutboxJob, OutboxJobStep, Prisma, PrismaClient } from '../generated/prisma/client.js';
import { executeIdempotently } from '../idempotency/execute-idempotently.js';
import { FeishuSyncError } from './errors.js';

const assertAdmin = (actor: SessionPrincipal): void => {
  if (!actor.roles.includes('SYSTEM_ADMIN')) throw new FeishuSyncError('FORBIDDEN_ROLE');
};
const remoteRecordState = (rawEvidence: unknown) => {
  const evidence = syncReconciliationEvidenceSchema.safeParse(rawEvidence);
  if (!evidence.success) return 'PRESENT';
  if (evidence.data.missing) return 'MISSING';
  if ((evidence.data.remoteCount ?? 1) > 1) return 'DUPLICATE';
  if (evidence.data.validQuantity === false) return 'INVALID';
  return 'PRESENT';
};
const safeCode = (value: string | null): string | null =>
  value === null
    ? null
    : syncErrorCodeSchema.safeParse(value).success
      ? value
      : 'SYNC_REMOTE_UNAVAILABLE';
const projectJob = (job: OutboxJob & { steps: OutboxJobStep[] }): SyncJob => {
  const payload = movementOutboxPayloadSchema.safeParse(job.payload);
  return {
    id: job.id,
    type: job.type,
    businessNumber: payload.success ? payload.data.businessNumber : '',
    status: job.status,
    attempts: job.attempts,
    availableAt: job.availableAt.toISOString(),
    createdAt: job.createdAt.toISOString(),
    lastErrorCode: safeCode(job.lastErrorCode),
    lastError: safeCode(job.lastErrorCode),
    canRetry: ['RETRY', 'MANUAL_REVIEW'].includes(job.status),
    steps: job.steps.map((step) => ({
      id: step.id,
      target: step.target,
      status: step.status,
      attempts: step.attempts,
      availableAt: step.availableAt.toISOString(),
      startedAt: step.startedAt?.toISOString() ?? null,
      completedAt: step.completedAt?.toISOString() ?? null,
      lastErrorCode: safeCode(step.lastErrorCode),
      lastError: safeCode(step.lastErrorCode),
    })),
  };
};

export class FeishuSyncAdminService {
  public constructor(private readonly database: PrismaClient) {}

  public async jobs(raw: unknown, actor: SessionPrincipal) {
    assertAdmin(actor);
    const query = syncJobsQuerySchema.parse(raw);
    const jobs = await this.database.outboxJob.findMany({
      where: {
        status: query.status,
        ...(query.target ? { steps: { some: { target: query.target } } } : {}),
      },
      include: { steps: { orderBy: { target: 'asc' } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit,
    });
    return syncJobsResponseSchema.parse({ items: jobs.map(projectJob) });
  }

  public async job(rawId: string, actor: SessionPrincipal): Promise<SyncJobResponse> {
    assertAdmin(actor);
    const id = syncJobIdSchema.parse(rawId);
    const job = await this.database.outboxJob.findUnique({
      where: { id },
      include: { steps: { orderBy: { target: 'asc' } } },
    });
    if (!job) throw new FeishuSyncError('SYNC_JOB_NOT_FOUND');
    return syncJobResponseSchema.parse({ job: projectJob(job) });
  }

  public retry(
    rawId: string,
    raw: unknown,
    key: string,
    actor: SessionPrincipal,
  ): Promise<SyncJobResponse> {
    assertAdmin(actor);
    const id = syncJobIdSchema.parse(rawId);
    const command = retrySyncJobSchema.parse(raw);
    return executeIdempotently({
      database: this.database,
      key,
      operation: 'FEISHU_SYNC_RETRY',
      command: { id, ...command, actorUserId: actor.userId },
      invalidKeyError: () => new FeishuSyncError('VALIDATION_ERROR'),
      conflictError: () => new FeishuSyncError('IDEMPOTENCY_CONFLICT'),
      execute: async (tx) => {
        await tx.$queryRaw`SELECT id FROM outbox_jobs WHERE id = ${id}::uuid FOR UPDATE`;
        const job = await tx.outboxJob.findUnique({ where: { id }, include: { steps: true } });
        if (!job) throw new FeishuSyncError('SYNC_JOB_NOT_FOUND');
        if (!['RETRY', 'MANUAL_REVIEW'].includes(job.status))
          throw new FeishuSyncError('SYNC_STATE_CONFLICT');
        const steps = job.steps.filter(
          (step) =>
            ['RETRY', 'MANUAL_REVIEW'].includes(step.status) &&
            (!command.target || step.target === command.target),
        );
        if (!steps.length) throw new FeishuSyncError('SYNC_STATE_CONFLICT');
        const now = new Date();
        for (const step of steps) {
          await tx.outboxJobStep.update({
            where: { id: step.id },
            data: { status: 'RETRY', availableAt: now },
          });
        }
        // Retain attempts, errors, intents and administrator tasks until actual recovery succeeds.
        const updated = await tx.outboxJob.update({
          where: { id },
          data: {
            status: 'RETRY',
            availableAt: now,
            lockedBy: null,
            lockedAt: null,
            leaseToken: null,
          },
          include: { steps: { orderBy: { target: 'asc' } } },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: actor.userId,
            action: 'FEISHU_SYNC_RETRY_REQUESTED',
            entityType: 'OUTBOX_JOB',
            entityId: id,
            before: { status: job.status, errorCode: safeCode(job.lastErrorCode) },
            after: { targets: steps.map((step) => step.target), reason: command.reason },
          },
        });
        return syncJobResponseSchema.parse({ job: projectJob(updated) });
      },
    });
  }

  public async reconciliations(raw: unknown, actor: SessionPrincipal) {
    assertAdmin(actor);
    const query = syncReconciliationsQuerySchema.parse(raw);
    const rows = await this.database.inventoryReconciliation.findMany({
      where: { target: query.target, status: query.status, warehouse: { code: query.warehouse } },
      include: { warehouse: true, variant: { include: { product: true } } },
      orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
      take: query.limit,
    });
    return syncReconciliationsResponseSchema.parse({
      items: rows.map((row) => ({
        id: row.id,
        target: row.target,
        warehouse: row.warehouse.code,
        warehouseName: row.warehouse.name,
        variantId: row.variantId,
        productName: row.variant.product.officialName,
        variantName: row.variant.displayName,
        confirmedFeishuQuantity: row.confirmedFeishuQuantity,
        pendingMovementDelta: row.pendingMovementDelta,
        localEffectiveQuantity: row.localEffectiveQuantity,
        feishuQuantity: row.feishuQuantity,
        remoteRecordState: remoteRecordState(row.evidence),
        difference: row.difference,
        status: row.status,
        checkedAt: row.checkedAt.toISOString(),
        schemaVersion: row.schemaVersion,
      })),
    });
  }

  public runReconciliation(
    raw: unknown,
    key: string,
    actor: SessionPrincipal,
  ): Promise<RunSyncReconciliationResponse> {
    assertAdmin(actor);
    const command = runSyncReconciliationSchema.parse(raw);
    return executeIdempotently({
      database: this.database,
      key,
      operation: 'FEISHU_RECONCILIATION_REQUEST',
      command: { ...command, actorUserId: actor.userId },
      invalidKeyError: () => new FeishuSyncError('VALIDATION_ERROR'),
      conflictError: () => new FeishuSyncError('IDEMPOTENCY_CONFLICT'),
      execute: async (tx) => {
        const result = await enqueueReconciliation(tx, `reconcile:manual:${key}`, command.target);
        await tx.auditLog.create({
          data: {
            actorUserId: actor.userId,
            action: 'FEISHU_RECONCILIATION_REQUESTED',
            entityType: 'OUTBOX_JOB',
            entityId: result.jobId,
            after: { target: command.target ?? 'ALL' },
          },
        });
        return result;
      },
    });
  }

  public async bindings(actor: SessionPrincipal) {
    assertAdmin(actor);
    const rows = await this.database.feishuTableBinding.findMany({
      orderBy: [{ environment: 'asc' }, { target: 'asc' }, { kind: 'asc' }],
    });
    return syncBindingsResponseSchema.parse({
      items: rows.map((row) => ({
        id: row.id,
        target: row.target,
        kind: row.kind,
        environment: row.environment,
        status: row.status,
        schemaVersion: row.schemaVersion,
        schemaFingerprint: row.schemaFingerprint,
        preparedAt: row.preparedAt.toISOString(),
        activatedAt: row.activatedAt?.toISOString() ?? null,
      })),
    });
  }

  public async migrations(actor: SessionPrincipal) {
    assertAdmin(actor);
    const rows = await this.database.inventoryMigrationBatch.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return migrationBatchesResponseSchema.parse({
      items: rows.map((row) => ({
        id: row.id,
        batchKey: row.batchKey,
        mode: row.mode,
        status: row.status,
        startedAt: row.startedAt?.toISOString() ?? null,
        completedAt: row.completedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        lastErrorCode: safeCode(row.lastErrorCode),
        lastError: safeCode(row.lastErrorCode),
      })),
    });
  }
}

export async function enqueueReconciliation(
  tx: Prisma.TransactionClient,
  key: string,
  target?: OutboxStepTarget,
): Promise<RunSyncReconciliationResponse> {
  const targets: OutboxStepTarget[] = target ? [target] : ['RING_BASE', 'WATCH_BASE'];
  const job = await tx.outboxJob.upsert({
    where: { idempotencyKey: key },
    update: {},
    create: {
      type: 'RECONCILE_INVENTORY',
      aggregateType: 'INVENTORY_RECONCILIATION',
      aggregateId: key,
      idempotencyKey: key,
      payload: { targets },
      steps: { create: targets.map((target) => ({ target })) },
    },
  });
  return { jobId: job.id };
}
