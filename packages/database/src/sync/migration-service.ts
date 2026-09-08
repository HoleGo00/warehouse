import { randomUUID } from 'node:crypto';
import {
  catalogRingSizes,
  migrationApplyOptionsSchema,
  movementOutboxPayloadSchema,
  productCatalog,
} from '@glorychips/contracts';
import type { MigrationApplyOptions, MigrationSnapshot } from '@glorychips/contracts';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { hashCommand } from '../inventory/stable-json.js';
import { buildMigrationPlan, migrationBatchSize, migrationRowOrder } from './migration-plan.js';
import { assertSourceFence, snapshotManifest, validateSnapshot } from './migration-snapshot.js';
import { FeishuSyncError } from './errors.js';
import { loadBindings } from './binding-service.js';
import { FeishuRemoteWriter, fieldValue, payloadHash } from './remote-writer.js';
import { FeishuSyncService } from './sync-service.js';
import type { FeishuBaseGateway, FeishuSyncOptions } from './types.js';

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export class InventoryMigrationService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly gateway: FeishuBaseGateway,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private options(input: MigrationApplyOptions, snapshot: MigrationSnapshot) {
    const options = migrationApplyOptionsSchema.parse(input);
    if (options.expectedFingerprint !== snapshot.fingerprint)
      throw new FeishuSyncError('MIGRATION_REVISION_CHANGED');
    if (options.mode !== 'TEST') {
      const freeze = Date.parse(options.freezeConfirmedAt ?? '');
      const captured = Date.parse(snapshot.capturedAt);
      if (
        !Number.isFinite(freeze) ||
        freeze > captured ||
        captured > this.now().getTime() + 60_000 ||
        freeze > this.now().getTime() ||
        this.now().getTime() - freeze > 2 * 60 * 60 * 1000
      ) {
        throw new FeishuSyncError('MIGRATION_FREEZE_REQUIRED');
      }
    }
    return options;
  }

  private syncOptions(batchId: string, options: MigrationApplyOptions): FeishuSyncOptions {
    return {
      environment: options.mode === 'TEST' ? 'TEST' : 'FORMAL',
      mode: options.mode === 'TEST' ? 'TEST' : 'MIGRATION_SHADOW',
      migrationBatchId: batchId,
      transactionTimeoutMs: 600_000,
      now: this.now,
    };
  }

  public async prepare(input: MigrationSnapshot, rawOptions: MigrationApplyOptions) {
    const snapshot = validateSnapshot(input);
    const options = this.options(rawOptions, snapshot);
    const plan = buildMigrationPlan(snapshot);
    if (plan.summary.blockingIssues) throw new FeishuSyncError('SYNC_LOCAL_INVARIANT');
    await assertSourceFence(this.gateway, snapshot);
    return this.database.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('inventory-history-migration'))`;
        let batch = await tx.inventoryMigrationBatch.findUnique({
          where: { batchKey: options.batchKey },
        });
        const manifest = { fingerprint: snapshot.fingerprint, tables: snapshotManifest(snapshot) };
        if (
          batch &&
          (batch.mode !== options.mode ||
            hashCommand(batch.sourceSnapshot) !== hashCommand(manifest))
        ) {
          throw new FeishuSyncError('MIGRATION_REVISION_CHANGED');
        }
        if (!batch) {
          batch = await tx.inventoryMigrationBatch.create({
            data: {
              batchKey: options.batchKey,
              mode: options.mode,
              sourceSnapshot: json(manifest),
              expectedSummary: json(plan.summary),
              anomalySummary: json(plan.anomalies),
              freezeConfirmedAt: options.freezeConfirmedAt
                ? new Date(options.freezeConfirmedAt)
                : null,
            },
          });
        }
        for (const target of ['RING_BASE', 'WATCH_BASE'] as const) {
          const bindings = await loadBindings(tx, target, this.syncOptions(batch.id, options));
          if (Object.values(bindings).some((binding) => binding.status !== 'PREPARED'))
            throw new FeishuSyncError('SYNC_BINDING_INVALID');
        }
        // Historical import is a closed ledger operation, never a live-stock setter.
        if (
          (await tx.inventoryMovement.count({ where: { source: { not: 'MIGRATION' } } })) ||
          (await tx.inventoryReservation.count({ where: { status: 'ACTIVE' } }))
        ) {
          throw new FeishuSyncError('SYNC_LOCAL_INVARIANT');
        }
        const warehouses = await tx.warehouse.findMany({ orderBy: { id: 'asc' } });
        const yuhang = warehouses.find((warehouse) => warehouse.code === 'YUHANG');
        const xihu = warehouses.find((warehouse) => warehouse.code === 'XIHU');
        if (!yuhang || !xihu || warehouses.length !== 2)
          throw new FeishuSyncError('SYNC_LOCAL_INVARIANT');
        const variants = await tx.productVariant.findMany({
          include: { product: true },
          orderBy: { id: 'asc' },
        });
        for (const variant of variants) {
          const definition = productCatalog.find(
            (product) => product.code === variant.product.code,
          );
          if (
            !definition ||
            variant.product.officialName !== definition.name ||
            variant.product.status !== definition.status ||
            variant.product.baseTarget !== definition.baseTarget ||
            variant.isActive !== (definition.status === 'ACTIVE')
          )
            throw new FeishuSyncError('SYNC_LOCAL_INVARIANT');
        }
        const byKey = new Map(variants.map((variant) => [variant.variantKey, variant]));
        const expectedKeys = productCatalog.flatMap((product) =>
          product.specificationMode === 'RING_SIZE'
            ? catalogRingSizes.map((size) => `${product.code}:${size}`)
            : [`${product.code}:NONE`],
        );
        if (
          options.mode !== 'TEST' &&
          (byKey.size !== expectedKeys.length || expectedKeys.some((key) => !byKey.has(key)))
        ) {
          throw new FeishuSyncError('SYNC_LOCAL_INVARIANT');
        }
        if (plan.balances.some((balance) => !byKey.has(balance.variantKey)))
          throw new FeishuSyncError('SYNC_LOCAL_INVARIANT');
        await tx.inventoryBalance.createMany({
          data: warehouses.flatMap((warehouse) =>
            variants.map((variant) => ({ warehouseId: warehouse.id, variantId: variant.id })),
          ),
          skipDuplicates: true,
        });
        const balances = await tx.inventoryBalance.findMany({ orderBy: { id: 'asc' } });
        for (const balance of balances) {
          await tx.$queryRaw`SELECT id FROM inventory_balances WHERE id = ${balance.id}::uuid FOR UPDATE`;
        }
        if (
          (await tx.inventoryMovement.count({ where: { source: { not: 'MIGRATION' } } })) ||
          (await tx.inventoryReservation.count({ where: { status: 'ACTIVE' } }))
        ) {
          throw new FeishuSyncError('SYNC_LOCAL_INVARIANT');
        }
        const previous = await tx.inventoryMigrationSource.findMany();
        const keys = new Map(plan.rows.map((row) => [row.key, row]));
        for (const source of previous) {
          const current = keys.get(
            `source:${source.sourceTarget}:${source.sourceTableId}:${source.sourceRecordId}:${source.semanticKind}`,
          );
          if (
            !current ||
            (current.sourceHash !== source.sourceHash && source.semanticKind !== 'LEDGER')
          ) {
            throw new FeishuSyncError('MIGRATION_REVISION_CHANGED');
          }
          if (
            source.batchId !== batch.id &&
            (await tx.inventoryMigrationBatch.count({
              where: { id: source.batchId, status: { not: 'SUCCEEDED' } },
            }))
          )
            throw new FeishuSyncError('SYNC_STATE_CONFLICT');
        }
        let created = 0;
        let reused = 0;
        const jobs: string[] = [];
        const businessNumber = `MIG-${batch.id}`;
        for (const variant of variants) {
          const balance = await tx.inventoryBalance.findUniqueOrThrow({
            where: { warehouseId_variantId: { warehouseId: yuhang.id, variantId: variant.id } },
          });
          const priorMovements = await tx.inventoryMovement.findMany({
            where: { warehouseId: yuhang.id, variantId: variant.id },
          });
          if (
            priorMovements.reduce((sum, row) => sum + row.quantityDelta, 0) !==
              balance.confirmedFeishuQuantity + balance.pendingMovementDelta ||
            priorMovements
              .filter((row) => row.syncStatus !== 'SYNCED')
              .reduce((sum, row) => sum + row.quantityDelta, 0) !== balance.pendingMovementDelta ||
            balance.reservedQuantity !== 0
          )
            throw new FeishuSyncError('SYNC_LOCAL_INVARIANT');
          let quantity = balance.confirmedFeishuQuantity + balance.pendingMovementDelta;
          let sequence = balance.movementSequence;
          const movementIds: string[] = [];
          for (const row of plan.rows
            .filter((item) => item.variantKey === variant.variantKey && item.kind !== 'LEDGER')
            .sort(migrationRowOrder)) {
            const old = previous.find(
              (item) =>
                item.sourceTarget === row.target &&
                item.sourceTableId === row.tableId &&
                item.sourceRecordId === row.recordId &&
                item.semanticKind === row.kind,
            );
            if (old) {
              reused++;
              continue;
            }
            let movementId: string | null = null;
            if (row.quantity !== 0) {
              const delta = row.kind === 'OUTBOUND' ? -row.quantity : row.quantity;
              const movement = await tx.inventoryMovement.create({
                data: {
                  deduplicationKey: row.key,
                  businessNumber,
                  warehouseId: yuhang.id,
                  variantId: variant.id,
                  type: delta > 0 ? 'INBOUND' : 'ISSUE',
                  source: 'MIGRATION',
                  quantityDelta: delta,
                  quantityBefore: quantity,
                  quantityAfter: quantity + delta,
                  balanceSequence: ++sequence,
                  sourceTableId: row.tableId,
                  sourceRecordId: row.recordId,
                  sourceNameSnapshot: row.sourceName,
                  productNameSnapshot: variant.product.officialName,
                  migrationBatchId: batch.id,
                  migrationOccurredAt: row.occurredAt ? new Date(row.occurredAt) : null,
                  historyOrderRebuilt: true,
                },
              });
              quantity += delta;
              movementId = movement.id;
              movementIds.push(movement.id);
              created++;
              await tx.inventoryBalance.update({
                where: { id: balance.id },
                data: {
                  pendingMovementDelta: { increment: delta },
                  movementSequence: sequence,
                  lastMovementId: movement.id,
                  version: { increment: 1 },
                },
              });
            }
            await tx.inventoryMigrationSource.create({
              data: {
                batchId: batch.id,
                sourceTarget: row.target,
                sourceTableId: row.tableId,
                sourceRecordId: row.recordId,
                semanticKind: row.kind,
                sourceHash: row.sourceHash,
                movementId,
                metadata: json({
                  variantKey: row.variantKey,
                  occurredAt: row.occurredAt,
                  businessKind: row.businessKind,
                }),
              },
            });
          }
          const expected =
            plan.balances.find((item) => item.variantKey === variant.variantKey)?.quantity ?? 0;
          if (quantity !== expected) throw new FeishuSyncError('SYNC_LOCAL_INVARIANT');
          for (let offset = 0; offset < movementIds.length; offset += migrationBatchSize) {
            const job = await tx.outboxJob.create({
              data: {
                type: 'SYNC_INVENTORY_MOVEMENTS',
                aggregateType: 'INVENTORY_MIGRATION_BATCH',
                aggregateId: batch.id,
                idempotencyKey: `migration:${batch.id}:${variant.id}:${offset}`,
                payload: {
                  businessNumber,
                  migrationOrder: jobs.length,
                  movementIds: movementIds.slice(offset, offset + migrationBatchSize),
                },
                steps: {
                  create: {
                    target: variant.product.baseTarget === 'RING' ? 'RING_BASE' : 'WATCH_BASE',
                  },
                },
              },
            });
            jobs.push(job.id);
          }
        }
        for (const row of plan.rows.filter((item) => item.kind === 'LEDGER' || !item.variantKey)) {
          const unique = {
            sourceTarget: row.target,
            sourceTableId: row.tableId,
            sourceRecordId: row.recordId,
            semanticKind: row.kind,
          };
          const old = previous.find(
            (item) =>
              item.sourceTarget === row.target &&
              item.sourceTableId === row.tableId &&
              item.sourceRecordId === row.recordId &&
              item.semanticKind === row.kind,
          );
          if (old) {
            if (old.sourceHash !== row.sourceHash) {
              await tx.auditLog.create({
                data: {
                  action: 'MIGRATION_LEDGER_REVISION',
                  entityType: 'INVENTORY_MIGRATION_BATCH',
                  entityId: batch.id,
                  before: { sourceId: old.id, hash: old.sourceHash },
                  after: { hash: row.sourceHash },
                },
              });
              await tx.inventoryMigrationSource.update({
                where: { id: old.id },
                data: { sourceHash: row.sourceHash },
              });
            }
          } else if (row.variantKey) {
            await tx.inventoryMigrationSource.create({
              data: {
                ...unique,
                batchId: batch.id,
                sourceHash: row.sourceHash,
                metadata: json({ variantKey: row.variantKey }),
              },
            });
          }
          if (row.kind === 'LEDGER' && row.variantKey) {
            const variant = byKey.get(row.variantKey)!;
            const balance = await tx.inventoryBalance.findUniqueOrThrow({
              where: { warehouseId_variantId: { warehouseId: yuhang.id, variantId: variant.id } },
            });
            const source = snapshot.tables.find(
              (table) => table.source.target === row.target && table.source.tableId === row.tableId,
            )!.source;
            await this.map(tx, source, 'SOURCE_LEDGER', balance.id, row.recordId, batch.id);
          }
        }
        const xihuBalances = await tx.inventoryBalance.findMany({
          where: { warehouseId: xihu.id },
        });
        if (
          xihuBalances.some(
            (balance) =>
              balance.confirmedFeishuQuantity ||
              balance.pendingMovementDelta ||
              balance.movementSequence ||
              balance.reservedQuantity,
          )
        ) {
          throw new FeishuSyncError('SYNC_LOCAL_INVARIANT');
        }
        await assertSourceFence(this.gateway, snapshot);
        if (batch.status !== 'SUCCEEDED')
          await tx.inventoryMigrationBatch.update({
            where: { id: batch.id },
            data: {
              status: 'RUNNING',
              startedAt: batch.startedAt ?? this.now(),
              lastErrorCode: null,
              lastError: null,
            },
          });
        await tx.auditLog.create({
          data: {
            action: 'INVENTORY_MIGRATION_PREPARED',
            entityType: 'INVENTORY_MIGRATION_BATCH',
            entityId: batch.id,
            after: {
              operator: options.operator,
              fingerprint: snapshot.fingerprint,
              created,
              reused,
              jobs: jobs.length,
            },
          },
        });
        return {
          batchId: batch.id,
          createdMovements: created,
          reusedSources: reused,
          createdJobs: jobs.length,
        };
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }

  public async resume(snapshot: MigrationSnapshot, rawOptions: MigrationApplyOptions) {
    const options = this.options(rawOptions, validateSnapshot(snapshot));
    const prepared = await this.prepare(snapshot, options);
    try {
      const sync = new FeishuSyncService(
        this.database,
        this.gateway,
        this.syncOptions(prepared.batchId, options),
      );
      await sync.validateBindings();
      const jobs = await this.database.outboxJob.findMany({
        where: {
          aggregateType: 'INVENTORY_MIGRATION_BATCH',
          aggregateId: prepared.batchId,
          type: 'SYNC_INVENTORY_MOVEMENTS',
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      jobs.sort(
        (a, b) =>
          (movementOutboxPayloadSchema.parse(a.payload).migrationOrder ?? 0) -
          (movementOutboxPayloadSchema.parse(b.payload).migrationOrder ?? 0),
      );
      for (const job of jobs) {
        await assertSourceFence(this.gateway, snapshot);
        await sync.runOnce(job.id);
      }
      const pending = await this.database.outboxJob.count({
        where: {
          aggregateType: 'INVENTORY_MIGRATION_BATCH',
          aggregateId: prepared.batchId,
          status: { not: 'SUCCEEDED' },
          type: 'SYNC_INVENTORY_MOVEMENTS',
        },
      });
      if (pending) return { ...prepared, status: 'RUNNING' as const, pendingJobs: pending };
      await this.ensureZeroBalances(snapshot, options, prepared.batchId);
      return { ...prepared, ...(await this.reconcile(snapshot, options, prepared.batchId)) };
    } catch (error) {
      const code = error instanceof FeishuSyncError ? error.code : 'SYNC_REMOTE_UNAVAILABLE';
      await this.database.$transaction(async (tx) => {
        await tx.inventoryMigrationBatch.update({
          where: { id: prepared.batchId },
          data: { status: 'FAILED', lastErrorCode: code, lastError: code, completedAt: null },
        });
        await tx.auditLog.create({
          data: {
            action: 'INVENTORY_MIGRATION_FAILED',
            entityType: 'INVENTORY_MIGRATION_BATCH',
            entityId: prepared.batchId,
            after: { code },
          },
        });
      });
      throw error;
    }
  }

  private async ensureZeroBalances(
    snapshot: MigrationSnapshot,
    options: MigrationApplyOptions,
    batchId: string,
  ) {
    for (const target of ['RING_BASE', 'WATCH_BASE'] as const) {
      await assertSourceFence(this.gateway, snapshot);
      const candidates = await this.database.inventoryBalance.findMany({
        where: { variant: { product: { baseTarget: target === 'RING_BASE' ? 'RING' : 'WATCH' } } },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      for (let offset = 0; offset < candidates.length; offset += migrationBatchSize) {
        await this.database.$transaction(
          async (tx) => {
            const bindings = await loadBindings(tx, target, this.syncOptions(batchId, options));
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`feishu:${bindings.BALANCE.baseToken}`}))`;
            const writer = new FeishuRemoteWriter(
              this.database,
              this.gateway,
              randomUUID(),
              async () => {
                const batch = await tx.inventoryMigrationBatch.findUniqueOrThrow({
                  where: { id: batchId },
                });
                if (!['RUNNING', 'SUCCEEDED'].includes(batch.status))
                  throw new FeishuSyncError('SYNC_STATE_CONFLICT');
              },
            );
            const products = new Set<string>();
            const balances = await tx.inventoryBalance.findMany({
              where: {
                id: {
                  in: candidates.slice(offset, offset + migrationBatchSize).map((row) => row.id),
                },
              },
              include: { warehouse: true, variant: { include: { product: true } } },
              orderBy: { id: 'asc' },
            });
            for (const balance of balances) {
              await tx.$queryRaw`SELECT id FROM inventory_balances WHERE id = ${balance.id}::uuid FOR UPDATE`;
              const current = await tx.inventoryBalance.findUniqueOrThrow({
                where: { id: balance.id },
              });
              if (
                current.pendingMovementDelta ||
                current.reservedQuantity ||
                current.movementSequence !== current.confirmedMovementSequence
              )
                throw new FeishuSyncError('SYNC_LOCAL_INVARIANT');
              const product = balance.variant.product;
              if (!products.has(product.id)) {
                const priorProduct = await writer.find(bindings.PRODUCT, product.id);
                const remoteProduct = await writer.write(
                  bindings.PRODUCT,
                  `${product.id}:${product.updatedAt.toISOString()}`,
                  {
                    stableKey: product.id,
                    productId: product.id,
                    productName: product.officialName,
                    category: target,
                    active: product.status === 'ACTIVE',
                  },
                  priorProduct?.recordId,
                );
                await this.map(
                  tx,
                  bindings.PRODUCT,
                  'PRODUCT',
                  product.id,
                  remoteProduct.recordId,
                  batchId,
                );
                products.add(product.id);
              }
              if (current.movementSequence !== 0) continue;
              if (current.confirmedFeishuQuantity !== 0)
                throw new FeishuSyncError('SYNC_LOCAL_INVARIANT');
              const key = `${balance.warehouseId}:${balance.variantId}`;
              const remote = await writer.write(bindings.BALANCE, `${key}:0`, {
                stableKey: key,
                warehouseId: balance.warehouseId,
                warehouseName: balance.warehouse.name,
                productId: product.id,
                productName: product.officialName,
                variantId: balance.variantId,
                size: balance.variant.size,
                quantity: 0,
                sequence: 0,
                lastMovementId: null,
                businessNumber: null,
              });
              await this.map(tx, bindings.BALANCE, 'BALANCE', balance.id, remote.recordId, batchId);
            }
          },
          { timeout: 600_000, maxWait: 10_000 },
        );
      }
      await assertSourceFence(this.gateway, snapshot);
    }
  }

  private async map(
    tx: Prisma.TransactionClient,
    binding: { baseToken: string; tableId: string },
    type: string,
    id: string,
    recordId: string,
    batchId: string,
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
      await tx.feishuMapping.create({ data: { ...unique, recordId, migrationBatchId: batchId } });
  }

  public async reconcile(
    snapshot: MigrationSnapshot,
    rawOptions: MigrationApplyOptions,
    batchId?: string,
  ) {
    const options = this.options(rawOptions, validateSnapshot(snapshot));
    const batch = await this.database.inventoryMigrationBatch.findUniqueOrThrow({
      where: { batchKey: options.batchKey },
    });
    if (
      (batchId && batch.id !== batchId) ||
      hashCommand(batch.sourceSnapshot) !==
        hashCommand({ fingerprint: snapshot.fingerprint, tables: snapshotManifest(snapshot) })
    ) {
      throw new FeishuSyncError('MIGRATION_REVISION_CHANGED');
    }
    await assertSourceFence(this.gateway, snapshot);
    const plan = buildMigrationPlan(snapshot);
    let mismatches = plan.summary.blockingIssues;
    let remoteMovements = 0;
    const optionsForSync = this.syncOptions(batch.id, options);
    const sync = new FeishuSyncService(this.database, this.gateway, optionsForSync);
    const job = await this.database.outboxJob.create({
      data: {
        type: 'RECONCILE_INVENTORY',
        aggregateType: 'INVENTORY_MIGRATION_BATCH',
        aggregateId: batch.id,
        idempotencyKey: `migration-reconcile:${batch.id}:${randomUUID()}`,
        payload: {},
        steps: { create: [{ target: 'RING_BASE' }, { target: 'WATCH_BASE' }] },
      },
    });
    const reconciled = await sync.runOnce(job.id);
    if (!reconciled.succeeded) mismatches++;
    mismatches += await this.database.inventoryReconciliation.count({
      where: { jobId: job.id, status: 'MISMATCH' },
    });
    for (const step of await this.database.outboxJobStep.findMany({ where: { jobId: job.id } })) {
      const result = step.result as { extraRecords?: number } | null;
      mismatches += result?.extraRecords ?? 0;
    }
    const sources = await this.database.inventoryMigrationSource.findMany();
    if (sources.length !== plan.rows.filter((row) => row.variantKey !== null).length) mismatches++;
    for (const row of plan.rows.filter((item) => item.variantKey)) {
      const source = sources.find(
        (item) =>
          item.sourceTarget === row.target &&
          item.sourceTableId === row.tableId &&
          item.sourceRecordId === row.recordId &&
          item.semanticKind === row.kind,
      );
      if (!source || source.sourceHash !== row.sourceHash) mismatches++;
    }
    const balances = await this.database.inventoryBalance.findMany({
      include: { warehouse: true, variant: true },
    });
    for (const balance of balances) {
      const expected =
        balance.warehouse.code === 'YUHANG'
          ? (plan.balances.find((item) => item.variantKey === balance.variant.variantKey)
              ?.quantity ?? 0)
          : 0;
      if (
        balance.confirmedFeishuQuantity !== expected ||
        balance.pendingMovementDelta !== 0 ||
        balance.reservedQuantity !== 0
      )
        mismatches++;
    }
    for (const target of ['RING_BASE', 'WATCH_BASE'] as const) {
      const binding = (await loadBindings(this.database, target, optionsForSync)).MOVEMENT;
      const expected = await this.database.inventoryMovement.findMany({
        where: {
          source: 'MIGRATION',
          variant: { product: { baseTarget: target === 'RING_BASE' ? 'RING' : 'WATCH' } },
        },
      });
      const seenIds = new Set<string>();
      const seenPages = new Set<string>();
      let token: string | undefined;
      for (;;) {
        const page = await this.gateway.listRecords(binding, token);
        for (const record of page.records) {
          remoteMovements++;
          const id = fieldValue(binding, record, 'movementId');
          const movement = expected.find((item) => item.id === id);
          if (
            !movement ||
            typeof id !== 'string' ||
            seenIds.has(id) ||
            movement.syncStatus !== 'SYNCED'
          ) {
            mismatches++;
            continue;
          }
          seenIds.add(id);
          const semantic = Object.fromEntries(
            Object.entries(binding.fieldIds as Record<string, string>)
              .filter(([key]) => key !== 'payloadHash')
              .map(([key, fieldId]) => [key, record.fields[fieldId] ?? null]),
          );
          const mapping = await this.database.feishuMapping.findUnique({
            where: {
              baseToken_tableId_recordId: {
                baseToken: binding.baseToken,
                tableId: binding.tableId,
                recordId: record.recordId,
              },
            },
          });
          const intent = await this.database.feishuSyncWrite.findUnique({
            where: {
              bindingId_stableKey: { bindingId: binding.id, stableKey: movement.deduplicationKey },
            },
          });
          if (
            !mapping ||
            mapping.localEntityId !== id ||
            !intent ||
            intent.status !== 'CONFIRMED' ||
            payloadHash(record.fields) !== intent.payloadHash ||
            fieldValue(binding, record, 'payloadHash') !== payloadHash(semantic)
          )
            mismatches++;
        }
        if (!page.hasMore) break;
        if (!page.pageToken || !page.records.length || seenPages.has(page.pageToken))
          throw new FeishuSyncError('SYNC_REMOTE_CONFLICT');
        seenPages.add(page.pageToken);
        token = page.pageToken;
      }
      mismatches += expected.filter((movement) => !seenIds.has(movement.id)).length;
    }
    await assertSourceFence(this.gateway, snapshot);
    const status = mismatches ? ('FAILED' as const) : ('SUCCEEDED' as const);
    const report = {
      status,
      mismatches,
      remoteMovements,
      pendingJobs: 0,
      reconciliationJobId: job.id,
      fingerprint: snapshot.fingerprint,
    };
    await this.database.$transaction(async (tx) => {
      await tx.inventoryMigrationBatch.update({
        where: { id: batch.id },
        data: { status, actualSummary: report, completedAt: mismatches ? null : this.now() },
      });
      await tx.auditLog.create({
        data: {
          action: 'INVENTORY_MIGRATION_RECONCILED',
          entityType: 'INVENTORY_MIGRATION_BATCH',
          entityId: batch.id,
          after: report,
        },
      });
    });
    return report;
  }
}
