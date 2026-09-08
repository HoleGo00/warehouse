import { feishuFieldsSchema, migrationSnapshotSchema } from '@glorychips/contracts';
import type {
  MigrationSnapshot,
  MigrationSnapshotTable,
  MigrationSourceTable,
} from '@glorychips/contracts';
import { hashCommand } from '../inventory/stable-json.js';
import { FeishuSyncError } from './errors.js';
import type { FeishuBaseGateway, FeishuField, FeishuRecord } from './types.js';

export const legacySourceTables: readonly MigrationSourceTable[] = [
  {
    target: 'RING_BASE',
    kind: 'INBOUND',
    baseToken: 'PTPhb4v7waNskrskwCTccQpJnXc',
    tableId: 'tbls2VUwY2DizYZN',
    name: '指环库存入库管理',
    columns: {
      name: '款式',
      size: '指环尺码',
      quantity: '入库数量',
      occurredAt: '入库日期',
      businessKind: '入库类型',
    },
  },
  {
    target: 'RING_BASE',
    kind: 'OUTBOUND',
    baseToken: 'PTPhb4v7waNskrskwCTccQpJnXc',
    tableId: 'tblpctHbFSnU7Dvp',
    name: '指环库存出库管理',
    columns: {
      name: '款式',
      size: '指环尺码',
      quantity: '出库数量',
      occurredAt: '出库日期',
      businessKind: '变动类型',
    },
  },
  {
    target: 'RING_BASE',
    kind: 'LEDGER',
    baseToken: 'PTPhb4v7waNskrskwCTccQpJnXc',
    tableId: 'tblu4MDtsKhQy36V',
    name: '指环库存台账',
    columns: {
      name: '款式',
      size: '指环尺码',
      quantity: '剩余库存',
      inbound: '当前累计入库数量',
      outbound: '当前累计出库数量',
    },
  },
  {
    target: 'WATCH_BASE',
    kind: 'INBOUND',
    baseToken: 'MfjUbu1MYa9x5dscz6bcs6Yinth',
    tableId: 'tblmgxPJL2I4xc0D',
    name: '入库表',
    columns: {
      name: '产品名称',
      quantity: '入库数量',
      occurredAt: '入库日期',
      businessKind: '入库类型',
    },
  },
  {
    target: 'WATCH_BASE',
    kind: 'OUTBOUND',
    baseToken: 'MfjUbu1MYa9x5dscz6bcs6Yinth',
    tableId: 'tbl7OBf9Kb6CapEm',
    name: '出库表',
    columns: {
      name: '产品名称',
      quantity: '出库数量',
      occurredAt: '出库日期',
      businessKind: '出库类型',
    },
  },
  {
    target: 'WATCH_BASE',
    kind: 'LEDGER',
    baseToken: 'MfjUbu1MYa9x5dscz6bcs6Yinth',
    tableId: 'tblAeMQHyjiZgnky',
    name: '总台账',
    columns: { name: '产品名称', quantity: '当前库存', inbound: '入库总量', outbound: '出库总量' },
  },
];

export const migrationSchemaHash = (fields: readonly FeishuField[]) =>
  hashCommand([...fields].sort((a, b) => a.fieldId.localeCompare(b.fieldId)));

export function snapshotTable(
  source: MigrationSourceTable,
  revision: number,
  fields: readonly FeishuField[],
  records: readonly FeishuRecord[],
  pageCount: number,
): MigrationSnapshotTable {
  const sorted = [...records].sort((a, b) => a.recordId.localeCompare(b.recordId));
  if (new Set(sorted.map((row) => row.recordId)).size !== sorted.length) {
    throw new FeishuSyncError('MIGRATION_REVISION_CHANGED');
  }
  return {
    source,
    revision,
    fields: structuredClone([...fields]),
    records: sorted.map((row) => ({
      recordId: row.recordId,
      fields: feishuFieldsSchema.parse(row.fields),
    })),
    pageCount,
    hasMore: false,
    schemaHash: migrationSchemaHash(fields),
    recordIdHash: hashCommand(sorted.map((row) => row.recordId)),
    contentHash: hashCommand(sorted),
  };
}

export function snapshotManifest(snapshot: Pick<MigrationSnapshot, 'tables'>) {
  return [...snapshot.tables]
    .sort((a, b) =>
      `${a.source.target}:${a.source.kind}`.localeCompare(`${b.source.target}:${b.source.kind}`),
    )
    .map((table) => ({
      source: table.source,
      revision: table.revision,
      count: table.records.length,
      schemaHash: table.schemaHash,
      recordIdHash: table.recordIdHash,
      contentHash: table.contentHash,
    }));
}

