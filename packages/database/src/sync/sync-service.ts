import { randomUUID } from 'node:crypto';
import { movementOutboxPayloadSchema } from '@glorychips/contracts';
import type { OutboxStepTarget } from '@glorychips/contracts';
import type {
  Prisma,
  PrismaClient,
  OutboxJob,
  InventoryMovement,
  FeishuTableBinding,
} from '../generated/prisma/client.js';
import { loadBindings } from './binding-service.js';
import { FeishuSyncError } from './errors.js';
import { FeishuRemoteWriter, fieldValue, payloadHash } from './remote-writer.js';
import { FeishuGatewayError, feishuSchemaFingerprint } from './types.js';
import type {
  FeishuBaseGateway,
  FeishuFields,
  FeishuSyncOptions,
  FeishuSyncRunResult,
  FeishuRecord,
} from './types.js';

type Tx = Prisma.TransactionClient;
const targetOf = (base: string): OutboxStepTarget => (base === 'RING' ? 'RING_BASE' : 'WATCH_BASE');
const keyOf = (row: { warehouseId: string; variantId: string }) =>
  `${row.warehouseId}:${row.variantId}`;

export class FeishuSyncService {
  private readonly workerId: string;
  private readonly now: () => Date;
  public constructor(
    private readonly database: PrismaClient,
    private readonly gateway: FeishuBaseGateway,
    private readonly options: FeishuSyncOptions,
  ) {
    this.workerId = options.workerId ?? randomUUID();
    this.now = options.now ?? (() => new Date());
  }

  public async validateBindings(): Promise<void> {
    for (const target of ['RING_BASE', 'WATCH_BASE'] as const) {
      const bindings = await loadBindings(this.database, target, this.options);
      for (const binding of Object.values(bindings)) {
        if (
          feishuSchemaFingerprint(await this.gateway.listFields(binding)) !==
          binding.schemaFingerprint
        ) {
          throw new FeishuSyncError('SYNC_BINDING_INVALID');
        }
      }
    }
  }

  public async runOnce(jobId?: string): Promise<FeishuSyncRunResult> {
    const job = await this.claim(jobId);
    if (!job) return { claimed: 0, succeeded: 0, retried: 0, manualReview: 0 };
    const steps = await this.database.outboxJobStep.findMany({ where: { jobId: job.id } });
    for (const step of steps) {
      if (
        step.status === 'SUCCEEDED' ||
        step.status === 'MANUAL_REVIEW' ||
        step.availableAt > this.now()
      )
        continue;
      try {
        await this.processStep(job, step.target);
      } catch (error) {
        await this.failStep(job, step.target, error);
      }
    }
    const status = await this.aggregate(job);
    return {
      claimed: 1,
      succeeded: Number(status === 'SUCCEEDED'),
      retried: Number(status === 'RETRY'),
      manualReview: Number(status === 'MANUAL_REVIEW'),
    };
  }

