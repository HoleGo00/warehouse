import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  InventoryService,
  FeishuBindingService,
  FeishuSyncService,
  FeishuGatewayError,
  FeishuSyncAdminService,
  enqueueReconciliation,
} from '../src/index.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import type { PreparedFeishuBinding } from '../src/index.js';
import { FakeFeishuGateway } from './helpers/feishu-gateway.js';
import { v1Schema, schemaFingerprint } from '../../../apps/worker/src/feishu/v1-schema.js';
import { createIsolatedSyncDatabase } from './helpers/isolated-sync-database.js';
import type { SessionPrincipal } from '../src/index.js';

describe.skipIf(!process.env['DATABASE_URL'])(
  'Feishu synchronization PostgreSQL integration',
  () => {
    let db: PrismaClient;
    let warehouseId: string;
    let inventory: InventoryService;
    let gateway: FakeFeishuGateway;
    let now = new Date(Date.now() + 60_000);
    let bindings: PreparedFeishuBinding[];
    let dispose: (() => Promise<void>) | undefined;
    let actor: SessionPrincipal;
    const service = (extra = {}) =>
      new FeishuSyncService(db, gateway, {
        environment: 'TEST',
        mode: 'TEST',
        now: () => now,
        random: () => 0,
        ...extra,
      });
    const variant = async (target: 'RING' | 'WATCH' = 'RING') => {
      const category = await db.productCategory.findFirstOrThrow();
      return db.productVariant.create({
        data: {
          product: {
            create: {
              code: `SYNC_${randomUUID()}`,
              officialName: 'Sync test product',
              categoryId: category.id,
              baseTarget: target,
              specificationMode: 'NONE',
            },
          },
          code: 'DEFAULT',
          variantKey: `sync:${randomUUID()}`,
          displayName: 'Default',
          specificationMode: 'NONE',
          balances: { create: { warehouseId } },
        },
      });
    };
    const move = (variantId: string, quantityDelta: number, occurredAt?: Date) =>
      inventory.applyMovementBatch(
        {
          businessNumber: `SYNC-${randomUUID()}`,
          source: 'ADMIN_INBOUND',
          occurredAt,
          lines: [
            {
              warehouseId,
              variantId,
              quantityDelta,
              type: quantityDelta > 0 ? 'INBOUND' : 'ISSUE',
            },
          ],
        },
        randomUUID(),
      );
    const balance = (variantId: string) =>
      db.inventoryBalance.findUniqueOrThrow({
        where: { warehouseId_variantId: { warehouseId, variantId } },
      });

    beforeAll(async () => {
      const isolated = await createIsolatedSyncDatabase();
      db = isolated.database;
      dispose = isolated.dispose;
      inventory = new InventoryService(db);
      warehouseId = (await db.warehouse.findUniqueOrThrow({ where: { code: 'YUHANG' } })).id;
      gateway = new FakeFeishuGateway();
      const user = await db.user.create({
        data: { tenantKey: 'test', feishuUserId: 'sync-actor', name: 'Original operator' },
      });
      actor = {
        sessionId: 'test',
        userId: user.id,
        feishuUserId: user.feishuUserId!,
        name: user.name,
        avatarUrl: null,
        roles: ['SYSTEM_ADMIN'],
        warehouses: ['YUHANG', 'XIHU'],
        expiresAt: new Date('2030-01-01'),
      };
      bindings = [];
      for (const target of ['RING_BASE', 'WATCH_BASE'] as const) {
        for (const kind of ['PRODUCT', 'BALANCE', 'MOVEMENT'] as const) {
          const baseToken = `fakesynctest${target}`;
          const tableId = `tbl${target}${kind}`;
          const definitions = v1Schema[kind].fields;
          const fields = definitions.map((field) => ({
            fieldId: `fld${field.key}`,
            name: field.name,
            type: field.type,
          }));
          gateway.tables.set(`${baseToken}:${tableId}`, {
            table: { tableId, name: v1Schema[kind].name },
            fields,
            rows: new Map(),
          });
          bindings.push({
            baseToken,
            tableId,
            target,
            kind,
            environment: 'TEST',
            schemaVersion: 1,
            schemaFingerprint: schemaFingerprint(fields),
            fieldIds: Object.fromEntries(
              definitions.map((field) => [field.key, `fld${field.key}`]),
            ),
          });
        }
        await new FeishuBindingService(db).savePrepared(
          bindings.filter((item) => item.target === target),
        );
      }
    }, 90_000);
    afterAll(async () => {
      await dispose?.();
    });
    afterEach(() => {
      gateway.afterWrite = undefined;
      gateway.beforeWrite = undefined;
    });

    it('settles pending without changing effective stock and cannot settle twice', async () => {
      const item = await variant();
      const batch = await move(item.id, 10);
      expect(await balance(item.id)).toMatchObject({
        confirmedFeishuQuantity: 0,
        pendingMovementDelta: 10,
      });
      expect(await service().runOnce(batch.outboxJobId)).toMatchObject({
        claimed: 1,
        succeeded: 1,
      });
      expect(await balance(item.id)).toMatchObject({
        confirmedFeishuQuantity: 10,
        pendingMovementDelta: 0,
        confirmedMovementSequence: 1,
      });
      const count = gateway.creates;
      expect(await service().runOnce(batch.outboxJobId)).toMatchObject({ claimed: 0 });
      expect(gateway.creates).toBe(count);
    });
    it('tolerates delayed query visibility by rereading without repeating a mutation', async () => {
      const item = await variant();
      const batch = await move(item.id, 4);
      const original = gateway.findRecords.bind(gateway);
      let hidden = 0;
      gateway.findRecords = async (table, fieldId, value) => {
        const records = await original(table, fieldId, value);
        if (table.tableId.endsWith('MOVEMENT') && records.length && hidden < 2) {
          hidden++;
          return [];
        }
        return records;
      };
      const writes = gateway.creates;
      try {
        expect(await service().runOnce(batch.outboxJobId)).toMatchObject({ succeeded: 1 });
      } finally {
        gateway.findRecords = original;
      }
      expect(hidden).toBe(2);
      expect(gateway.creates - writes).toBe(3);
      expect(await balance(item.id)).toMatchObject({
        confirmedFeishuQuantity: 4,
        pendingMovementDelta: 0,
      });
    });
    it('retries a definitively rejected original intent without discarding its failure evidence', async () => {
      const item = await variant();
      const batch = await move(item.id, 3);
      const count = gateway.creates;
      gateway.beforeWrite = () => {
        throw new FeishuGatewayError('CLI_REMOTE_UNAVAILABLE', 'retryable', 'not-applied');
      };
      expect(await service().runOnce(batch.outboxJobId)).toMatchObject({ retried: 1 });
      expect(gateway.creates).toBe(count);
      const rejected = await db.feishuSyncWrite.findFirstOrThrow({
        where: { status: 'REJECTED', fields: { path: ['fldstableKey'], equals: item.productId } },
      });
      expect(rejected.attempts).toBe(1);
      gateway.beforeWrite = undefined;
      now = new Date(now.getTime() + 10_000);
      expect(await service().runOnce(batch.outboxJobId)).toMatchObject({ succeeded: 1 });
      expect(
        await db.feishuSyncWrite.findUniqueOrThrow({ where: { id: rejected.id } }),
      ).toMatchObject({
        status: 'CONFIRMED',
        attempts: 2,
        lastErrorCode: 'SYNC_REMOTE_REJECTED',
      });
      expect(
        await db.auditLog.count({
          where: { entityId: rejected.id, action: 'FEISHU_WRITE_FAILED' },
        }),
      ).toBe(1);
      expect(await balance(item.id)).toMatchObject({
        confirmedFeishuQuantity: 3,
        pendingMovementDelta: 0,
      });
    });
    it('recovers two-balance partial remote success after local settlement rolls back', async () => {
      const a = await variant();
      const b = await variant();
      const batch = await inventory.applyMovementBatch(
        {
          businessNumber: `SYNC-${randomUUID()}`,
          source: 'ADMIN_INBOUND',
          lines: [a, b].map((item) => ({
            warehouseId,
            variantId: item.id,
            quantityDelta: 5,
            type: 'INBOUND' as const,
          })),
        },
        randomUUID(),
      );
      let writes = 0;
      gateway.afterWrite = (table) => {
        if (table.tableId.endsWith('BALANCE') && ++writes === 2)
          throw new Error('simulated local rollback');
      };
      expect(await service().runOnce(batch.outboxJobId)).toMatchObject({ retried: 1 });
      expect(await balance(a.id)).toMatchObject({
        confirmedFeishuQuantity: 0,
        pendingMovementDelta: 5,
      });
      expect(await balance(b.id)).toMatchObject({
        confirmedFeishuQuantity: 0,
        pendingMovementDelta: 5,
      });
      gateway.afterWrite = undefined;
      const created = gateway.creates;
      const updated = gateway.updates;
      now = new Date(now.getTime() + 10_000);
      expect(await service().runOnce(batch.outboxJobId)).toMatchObject({ succeeded: 1 });
      expect(gateway.creates).toBe(created);
      expect(gateway.updates).toBe(updated);
      expect(await balance(a.id)).toMatchObject({
        confirmedFeishuQuantity: 5,
        pendingMovementDelta: 0,
      });
      expect(await balance(b.id)).toMatchObject({
        confirmedFeishuQuantity: 5,
        pendingMovementDelta: 0,
      });
    });

    it('uses transaction sequence instead of backdated occurrence dates and handles net-zero pending', async () => {
      const item = await variant();
      const first = await move(item.id, 6);
      const second = await move(item.id, -6, new Date('2020-01-01'));
      expect(await balance(item.id)).toMatchObject({ pendingMovementDelta: 0 });
      expect(await service().runOnce(second.outboxJobId)).toMatchObject({ retried: 1 });
      expect(await service().runOnce(first.outboxJobId)).toMatchObject({ succeeded: 1 });
      now = new Date(now.getTime() + 10_000);
      expect(await service().runOnce(second.outboxJobId)).toMatchObject({ succeeded: 1 });
      expect(await balance(item.id)).toMatchObject({
        confirmedFeishuQuantity: 0,
        pendingMovementDelta: 0,
        confirmedMovementSequence: 2,
      });
    });

    it('recovers remote success followed by local rollback without a second write', async () => {
      const item = await variant();
      const batch = await move(item.id, 7);
      gateway.afterWrite = (table) => {
        if (table.tableId.endsWith('BALANCE')) {
          gateway.afterWrite = undefined;
          throw new FeishuGatewayError('CLI_TIMEOUT', 'uncertain');
        }
      };
      expect(await service().runOnce(batch.outboxJobId)).toMatchObject({ retried: 1 });
      expect(await balance(item.id)).toMatchObject({
        confirmedFeishuQuantity: 0,
        pendingMovementDelta: 7,
      });
      const writes = gateway.creates + gateway.updates;
      now = new Date(now.getTime() + 10_000);
      expect(await service().runOnce(batch.outboxJobId)).toMatchObject({ succeeded: 1 });
      expect(gateway.creates + gateway.updates).toBe(writes);
      expect(await balance(item.id)).toMatchObject({
        confirmedFeishuQuantity: 7,
        pendingMovementDelta: 0,
      });
    });

    it('does not blindly recreate an uncertain missing record', async () => {
      const item = await variant();
      const batch = await move(item.id, 2);
      gateway.beforeWrite = () => {
        gateway.beforeWrite = undefined;
        throw new FeishuGatewayError('CLI_TIMEOUT', 'uncertain');
      };
      expect(await service({ maxAttempts: 2 }).runOnce(batch.outboxJobId)).toMatchObject({
        retried: 1,
      });
      const writes = gateway.creates;
      now = new Date(now.getTime() + 10_000);
      expect(await service({ maxAttempts: 2 }).runOnce(batch.outboxJobId)).toMatchObject({
        manualReview: 1,
      });
      expect(gateway.creates).toBe(writes);
      expect(await balance(item.id)).toMatchObject({
        confirmedFeishuQuantity: 0,
        pendingMovementDelta: 2,
      });
      expect(
        await db.adminTask.count({
          where: { deduplicationKey: `sync:${batch.outboxJobId}:RING_BASE` },
        }),
      ).toBe(1);
    });

    it('claims a job once and rejects a stale worker after lease recovery', async () => {
      const item = await variant();
      const batch = await move(item.id, 3);
      const a = service({ leaseMs: 1000 });
      const claims = await Promise.all([
        a.claim(batch.outboxJobId),
        service().claim(batch.outboxJobId),
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);
      const old = claims.find((job) => job !== null)!;
      now = new Date(now.getTime() + 200_000);
      const fresh = await a.claim(batch.outboxJobId);
      expect(fresh).not.toBeNull();
      await expect(a.processStep(old, 'RING_BASE')).rejects.toThrow('SYNC_LEASE_LOST');
      await a.processStep(fresh!, 'RING_BASE');
      expect(await balance(item.id)).toMatchObject({
        confirmedFeishuQuantity: 3,
        pendingMovementDelta: 0,
      });
    });

    it('captures immutable product and operator snapshots inside movement transactions', async () => {
      const item = await variant();
      const batch = await inventory.applyMovementBatch(
        {
          businessNumber: `SNAPSHOT-${randomUUID()}`,
          source: 'ADMIN_INBOUND',
          actorUserId: actor.userId,
          lines: [{ warehouseId, variantId: item.id, quantityDelta: 5, type: 'INBOUND' }],
        },
        randomUUID(),
      );
      await db.user.update({ where: { id: actor.userId }, data: { name: 'Renamed operator' } });
      await db.product.update({
        where: { id: item.productId },
        data: { officialName: 'Renamed product' },
      });
      const movement = await db.inventoryMovement.findUniqueOrThrow({
        where: { id: batch.movementIds[0]! },
      });
      expect(movement).toMatchObject({
        productNameSnapshot: 'Sync test product',
        actorNameSnapshot: 'Original operator',
        actorFeishuUserId: 'sync-actor',
      });
      expect(await service().runOnce(batch.outboxJobId)).toMatchObject({ succeeded: 1 });
      const binding = bindings.find(
        (row) => row.target === 'RING_BASE' && row.kind === 'MOVEMENT',
      )!;
      const records = await gateway.findRecords(binding, 'fldmovementId', movement.id);
      expect(records[0]?.fields).toMatchObject({
        fldproductName: 'Sync test product',
        fldactorName: 'Original operator',
        fldactorFeishuUserId: 'sync-actor',
      });
    });

    it('blocks a product edit while an older remote write remains unresolved', async () => {
      const item = await variant();
      const batch = await move(item.id, 4);
      gateway.beforeWrite = () => {
        gateway.beforeWrite = undefined;
        throw new FeishuGatewayError('CLI_TIMEOUT', 'uncertain');
      };
      expect(await service().runOnce(batch.outboxJobId)).toMatchObject({ retried: 1 });
      await db.product.update({
        where: { id: item.productId },
        data: { officialName: 'Changed while uncertain' },
      });
      const count = gateway.creates + gateway.updates;
      now = new Date(now.getTime() + 10_000);
      expect(await service().runOnce(batch.outboxJobId)).toMatchObject({ retried: 1 });
      expect(gateway.creates + gateway.updates).toBe(count);
      expect(await balance(item.id)).toMatchObject({
        confirmedFeishuQuantity: 0,
        pendingMovementDelta: 4,
      });
    });

    it('allows the retryable target to finish while the other target requires manual review', async () => {
      const ring = await variant();
      const watch = await variant('WATCH');
      const request = await db.request.create({
        data: {
          requestNumber: `MIX-${randomUUID()}`,
          warehouseId,
          claimantId: actor.userId,
          origin: 'ONLINE',
          status: 'COMPLETED',
          syncStatus: 'PENDING',
        },
      });
      const batch = await inventory.applyMovementBatch(
        {
          businessNumber: request.requestNumber,
          requestId: request.id,
          source: 'ADMIN_INBOUND',
          lines: [ring, watch].map((item) => ({
            warehouseId,
            variantId: item.id,
            quantityDelta: 2,
            type: 'INBOUND' as const,
          })),
        },
        randomUUID(),
      );
      const ringBinding = bindings.find(
        (item) => item.target === 'RING_BASE' && item.kind === 'PRODUCT',
      )!;
      const state = gateway.tables.get(`${ringBinding.baseToken}:${ringBinding.tableId}`)!;
      const originalFields = state.fields;
      state.fields = originalFields.map((field) => ({ ...field, type: 'formula' }));
      const listFields = gateway.listFields.bind(gateway);
      gateway.listFields = async (table) => {
        if (table.baseToken.includes('WATCH'))
          throw new FeishuGatewayError('CLI_RATE_LIMIT', 'retryable');
        return listFields(table);
      };
      try {
        expect(await service().runOnce(batch.outboxJobId)).toMatchObject({ retried: 1 });
      } finally {
        gateway.listFields = listFields;
      }
      expect(await db.request.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({
        syncStatus: 'FAILED',
      });
      now = new Date(now.getTime() + 10_000);
      expect(await service().runOnce(batch.outboxJobId)).toMatchObject({ manualReview: 1 });
      expect(await balance(watch.id)).toMatchObject({
        confirmedFeishuQuantity: 2,
        pendingMovementDelta: 0,
      });
      expect(await balance(ring.id)).toMatchObject({
        confirmedFeishuQuantity: 0,
        pendingMovementDelta: 2,
      });
      expect(await db.request.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({
        syncStatus: 'FAILED',
      });
      state.fields = originalFields;
      const admin = new FeishuSyncAdminService(db);
      const key = randomUUID();
      const writes = gateway.creates + gateway.updates;
      const command = { target: 'RING_BASE', reason: 'Verified configuration' };
      const first = await admin.retry(batch.outboxJobId, command, key, actor);
      expect(await admin.retry(batch.outboxJobId, command, key, actor)).toEqual(first);
      expect(gateway.creates + gateway.updates).toBe(writes);
      expect(
        await db.auditLog.count({
          where: { action: 'FEISHU_SYNC_RETRY_REQUESTED', entityId: batch.outboxJobId },
        }),
      ).toBe(1);
      expect(await service().runOnce(batch.outboxJobId)).toMatchObject({ succeeded: 1 });
      expect(await db.request.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({
        syncStatus: 'SYNCED',
      });
      expect(await balance(ring.id)).toMatchObject({
        confirmedFeishuQuantity: 2,
        pendingMovementDelta: 0,
      });
      expect(
        await db.adminTask.findUnique({
          where: { deduplicationKey: `sync:${batch.outboxJobId}:RING_BASE` },
        }),
      ).toMatchObject({ status: 'COMPLETED' });
      await expect(admin.retry(batch.outboxJobId, command, randomUUID(), actor)).rejects.toThrow(
        'SYNC_STATE_CONFLICT',
      );
    });

    it('persists missing, extra, duplicate and sequence-drift reconciliation evidence without changing balances', async () => {
      const good = await variant();
      const duplicate = await variant();
      const drift = await variant();
      const missing = await variant();
      for (const item of [good, duplicate, drift]) {
        const batch = await move(item.id, 3);
        await service().runOnce(batch.outboxJobId);
      }
      await move(good.id, 1);
      const binding = bindings.find((row) => row.target === 'RING_BASE' && row.kind === 'BALANCE')!;
      const duplicateRecord = (
        await gateway.findRecords(binding, 'fldstableKey', `${warehouseId}:${duplicate.id}`)
      )[0]!;
      await gateway.createRecords(binding, [
        duplicateRecord.fields,
        { fldstableKey: 'unknown-extra', fldquantity: 4 },
      ]);
      const driftRecord = (
        await gateway.findRecords(binding, 'fldstableKey', `${warehouseId}:${drift.id}`)
      )[0]!;
      await gateway.updateRecord(binding, driftRecord.recordId, {
        ...driftRecord.fields,
        fldsequence: 999,
      });
      const job = await db.$transaction((tx) =>
        enqueueReconciliation(tx, `reconcile:test:${randomUUID()}`, 'RING_BASE'),
      );
      const before = await balance(good.id);
      expect(await service().runOnce(job.jobId)).toMatchObject({ succeeded: 1 });
      expect(await balance(good.id)).toEqual(before);
      const rows = await db.inventoryReconciliation.findMany({ where: { jobId: job.jobId } });
      expect(rows.find((row) => row.variantId === good.id)).toMatchObject({
        status: 'MATCHED',
        confirmedFeishuQuantity: 3,
        pendingMovementDelta: 1,
        localEffectiveQuantity: 4,
        difference: 0,
      });
      expect(rows.find((row) => row.variantId === missing.id)).toMatchObject({
        status: 'MISMATCH',
        feishuQuantity: null,
        difference: null,
        evidence: { missing: true },
      });
      expect(rows.find((row) => row.variantId === duplicate.id)).toMatchObject({
        status: 'MISMATCH',
        feishuQuantity: null,
        evidence: { remoteCount: 2 },
      });
      expect(rows.find((row) => row.variantId === drift.id)).toMatchObject({
        status: 'MISMATCH',
        evidence: { sequenceMatches: false },
      });
      const projected = await new FeishuSyncAdminService(db).reconciliations({ limit: 200 }, actor);
      expect(projected.items.find((row) => row.variantId === missing.id)).toMatchObject({
        remoteRecordState: 'MISSING',
        feishuQuantity: null,
        difference: null,
      });
      expect(projected.items.find((row) => row.variantId === duplicate.id)).toMatchObject({
        remoteRecordState: 'DUPLICATE',
        feishuQuantity: null,
      });
      expect(
        await db.outboxJobStep.findUnique({
          where: { jobId_target: { jobId: job.jobId, target: 'RING_BASE' } },
        }),
      ).toMatchObject({ result: { checked: true, extraRecords: 1 } });
    });

    it('keeps prepared bindings inactive and records runtime schema drift per formal target', async () => {
      for (const target of ['RING_BASE', 'WATCH_BASE'] as const) {
        const group = bindings
          .filter((binding) => binding.target === target)
          .map((binding) => {
            const copy = {
              ...binding,
              environment: 'FORMAL' as const,
              baseToken: `fakeformal${target}`,
            };
            const state = gateway.tables.get(`${binding.baseToken}:${binding.tableId}`)!;
            gateway.tables.set(`${copy.baseToken}:${copy.tableId}`, {
              table: { ...state.table },
              fields: [...state.fields],
              rows: new Map(),
            });
            return copy;
          });
        await new FeishuBindingService(db).savePrepared(group);
      }
      const ring = await variant();
      const watch = await variant('WATCH');
      const batch = await inventory.applyMovementBatch(
        {
          businessNumber: `FORMAL-FAKE-${randomUUID()}`,
          source: 'ADMIN_INBOUND',
          lines: [ring, watch].map((item) => ({
            warehouseId,
            variantId: item.id,
            quantityDelta: 1,
            type: 'INBOUND' as const,
          })),
        },
        randomUUID(),
      );
      const formal = new FeishuSyncService(db, gateway, {
        environment: 'FORMAL',
        mode: 'ACTIVE',
        now: () => now,
      });
      await expect(formal.runOnce(batch.outboxJobId)).rejects.toThrow('SYNC_BINDING_INVALID');
      expect(await db.outboxJob.findUnique({ where: { id: batch.outboxJobId } })).toMatchObject({
        status: 'PENDING',
      });
      // Activation here is synthetic fixture setup, never a formal Base operation.
      await db.feishuTableBinding.updateMany({
        where: { environment: 'FORMAL' },
        data: { status: 'ACTIVE' },
      });
      const state = gateway.tables.get('fakeformalRING_BASE:tblRING_BASEBALANCE')!;
      state.fields = state.fields.map((field) =>
        field.fieldId === 'fldquantity' ? { ...field, type: 'formula' } : field,
      );
      expect(await formal.runOnce(batch.outboxJobId)).toMatchObject({ manualReview: 1 });
      expect(await balance(watch.id)).toMatchObject({
        confirmedFeishuQuantity: 1,
        pendingMovementDelta: 0,
      });
      expect(await balance(ring.id)).toMatchObject({
        confirmedFeishuQuantity: 0,
        pendingMovementDelta: 1,
      });
      expect(
        await db.adminTask.findUnique({
          where: { deduplicationKey: `sync:${batch.outboxJobId}:RING_BASE` },
        }),
      ).toMatchObject({ status: 'OPEN', detail: { code: 'SYNC_BINDING_INVALID' } });
    });

    it('enforces administrator permissions, audit idempotency and safe projections', async () => {
      const admin = new FeishuSyncAdminService(db);
      const denied = { ...actor, roles: ['WAREHOUSE_ADMIN'] as SessionPrincipal['roles'] };
      for (const read of [
        () => admin.jobs({}, denied),
        () => admin.bindings(denied),
        () => admin.reconciliations({}, denied),
        () => admin.migrations(denied),
      ]) {
        await expect(read()).rejects.toThrow('FORBIDDEN_ROLE');
      }
      expect(() => admin.runReconciliation({}, randomUUID(), denied)).toThrow('FORBIDDEN_ROLE');
      const key = randomUUID();
      const a = await admin.runReconciliation({ target: 'WATCH_BASE' }, key, actor);
      const b = await admin.runReconciliation({ target: 'WATCH_BASE' }, key, actor);
      expect(b).toEqual(a);
      await expect(admin.runReconciliation({ target: 'RING_BASE' }, key, actor)).rejects.toThrow(
        'IDEMPOTENCY_CONFLICT',
      );
      expect(
        await db.auditLog.count({
          where: { entityId: a.jobId, action: 'FEISHU_RECONCILIATION_REQUESTED' },
        }),
      ).toBe(1);
      await db.outboxJob.update({
        where: { id: a.jobId },
        data: {
          lastError: 'secret-provider-output',
          lastErrorCode: 'raw-provider-token',
          status: 'MANUAL_REVIEW',
        },
      });
      const result = await admin.job(a.jobId, actor);
      expect(JSON.stringify(result)).not.toContain('secret-provider-output');
      expect(JSON.stringify(result)).not.toContain('raw-provider-token');
      expect(JSON.stringify(await admin.bindings(actor))).not.toContain('baseToken');
      expect(
        (await admin.jobs({ target: 'WATCH_BASE', status: 'MANUAL_REVIEW', limit: 1 }, actor))
          .items,
      ).toHaveLength(1);
    });
  },
);