export function sealSnapshot(
  tables: MigrationSnapshotTable[],
  capturedAt: Date,
): MigrationSnapshot {
  const snapshot = {
    version: 1 as const,
    tables,
    capturedAt: capturedAt.toISOString(),
    fingerprint: hashCommand(snapshotManifest({ tables })),
  };
  return validateSnapshot(snapshot);
}

export function validateSnapshot(input: unknown): MigrationSnapshot {
  const snapshot = migrationSnapshotSchema.parse(input);
  const identities = new Set(
    snapshot.tables.map(({ source }) => `${source.target}:${source.kind}`),
  );
  const coordinates = new Set(
    snapshot.tables.map(({ source }) => `${source.baseToken}:${source.tableId}`),
  );
  if (
    identities.size !== 6 ||
    coordinates.size !== 6 ||
    snapshot.fingerprint !== hashCommand(snapshotManifest(snapshot))
  ) {
    throw new FeishuSyncError('MIGRATION_REVISION_CHANGED');
  }
  for (const table of snapshot.tables) {
    const rebuilt = snapshotTable(
      table.source,
      table.revision,
      table.fields,
      table.records,
      table.pageCount,
    );
    if (
      table.schemaHash !== rebuilt.schemaHash ||
      table.recordIdHash !== rebuilt.recordIdHash ||
      table.contentHash !== rebuilt.contentHash
    )
      throw new FeishuSyncError('MIGRATION_REVISION_CHANGED');
  }
  return snapshot;
}

export async function assertSourceFence(
  gateway: FeishuBaseGateway,
  snapshot: MigrationSnapshot,
): Promise<void> {
  validateSnapshot(snapshot);
  for (const base of new Set(snapshot.tables.map(({ source }) => source.baseToken))) {
    const tables = await gateway.listTables(base);
    for (const expected of snapshot.tables.filter(({ source }) => source.baseToken === base)) {
      const matches = tables.filter((table) => table.tableId === expected.source.tableId);
      if (
        matches.length !== 1 ||
        matches[0]!.revision !== expected.revision ||
        matches[0]!.name !== expected.source.name ||
        (matches[0]!.recordCount !== undefined &&
          matches[0]!.recordCount !== expected.records.length) ||
        migrationSchemaHash(await gateway.listFields(expected.source)) !== expected.schemaHash
      ) {
        throw new FeishuSyncError('MIGRATION_REVISION_CHANGED');
      }
    }
  }
}

export async function captureMigrationSnapshot(
  gateway: FeishuBaseGateway,
  sources: readonly MigrationSourceTable[] = legacySourceTables,
  now: () => Date = () => new Date(),
): Promise<MigrationSnapshot> {
  const tables: MigrationSnapshotTable[] = [];
  const revisions = new Map<string, number>();
  for (const base of new Set(sources.map((source) => source.baseToken))) {
    const listed = await gateway.listTables(base);
    for (const source of sources.filter((item) => item.baseToken === base)) {
      const matches = listed.filter(
        (item) => item.tableId === source.tableId && item.name === source.name,
      );
      const revision = matches[0]?.revision;
      if (matches.length !== 1 || revision === undefined)
        throw new FeishuSyncError('MIGRATION_REVISION_CHANGED');
      revisions.set(`${base}:${source.tableId}`, revision);
    }
  }
  for (const source of sources) {
    const fields = await gateway.listFields(source);
    for (const name of Object.values(source.columns)) {
      if (fields.filter((field) => field.name === name).length !== 1)
        throw new FeishuSyncError('SYNC_BINDING_INVALID');
    }
    const records: FeishuRecord[] = [];
    const seen = new Set<string>();
    let token: string | undefined;
    let pageCount = 0;
    for (;;) {
      const page = await gateway.listRecords(source, token);
      records.push(...page.records);
      pageCount++;
      if (!page.hasMore) break;
      if (
        !page.pageToken ||
        !page.records.length ||
        seen.has(page.pageToken) ||
        pageCount >= 10_000
      ) {
        throw new FeishuSyncError('MIGRATION_REVISION_CHANGED');
      }
      seen.add(page.pageToken);
      token = page.pageToken;
    }
    tables.push(
      snapshotTable(
        source,
        revisions.get(`${source.baseToken}:${source.tableId}`)!,
        fields,
        records,
        pageCount,
      ),
    );
  }
  const snapshot = sealSnapshot(tables, now());
  await assertSourceFence(gateway, snapshot);
  return snapshot;
}