  public async claim(jobId?: string): Promise<OutboxJob | null> {
    if (this.options.environment === 'FORMAL') {
      for (const target of ['RING_BASE', 'WATCH_BASE'] as const) {
        await loadBindings(this.database, target, this.options);
      }
    }
    const now = this.now();
    const expired = new Date(now.getTime() - (this.options.leaseMs ?? 180_000));
    return this.database.$transaction(async (tx) => {
      const scope =
        this.options.mode === 'MIGRATION_SHADOW'
          ? {
              aggregateType: 'INVENTORY_MIGRATION_BATCH',
              aggregateId: this.options.migrationBatchId,
            }
          : {};
      const candidates = await tx.outboxJob.findMany({
        where: {
          ...scope,
          ...(jobId ? { id: jobId } : {}),
          OR: [
            { status: { in: ['PENDING', 'RETRY'] }, availableAt: { lte: now } },
            { status: 'PROCESSING', lockedAt: { lte: expired } },
          ],
        },
        orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        take: 100,
      });
      for (const candidate of candidates) {
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM outbox_jobs WHERE id = ${candidate.id}::uuid
          FOR UPDATE SKIP LOCKED`;
        if (locked.length === 0) continue;
        const current = await tx.outboxJob.findUniqueOrThrow({ where: { id: candidate.id } });
        if (!(
          (['PENDING', 'RETRY'].includes(current.status) && current.availableAt <= now) ||
          (current.status === 'PROCESSING' && current.lockedAt && current.lockedAt <= expired)
        ))
          continue;
        return tx.outboxJob.update({
          where: { id: current.id },
          data: {
            status: 'PROCESSING',
            lockedAt: now,
            lockedBy: this.workerId,
            leaseToken: randomUUID(),
            attempts: { increment: 1 },
          },
        });
      }
      return null;
    });
  }

  private async fence(tx: Tx, job: OutboxJob): Promise<void> {
    const current = await tx.outboxJob.findUnique({ where: { id: job.id } });
    if (!current || current.status !== 'PROCESSING' || current.leaseToken !== job.leaseToken) {
      throw new FeishuSyncError('SYNC_LEASE_LOST');
    }
  }

  public async processStep(job: OutboxJob, target: OutboxStepTarget): Promise<void> {
    if (!job.leaseToken) throw new FeishuSyncError('SYNC_LEASE_LOST');
    await this.database.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM outbox_jobs WHERE id = ${job.id}::uuid FOR UPDATE`;
        await this.fence(tx, job);
        const step = await tx.outboxJobStep.findUniqueOrThrow({
          where: { jobId_target: { jobId: job.id, target } },
        });
        if (step.status === 'SUCCEEDED') return;
        if (step.status === 'MANUAL_REVIEW' || step.availableAt > this.now()) {
          throw new FeishuSyncError('SYNC_STATE_CONFLICT');
        }
        const bindings = await loadBindings(tx, target, this.options);
        for (const binding of Object.values(bindings)) {
          if (
            feishuSchemaFingerprint(await this.gateway.listFields(binding)) !==
            binding.schemaFingerprint
          ) {
            throw new FeishuSyncError('SYNC_BINDING_INVALID');
          }
        }
        // A transaction lock spans all remote I/O. Recovery cannot overtake a live writer.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`feishu:${bindings.BALANCE.baseToken}`}))`;
        const writer = new FeishuRemoteWriter(this.database, this.gateway, job.leaseToken!, () =>
          this.fence(tx, job),
        );
        let result: Prisma.InputJsonObject = { confirmed: true };
        if (job.type === 'RECONCILE_INVENTORY') {
          result = await this.reconcileTarget(tx, bindings.BALANCE, target, job.id);
        } else {
          const payload = movementOutboxPayloadSchema.safeParse(job.payload);
          if (!payload.success) throw new FeishuSyncError('SYNC_LOCAL_INVARIANT');
          const all = await tx.inventoryMovement.findMany({
            where: { id: { in: payload.data.movementIds } },
            include: { variant: { include: { product: true } }, warehouse: true },
          });
          if (
            all.length !== payload.data.movementIds.length ||
            all.some((m) => m.businessNumber !== payload.data.businessNumber)
          ) {
            throw new FeishuSyncError('SYNC_LOCAL_INVARIANT');
          }
          const movements = all.filter((m) => targetOf(m.variant.product.baseTarget) === target);
          if (
            !movements.length ||
            movements.some(
              (m) =>
                m.syncStatus === 'SYNCED' ||
                (this.options.mode === 'MIGRATION_SHADOW' &&
                  m.migrationBatchId !== this.options.migrationBatchId),
            )
          ) {
            throw new FeishuSyncError('SYNC_LOCAL_INVARIANT');
          }
          const keys = [...new Set(movements.map(keyOf))].sort();
          for (const key of keys) {
            const rows = movements
              .filter((m) => keyOf(m) === key)
              .sort((a, b) => (a.balanceSequence ?? 0) - (b.balanceSequence ?? 0));
            const first = rows[0]!;
            await tx.$queryRaw`SELECT id FROM inventory_balances
            WHERE warehouse_id = ${first.warehouseId}::uuid AND variant_id = ${first.variantId}::uuid
            FOR UPDATE`;
            const balance = await tx.inventoryBalance.findUniqueOrThrow({
              where: {
                warehouseId_variantId: {
                  warehouseId: first.warehouseId,
                  variantId: first.variantId,
                },
              },
            });
            const pending = await tx.inventoryMovement.findMany({
              where: {
                warehouseId: first.warehouseId,
                variantId: first.variantId,
                syncStatus: { not: 'SYNCED' },
              },
            });
            if (
              pending.some((m) => m.balanceSequence === null) ||
              pending.reduce((sum, m) => sum + m.quantityDelta, 0) !== balance.pendingMovementDelta
            ) {
              throw new FeishuSyncError('SYNC_LOCAL_INVARIANT');
            }
            if (
              rows.some((m, i) => m.balanceSequence !== balance.confirmedMovementSequence + i + 1)
            ) {
              throw new FeishuSyncError('SYNC_ORDER_BLOCKED');
            }
            let quantity = balance.confirmedFeishuQuantity;
            for (const movement of rows) {
              if (
                movement.quantityBefore !== quantity ||
                movement.quantityAfter !== quantity + movement.quantityDelta
              ) {
                throw new FeishuSyncError('SYNC_LOCAL_INVARIANT');
              }
              quantity += movement.quantityDelta;
            }
            const product = first.variant.product;
            const productFields: FeishuFields = {
              stableKey: product.id,
              productId: product.id,
              productName: product.officialName,
              category: target,
              active: product.status === 'ACTIVE',
            };
            const priorProduct = await writer.find(bindings.PRODUCT, product.id);
            const productRecord = await writer.write(
              bindings.PRODUCT,
              `${product.id}:${product.updatedAt.toISOString()}`,
              productFields,
              priorProduct?.recordId,
            );
            await this.map(tx, bindings.PRODUCT, 'PRODUCT', product.id, productRecord.recordId);
            for (const movement of rows) {
              const fields = this.movementFields(
                movement,
                movement.productNameSnapshot ?? product.officialName,
                product.id,
                first.variant.size,
              );
              const record = await writer.write(
                bindings.MOVEMENT,
                movement.deduplicationKey,
                fields,
              );
              await this.map(tx, bindings.MOVEMENT, 'MOVEMENT', movement.id, record.recordId);
            }
            const last = rows.at(-1)!;
            const fields: FeishuFields = {
              stableKey: key,
              warehouseId: first.warehouseId,
              warehouseName: first.warehouse.name,
              productId: product.id,
              productName: last.productNameSnapshot ?? product.officialName,
              variantId: first.variantId,
              size: first.variant.size,
              quantity,
              sequence: last.balanceSequence!,
              lastMovementId: last.id,
              businessNumber: last.businessNumber,
            };
            const remote = await writer.find(bindings.BALANCE, key);
            const atTarget =
              remote &&
              fieldValue(bindings.BALANCE, remote, 'quantity') === quantity &&
              fieldValue(bindings.BALANCE, remote, 'sequence') === last.balanceSequence &&
              fieldValue(bindings.BALANCE, remote, 'lastMovementId') === last.id;
            if (
              !atTarget &&
              remote &&
              (fieldValue(bindings.BALANCE, remote, 'quantity') !==
                balance.confirmedFeishuQuantity ||
                fieldValue(bindings.BALANCE, remote, 'sequence') !==
                  balance.confirmedMovementSequence ||
                fieldValue(bindings.BALANCE, remote, 'lastMovementId') !==
                  balance.confirmedLastMovementId)
            )
              throw new FeishuSyncError('SYNC_REMOTE_CONFLICT');
            if (
              !remote &&
              (balance.confirmedFeishuQuantity !== 0 || balance.confirmedMovementSequence !== 0)
            ) {
              throw new FeishuSyncError('SYNC_REMOTE_CONFLICT');
            }
            const remoteBalance = await writer.write(
              bindings.BALANCE,
              `${key}:${last.balanceSequence}`,
              fields,
              remote?.recordId,
            );
            await this.map(tx, bindings.BALANCE, 'BALANCE', balance.id, remoteBalance.recordId);
            await this.fence(tx, job);
            const delta = rows.reduce((sum, m) => sum + m.quantityDelta, 0);
            await tx.inventoryBalance.update({
              where: { id: balance.id },
              data: {
                confirmedFeishuQuantity: { increment: delta },
                pendingMovementDelta: { decrement: delta },
                confirmedMovementSequence: last.balanceSequence!,
                confirmedLastMovementId: last.id,
                version: { increment: 1 },
              },
            });
            await tx.inventoryMovement.updateMany({
              where: { id: { in: rows.map((m) => m.id) } },
              data: { syncStatus: 'SYNCED' },
            });
          }
        }
        await tx.outboxJobStep.update({
          where: { id: step.id },
          data: {
            status: 'SUCCEEDED',
            attempts: { increment: 1 },
            startedAt: step.startedAt ?? this.now(),
            completedAt: this.now(),
            result,
            lastErrorCode: null,
            lastError: null,
          },
        });
        await tx.adminTask.updateMany({
          where: { deduplicationKey: `sync:${job.id}:${target}`, status: 'OPEN' },
          data: { status: 'COMPLETED', completedAt: this.now() },
        });
        await tx.auditLog.create({
          data: {
            action: 'FEISHU_STEP_CONFIRMED',
            entityType: 'OUTBOX_JOB',
            entityId: job.id,
            after: { target },
          },
        });
      },
      { timeout: this.options.transactionTimeoutMs ?? 180_000, maxWait: 10_000 },
    );
  }

  private movementFields(
    m: InventoryMovement,
    name: string,
    productId: string,
    size: string | null,
  ): FeishuFields {
    const fields: FeishuFields = {
      stableKey: m.deduplicationKey,
      movementId: m.id,
      businessNumber: m.businessNumber,
      warehouseId: m.warehouseId,
      productId,
      productName: name,
      variantId: m.variantId,
      size,
      type: m.type,
      source: m.source,
      delta: m.quantityDelta,
      before: m.quantityBefore,
      after: m.quantityAfter,
      sequence: m.balanceSequence,
      actorName: m.actorNameSnapshot,
      actorFeishuUserId: m.actorFeishuUserId,
      occurredAt:
        m.source === 'MIGRATION'
          ? (m.migrationOccurredAt?.toISOString() ?? null)
          : m.occurredAt.toISOString(),
      sourceTableId: m.sourceTableId,
      sourceRecordId: m.sourceRecordId,
      sourceName: m.sourceNameSnapshot,
      migrationBatchId: m.migrationBatchId,
      historyOrderRebuilt: m.historyOrderRebuilt,
    };
    return { ...fields, payloadHash: payloadHash(fields) };
  }

  private async map(
    tx: Tx,
    binding: FeishuTableBinding,
    type: string,
    id: string,
    recordId: string,
  ) {
    const unique = {
      localEntityType: type,
      localEntityId: id,
      baseToken: binding.baseToken,
      tableId: binding.tableId,
    };
    const existing = await tx.feishuMapping.findUnique({
      where: { localEntityType_localEntityId_baseToken_tableId: unique },
    });
    if (existing && existing.recordId !== recordId)
      throw new FeishuSyncError('SYNC_REMOTE_CONFLICT');
    if (!existing)
      await tx.feishuMapping.create({
        data: { ...unique, recordId, migrationBatchId: this.options.migrationBatchId },
      });
  }

  private async failStep(job: OutboxJob, target: OutboxStepTarget, error: unknown) {
    await this.database.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM outbox_jobs WHERE id = ${job.id}::uuid FOR UPDATE`;
      await this.fence(tx, job);
      const step = await tx.outboxJobStep.findUniqueOrThrow({
        where: { jobId_target: { jobId: job.id, target } },
      });
      if (step.status === 'SUCCEEDED') return;
      const code =
        error instanceof FeishuSyncError
          ? error.code
          : error instanceof FeishuGatewayError && error.kind === 'permanent'
            ? 'SYNC_BINDING_INVALID'
            : error instanceof FeishuGatewayError && error.kind === 'uncertain'
              ? 'SYNC_REMOTE_UNCERTAIN'
              : 'SYNC_REMOTE_UNAVAILABLE';
      const attempts = step.attempts + Number(code !== 'SYNC_ORDER_BLOCKED');
      const manual =
        !['SYNC_ORDER_BLOCKED', 'SYNC_REMOTE_UNCERTAIN', 'SYNC_REMOTE_UNAVAILABLE'].includes(
          code,
        ) || attempts >= (this.options.maxAttempts ?? 8);
      const random = this.options.random ?? Math.random;
      const delay = Math.min(
        this.options.retryMaxMs ?? 300_000,
        (this.options.retryBaseMs ?? 1000) * 2 ** Math.min(attempts, 20) * (0.5 + random() * 0.5),
      );
      await tx.outboxJobStep.update({
        where: { id: step.id },
        data: {
          status: manual ? 'MANUAL_REVIEW' : 'RETRY',
          attempts,
          lastErrorCode: code,
          lastError: code,
          startedAt: step.startedAt ?? this.now(),
          availableAt: new Date(this.now().getTime() + delay),
        },
      });
      const payload = movementOutboxPayloadSchema.safeParse(job.payload);
      if (payload.success)
        await tx.inventoryMovement.updateMany({
          where: {
            id: { in: payload.data.movementIds },
            syncStatus: { not: 'SYNCED' },
            variant: { product: { baseTarget: target === 'RING_BASE' ? 'RING' : 'WATCH' } },
          },
          data: { syncStatus: manual ? 'FAILED' : 'PENDING' },
        });
      if (manual) {
        await tx.adminTask.upsert({
          where: { deduplicationKey: `sync:${job.id}:${target}` },
          create: {
            deduplicationKey: `sync:${job.id}:${target}`,
            type: 'SYNC_EXCEPTION',
            severity: 'CRITICAL',
            title: '库存同步异常',
            detail: { jobId: job.id, target, code },
          },
          update: { status: 'OPEN', completedAt: null, detail: { jobId: job.id, target, code } },
        });
      }
    });
  }

  private async aggregate(job: OutboxJob) {
    return this.database.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM outbox_jobs WHERE id = ${job.id}::uuid FOR UPDATE`;
      await this.fence(tx, job);
      const steps = await tx.outboxJobStep.findMany({ where: { jobId: job.id } });
      const succeeded = steps.length > 0 && steps.every((s) => s.status === 'SUCCEEDED');
      const retryable = steps.filter((s) => ['PENDING', 'RETRY'].includes(s.status));
      const status = succeeded ? 'SUCCEEDED' : retryable.length ? 'RETRY' : 'MANUAL_REVIEW';
      const pending = steps.filter((s) => s.status !== 'SUCCEEDED');
      await tx.outboxJob.update({
        where: { id: job.id },
        data: {
          status,
          lockedAt: null,
          lockedBy: null,
          leaseToken: null,
          availableAt: retryable.length
            ? new Date(Math.min(...retryable.map((s) => s.availableAt.getTime())))
            : this.now(),
          lastErrorCode: pending[0]?.lastErrorCode ?? null,
          lastError: pending[0]?.lastError ?? null,
        },
      });
      if (job.type === 'SYNC_INVENTORY_MOVEMENTS') {
        const payload = movementOutboxPayloadSchema.safeParse(job.payload);
        if (payload.success) {
          const movements = await tx.inventoryMovement.findMany({
            where: { id: { in: payload.data.movementIds } },
          });
          for (const id of new Set(
            movements.map((m) => m.requestId).filter((id): id is string => !!id),
          )) {
            const remaining = await tx.inventoryMovement.count({
              where: { requestId: id, syncStatus: { not: 'SYNCED' } },
            });
            const failed = await tx.inventoryMovement.count({
              where: { requestId: id, syncStatus: 'FAILED' },
            });
            await tx.request.update({
              where: { id },
              data: {
                syncStatus: remaining === 0 ? 'SYNCED' : failed > 0 ? 'FAILED' : 'PENDING',
              },
            });
          }
        }
      }
      return status;
    });
  }

  private async reconcileTarget(
    tx: Tx,
    binding: FeishuTableBinding,
    target: OutboxStepTarget,
    jobId: string,
  ): Promise<Prisma.InputJsonObject> {
    const remoteByKey = new Map<string, FeishuRecord[]>();
    const seenIds = new Set<string>();
    const seenPages = new Set<string>();
    let pageToken: string | undefined;
    let invalidKeys = 0;
    do {
      const page = await this.gateway.listRecords(binding, pageToken);
      for (const record of page.records) {
        if (seenIds.has(record.recordId)) throw new FeishuSyncError('SYNC_REMOTE_CONFLICT');
        seenIds.add(record.recordId);
        const key = fieldValue(binding, record, 'stableKey');
        if (typeof key !== 'string' || !key) {
          invalidKeys++;
          continue;
        }
        remoteByKey.set(key, [...(remoteByKey.get(key) ?? []), record]);
      }
      if (!page.hasMore) break;
      if (!page.pageToken || seenPages.has(page.pageToken)) {
        throw new FeishuSyncError('SYNC_REMOTE_CONFLICT');
      }
      seenPages.add(page.pageToken);
      pageToken = page.pageToken;
    } while (pageToken !== undefined);
    const balances = await tx.inventoryBalance.findMany({
      where: { variant: { product: { baseTarget: target === 'RING_BASE' ? 'RING' : 'WATCH' } } },
      orderBy: [{ warehouseId: 'asc' }, { variantId: 'asc' }],
    });
    let matched = 0;
    let mismatched = 0;
    for (const item of balances) {
      await tx.$queryRaw`SELECT id FROM inventory_balances WHERE id = ${item.id}::uuid FOR UPDATE`;
      const balance = await tx.inventoryBalance.findUniqueOrThrow({ where: { id: item.id } });
      const records = remoteByKey.get(keyOf(balance)) ?? [];
      remoteByKey.delete(keyOf(balance));
      const remote = records[0];
      const rawQuantity = remote ? fieldValue(binding, remote, 'quantity') : null;
      const validQuantity = typeof rawQuantity === 'number' && Number.isSafeInteger(rawQuantity);
      const quantity = validQuantity && records.length === 1 ? rawQuantity : null;
      const difference = quantity === null ? null : quantity - balance.confirmedFeishuQuantity;
      const identityMatches =
        remote &&
        fieldValue(binding, remote, 'warehouseId') === balance.warehouseId &&
        fieldValue(binding, remote, 'variantId') === balance.variantId;
      const sequenceMatches =
        remote &&
        fieldValue(binding, remote, 'sequence') === balance.confirmedMovementSequence &&
        fieldValue(binding, remote, 'lastMovementId') === balance.confirmedLastMovementId;
      const status =
        records.length === 1 &&
        validQuantity &&
        difference === 0 &&
        identityMatches &&
        sequenceMatches
          ? 'MATCHED'
          : 'MISMATCH';
      if (status === 'MATCHED') matched++;
      else mismatched++;
      await tx.inventoryReconciliation.create({
        data: {
          warehouseId: balance.warehouseId,
          variantId: balance.variantId,
          target,
          confirmedFeishuQuantity: balance.confirmedFeishuQuantity,
          pendingMovementDelta: balance.pendingMovementDelta,
          localEffectiveQuantity: balance.confirmedFeishuQuantity + balance.pendingMovementDelta,
          feishuQuantity: quantity,
          difference,
          status,
          remoteRecordId: remote?.recordId,
          bindingId: binding.id,
          schemaVersion: binding.schemaVersion,
          jobId,
          migrationBatchId: this.options.migrationBatchId,
          evidence: {
            remoteCount: records.length,
            validQuantity,
            identityMatches: !!identityMatches,
            sequenceMatches: !!sequenceMatches,
            missing: !remote,
            sequence: remote ? fieldValue(binding, remote, 'sequence') : null,
          } as Prisma.InputJsonObject,
        },
      });
      const deduplicationKey = `reconcile:${binding.id}:${balance.id}`;
      if (status === 'MISMATCH')
        await tx.adminTask.upsert({
          where: { deduplicationKey },
          create: {
            deduplicationKey,
            type: 'SYNC_EXCEPTION',
            severity: 'CRITICAL',
            title: '库存对账差异',
            detail: { target, balanceId: balance.id, difference, remoteCount: records.length },
          },
          update: {
            status: 'OPEN',
            completedAt: null,
            detail: { target, balanceId: balance.id, difference, remoteCount: records.length },
          },
        });
      else
        await tx.adminTask.updateMany({
          where: { deduplicationKey, status: 'OPEN' },
          data: { status: 'COMPLETED', completedAt: this.now() },
        });
    }
    const extraRecords =
      invalidKeys + [...remoteByKey.values()].reduce((sum, rows) => sum + rows.length, 0);
    const deduplicationKey = `reconcile:${binding.id}:unmapped`;
    if (extraRecords) {
      await tx.adminTask.upsert({
        where: { deduplicationKey },
        create: {
          deduplicationKey,
          type: 'SYNC_EXCEPTION',
          severity: 'CRITICAL',
          title: '库存对账存在未映射记录',
          detail: { target, extraRecords },
        },
        update: { status: 'OPEN', completedAt: null, detail: { target, extraRecords } },
      });
    } else {
      await tx.adminTask.updateMany({
        where: { deduplicationKey, status: 'OPEN' },
        data: { status: 'COMPLETED', completedAt: this.now() },
      });
    }
    return { checked: true, matched, mismatched, extraRecords };
  }
}
