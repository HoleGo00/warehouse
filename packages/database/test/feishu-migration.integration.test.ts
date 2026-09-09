import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  catalogRingSizes,
  movementOutboxPayloadSchema,
  productCatalog,
} from '@glorychips/contracts';
import type { MigrationApplyOptions, MigrationSnapshot } from '@glorychips/contracts';
import {
  InventoryMigrationService,
  FeishuBindingService,
  captureMigrationSnapshot,
  legacySourceTables,
  buildMigrationPlan,
  assertSourceFence,
} from '../src/index.js';
import type { FeishuFields, PrismaClient } from '../src/index.js';
import { FakeFeishuGateway } from './helpers/feishu-gateway.js';
import { createIsolatedSyncDatabase } from './helpers/isolated-sync-database.js';
import { V1SchemaProvisioner } from '../../../apps/worker/src/feishu/v1-schema.js';

describe.skipIf(!process.env['DATABASE_URL'])('historical migration PostgreSQL integration', () => {
  let db: PrismaClient;
  let dispose: (() => Promise<void>) | undefined;
  let gateway: FakeFeishuGateway;
  let snapshot: MigrationSnapshot;
  let service: InventoryMigrationService;
  let options: MigrationApplyOptions;
  let now = new Date(Date.now() + 60_000);
  const sourceState = (kind: 'INBOUND' | 'OUTBOUND' | 'LEDGER', target = 'RING_BASE') => {
    const source = legacySourceTables.find(
      (table) => table.target === target && table.kind === kind,
    )!;
    return { source, state: gateway.tables.get(`${source.baseToken}:${source.tableId}`)! };
  };
  const change = (kind: 'INBOUND' | 'OUTBOUND' | 'LEDGER', column: string, value: number) => {
    const { state } = sourceState(kind);
    const row = [...state.rows.values()][0]!;
    const id = state.fields.find((field) => field.name === column)!.fieldId;
    state.rows.set(row.recordId, { ...row, fields: { ...row.fields, [id]: value } });
    state.table = { ...state.table, revision: state.table.revision! + 1 };
  };
  beforeAll(async () => {
    const isolated = await createIsolatedSyncDatabase();
    db = isolated.database;
    dispose = isolated.dispose;
    gateway = new FakeFeishuGateway();
    for (const code of ['RING_BUSINESS_ELITE_KUNLUN_GREY', 'WATCH_HISTORICAL_ROSE']) {
      const definition = productCatalog.find((product) => product.code === code)!;
      const category = await db.productCategory.findUniqueOrThrow({
        where: { code: definition.category },
      });
      const size = definition.baseTarget === 'RING' ? '6#' : null;
      await db.product.create({
        data: {
          code,
          officialName: definition.name,
          status: definition.status,
          baseTarget: definition.baseTarget,
          specificationMode: definition.specificationMode,
          categoryId: category.id,
          variants: {
            create: {
              code: size ?? 'DEFAULT',
              variantKey: `${code}:${size ?? 'NONE'}`,
              size,
              displayName: definition.name,
              specificationMode: definition.specificationMode,
              isActive: definition.status === 'ACTIVE',
            },
          },
        },
      });
    }
    for (const source of legacySourceTables) {
      const ring = source.target === 'RING_BASE';
      const reviewedFieldIds: Record<string, string> =
        ring && source.kind === 'OUTBOUND'
          ? {
              款式: 'fldCyVySwb',
              指环尺码: 'fldtu53q1K',
              出库数量: 'fldh6bCVIu',
              出库日期: 'fldUyCtwCE',
              变动类型: 'fld8T4tvsb',
            }
          : {};
      const fields = Object.values(source.columns).map((name, index) => ({
        fieldId: reviewedFieldIds[name] ?? `fldSource${index}`,
        name,
        type: 'text',
      }));
      const values: FeishuFields = {
        name: [ring ? '昆仑款' : '玫瑰'],
        size: ['6#'],
        quantity:
          source.kind === 'LEDGER'
            ? ring
              ? 10
              : 27
            : source.kind === 'INBOUND'
              ? ring
                ? 12
                : 27
              : ring
                ? 2
                : 0,
        occurredAt: '2026-06-01T00:00:00.000+08:00',
        businessKind: null,
        inbound: ring ? 12 : 27,
        outbound: ring ? 2 : 0,
      };
      const row = {
        recordId: `rec${source.kind}${ring ? 'Ring' : 'Watch'}`,
        fields: Object.fromEntries(
          Object.entries(source.columns).map(([key, name]) => [
            fields.find((field) => field.name === name)!.fieldId,
            values[key] ?? null,
          ]),
        ),
      };
      gateway.tables.set(`${source.baseToken}:${source.tableId}`, {
        table: { tableId: source.tableId, name: source.name, revision: 1 },
        fields,
        rows: new Map(source.kind === 'OUTBOUND' && !ring ? [] : [[row.recordId, row]]),
      });
    }
    sourceState('OUTBOUND').state.rows.set('recvuAsBLXpK1h', {
      recordId: 'recvuAsBLXpK1h',
      fields: {
        fldUyCtwCE: '2026-09-08T00:00:00.000+08:00',
        fld7aWOhwm: null,
        fld8T4tvsb: null,
        fldCyVySwb: null,
        fldh6bCVIu: null,
        fldhtjQ22N: '-',
        fldInlgKqP: null,
        fldlo69TAB: null,
        fldnid7Q4g: '9',
        fldtu53q1K: null,
        fldwVeNWDo: null,
      },
    });
    snapshot = await captureMigrationSnapshot(gateway, legacySourceTables, () => now);
    for (const target of ['RING_BASE', 'WATCH_BASE'] as const) {
      const bindings = await new V1SchemaProvisioner(gateway).provision(
        `test${target}`,
        target,
        'TEST',
      );
      await new FeishuBindingService(db).savePrepared(bindings);
    }
    service = new InventoryMigrationService(db, gateway, () => now);
    options = {
      batchKey: `test-${randomUUID()}`,
      mode: 'TEST',
      operator: 'integration-test',
      expectedFingerprint: snapshot.fingerprint,
    };
  }, 90_000);
  afterAll(async () => {
    await dispose?.();
  });

  it('captures every page and rejects looping pages or a revision change across the six-table scan', async () => {
    const original = gateway.listRecords.bind(gateway);
    const source = legacySourceTables[0]!;
    gateway.listRecords = async (table, token?: string) => {
      const page = await original(table);
      if (table.tableId !== source.tableId) return page;
      return !token
        ? { ...page, hasMore: true, pageToken: 'next' }
        : { records: [], hasMore: false };
    };
    const paged = await captureMigrationSnapshot(gateway, legacySourceTables, () => now);
    expect(paged.tables[0]!.pageCount).toBe(2);
    gateway.listRecords = async (table) => ({
      ...(await original(table)),
      hasMore: true,
      pageToken: 'same',
    });
    await expect(captureMigrationSnapshot(gateway)).rejects.toThrow('MIGRATION_REVISION_CHANGED');
    gateway.listRecords = original;
    const { state } = sourceState('INBOUND');
    state.table = { ...state.table, revision: 2 };
    await expect(assertSourceFence(gateway, snapshot)).rejects.toThrow(
      'MIGRATION_REVISION_CHANGED',
    );
    state.table = { ...state.table, revision: 1 };
  });
  it('imports all history only to Yuhang, materializes Xihu zero rows and reuses an identical batch', async () => {
    expect(buildMigrationPlan(snapshot).summary.blockingIssues).toBe(0);
    const result = await service.resume(snapshot, options);
    expect(result).toMatchObject({
      createdMovements: 3,
      status: 'SUCCEEDED',
      mismatches: 0,
      remoteMovements: 3,
    });
    const xihu = await db.inventoryBalance.findMany({ where: { warehouse: { code: 'XIHU' } } });
    expect(xihu).toHaveLength(2);
    expect(
      xihu.every(
        (balance) => balance.confirmedFeishuQuantity === 0 && balance.movementSequence === 0,
      ),
    ).toBe(true);
    expect(await db.inventoryMovement.count({ where: { warehouse: { code: 'XIHU' } } })).toBe(0);
    const records = gateway.creates;
    const writes = gateway.updates;
    const before = await db.inventoryBalance.findMany({ orderBy: { id: 'asc' } });
    expect(await service.resume(snapshot, options)).toMatchObject({
      createdMovements: 0,
      createdJobs: 0,
      status: 'SUCCEEDED',
      mismatches: 0,
    });
    expect(gateway.creates).toBe(records);
    expect(gateway.updates).toBe(writes);
    expect(await db.inventoryBalance.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
    expect(await db.inventoryMigrationSource.count()).toBe(5);
    expect(await db.feishuTableBinding.count({ where: { status: 'ACTIVE' } })).toBe(0);
  }, 60_000);
  it('retains the reviewed empty-row anomaly while replay produces no business writes', async () => {
    const batch = await db.inventoryMigrationBatch.findUniqueOrThrow({
      where: { batchKey: options.batchKey },
    });
    expect(batch.anomalySummary).toEqual(
      expect.arrayContaining([
        {
          code: 'USER_CONFIRMED_EMPTY_ROW',
          blocking: false,
          sourceKey: 'source:RING_BASE:tblpctHbFSnU7Dvp:recvuAsBLXpK1h:OUTBOUND',
          reviewedRecordHash: '271d076e518126a26b58ac1d92971869489ed1c5115ab57e6a36cc95e1eacc5f',
        },
      ]),
    );
    expect(
      await db.inventoryMigrationSource.count({ where: { sourceRecordId: 'recvuAsBLXpK1h' } }),
    ).toBe(0);
    const movements = await db.inventoryMovement.count();
    const jobs = await db.outboxJob.count({ where: { type: 'SYNC_INVENTORY_MOVEMENTS' } });
    const balances = await db.inventoryBalance.findMany({ orderBy: { id: 'asc' } });
    const creates = gateway.creates;
    const updates = gateway.updates;
    expect(await service.resume(snapshot, options)).toMatchObject({
      createdMovements: 0,
      createdJobs: 0,
      status: 'SUCCEEDED',
      mismatches: 0,
    });
    expect(await db.inventoryMovement.count()).toBe(movements);
    expect(await db.outboxJob.count({ where: { type: 'SYNC_INVENTORY_MOVEMENTS' } })).toBe(jobs);
    expect(await db.inventoryBalance.findMany({ orderBy: { id: 'asc' } })).toEqual(balances);
    expect(gateway.creates).toBe(creates);
    expect(gateway.updates).toBe(updates);
  }, 60_000);
  it('blocks changed or removed imported movements even if the new ledger still balances', async () => {
    change('INBOUND', '入库数量', 13);
    change('LEDGER', '剩余库存', 11);
    change('LEDGER', '当前累计入库数量', 13);
    const edited = await captureMigrationSnapshot(gateway, legacySourceTables, () => now);
    expect(buildMigrationPlan(edited).summary.blockingIssues).toBe(0);
    await expect(
      service.prepare(edited, {
        ...options,
        batchKey: 'edited-source',
        expectedFingerprint: edited.fingerprint,
      }),
    ).rejects.toThrow('MIGRATION_REVISION_CHANGED');
    expect(await db.inventoryMigrationBatch.count({ where: { batchKey: 'edited-source' } })).toBe(
      0,
    );
    change('INBOUND', '入库数量', 12);
    change('LEDGER', '剩余库存', 10);
    change('LEDGER', '当前累计入库数量', 12);
    snapshot = await captureMigrationSnapshot(gateway, legacySourceTables, () => now);
  });
  it('imports only a new source record in a later batch and records the changed ledger provenance', async () => {
    const { source, state } = sourceState('INBOUND');
    const original = [...state.rows.values()][0]!;
    const quantityId = state.fields.find(
      (field) => field.name === source.columns.quantity,
    )!.fieldId;
    state.rows.set('recLateInbound', {
      recordId: 'recLateInbound',
      fields: { ...original.fields, [quantityId]: 3 },
    });
    state.table = { ...state.table, revision: state.table.revision! + 1 };
    change('LEDGER', '剩余库存', 13);
    change('LEDGER', '当前累计入库数量', 15);
    now = new Date(now.getTime() + 1000);
    snapshot = await captureMigrationSnapshot(gateway, legacySourceTables, () => now);
    options = {
      ...options,
      batchKey: 'final-delta-test',
      expectedFingerprint: snapshot.fingerprint,
    };
    expect(await service.resume(snapshot, options)).toMatchObject({
      createdMovements: 1,
      status: 'SUCCEEDED',
      remoteMovements: 4,
      mismatches: 0,
    });
    expect(await db.auditLog.count({ where: { action: 'MIGRATION_LEDGER_REVISION' } })).toBe(1);
  }, 60_000);
  it('requires a current freeze and exact approved fingerprint for formal operations before local writes', async () => {
    const count = await db.inventoryMigrationBatch.count();
    await expect(
      service.prepare(snapshot, { ...options, batchKey: 'formal', mode: 'FORMAL_SHADOW' }),
    ).rejects.toThrow('MIGRATION_FREEZE_REQUIRED');
    await expect(
      service.prepare(snapshot, { ...options, expectedFingerprint: '0'.repeat(64) }),
    ).rejects.toThrow('MIGRATION_REVISION_CHANGED');
    await expect(
      service.prepare(snapshot, {
        ...options,
        mode: 'FORMAL_SHADOW',
        freezeConfirmedAt: new Date(now.getTime() - 3 * 3600_000).toISOString(),
      }),
    ).rejects.toThrow('MIGRATION_FREEZE_REQUIRED');
    expect(await db.inventoryMigrationBatch.count()).toBe(count);
  });
  it('processes a multi-chunk variant in recorded order rather than equal transaction timestamps or random UUIDs', async () => {
    const { source, state } = sourceState('INBOUND');
    const original = [...state.rows.values()][0]!;
    const quantityId = state.fields.find(
      (field) => field.name === source.columns.quantity,
    )!.fieldId;
    for (let index = 0; index < 45; index++) {
      const recordId = `recBulk${index}`;
      state.rows.set(recordId, { recordId, fields: { ...original.fields, [quantityId]: 1 } });
    }
    state.table = { ...state.table, revision: state.table.revision! + 1 };
    change('LEDGER', '剩余库存', 58);
    change('LEDGER', '当前累计入库数量', 60);
    snapshot = await captureMigrationSnapshot(gateway, legacySourceTables, () => now);
    options = {
      ...options,
      batchKey: 'ordered-chunks-test',
      expectedFingerprint: snapshot.fingerprint,
    };
    const prepared = await service.prepare(snapshot, options);
    expect(prepared).toMatchObject({ createdMovements: 45, createdJobs: 3 });
    const jobs = await db.outboxJob.findMany({ where: { aggregateId: prepared.batchId } });
    for (const job of jobs) {
      const order = movementOutboxPayloadSchema.parse(job.payload).migrationOrder!;
      await db.outboxJob.update({
        where: { id: job.id },
        data: { createdAt: new Date(10_000 - order * 1000) },
      });
    }
    expect(await service.resume(snapshot, options)).toMatchObject({
      status: 'SUCCEEDED',
      pendingJobs: 0,
      mismatches: 0,
      remoteMovements: 49,
    });
  }, 60_000);
  it('initializes all 84 approved variants across bounded zero-balance batches without changing history', async () => {
    for (const definition of productCatalog) {
      const category = await db.productCategory.findUniqueOrThrow({
        where: { code: definition.category },
      });
      const product = await db.product.upsert({
        where: { code: definition.code },
        update: {},
        create: {
          code: definition.code,
          officialName: definition.name,
          status: definition.status,
          categoryId: category.id,
          baseTarget: definition.baseTarget,
          specificationMode: definition.specificationMode,
        },
      });
      const sizes: readonly (string | null)[] =
        definition.specificationMode === 'RING_SIZE' ? catalogRingSizes : [null];
      for (const size of sizes) {
        await db.productVariant.upsert({
          where: { variantKey: `${product.code}:${size ?? 'NONE'}` },
          update: {},
          create: {
            productId: product.id,
            code: size ?? 'DEFAULT',
            variantKey: `${product.code}:${size ?? 'NONE'}`,
            displayName: product.officialName,
            size,
            specificationMode: definition.specificationMode,
            isActive: definition.status === 'ACTIVE',
          },
        });
      }
    }
    expect(await service.resume(snapshot, options)).toMatchObject({
      createdMovements: 0,
      status: 'SUCCEEDED',
      mismatches: 0,
      remoteMovements: 49,
    });
    expect(await db.inventoryBalance.count()).toBe(168);
    expect(
      await db.inventoryBalance.count({
        where: { warehouse: { code: 'XIHU' }, confirmedFeishuQuantity: 0, movementSequence: 0 },
      }),
    ).toBe(84);
    const creates = gateway.creates;
    const updates = gateway.updates;
    expect(await service.resume(snapshot, options)).toMatchObject({
      status: 'SUCCEEDED',
      mismatches: 0,
      createdMovements: 0,
    });
    expect(gateway.creates).toBe(creates);
    expect(gateway.updates).toBe(updates);
  }, 60_000);
});
