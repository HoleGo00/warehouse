import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildMigrationPlan } from './migration-plan.js';
import {
  legacySourceTables,
  sealSnapshot,
  snapshotTable,
  validateSnapshot,
} from './migration-snapshot.js';
import type { FeishuField, FeishuFields } from './types.js';

const reviewedEmptyRecord = {
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
};

async function fixture() {
  const root = new URL('../../test/fixtures/feishu-migration/', import.meta.url);
  const tables = [];
  for (const source of legacySourceTables) {
    const file = `${source.target === 'RING_BASE' ? 'ring' : 'watch'}-${source.kind === 'LEDGER' ? 'balance' : source.kind.toLowerCase()}`;
    const manifest = JSON.parse(await readFile(new URL(`${file}.manifest.json`, root), 'utf8')) as {
      rev: number;
      columns: Record<string, { field_id?: string; field_type?: string }>;
    };
    const fields: FeishuField[] = Object.entries(manifest.columns).flatMap(([name, column]) =>
      column.field_id && column.field_type
        ? [{ name, fieldId: column.field_id, type: column.field_type }]
        : [],
    );
    const records = (await readFile(new URL(`${file}.ndjson`, root), 'utf8'))
      .trim()
      .split(/\r?\n/)
      .map((line) => {
        const record = JSON.parse(line) as FeishuFields & { record_id: string };
        return {
          recordId: record.record_id,
          fields: Object.fromEntries(
            fields.map((field) => [field.fieldId, record[field.name] ?? null]),
          ),
        };
      });
    tables.push(snapshotTable(source, manifest.rev, fields, records, 1));
  }
  return sealSnapshot(tables, new Date('2026-09-04T00:00:00Z'));
}

describe('historical migration transformation', () => {
  async function withReviewedRow(
    record: { recordId: string; fields: FeishuFields } = structuredClone(reviewedEmptyRecord),
  ) {
    const snapshot = await fixture();
    const index = snapshot.tables.findIndex(
      (table) => table.source.target === 'RING_BASE' && table.source.kind === 'OUTBOUND',
    );
    const table = snapshot.tables[index]!;
    snapshot.tables[index] = snapshotTable(
      table.source,
      table.revision,
      table.fields,
      [...table.records, record],
      table.pageCount,
    );
    return sealSnapshot(snapshot.tables, new Date('2026-09-08T09:00:00Z'));
  }

  it('reports only the reviewed accidental row without changing movements, balances or its date', async () => {
    const original = buildMigrationPlan(await fixture());
    const snapshot = await withReviewedRow();
    const before = structuredClone(snapshot);
    const plan = buildMigrationPlan(snapshot);
    expect(plan.summary).toEqual({
      ...original.summary,
      sourceRecords: 716,
      ignoredBlankRows: 11,
    });
    expect(plan.balances).toEqual(original.balances);
    expect(plan.plannedBatches).toBe(original.plannedBatches);
    expect(plan.rows.find((row) => row.recordId === reviewedEmptyRecord.recordId)).toMatchObject({
      variantKey: null,
      quantity: 0,
      occurredAt: '2026-09-07T16:00:00.000Z',
    });
    expect(plan.anomalies).toContainEqual({
      code: 'USER_CONFIRMED_EMPTY_ROW',
      blocking: false,
      sourceKey: 'source:RING_BASE:tblpctHbFSnU7Dvp:recvuAsBLXpK1h:OUTBOUND',
      reviewedRecordHash: '271d076e518126a26b58ac1d92971869489ed1c5115ab57e6a36cc95e1eacc5f',
    });
    expect(snapshot).toEqual(before);
  });

  it('does not exempt another date-only row with the same contents', async () => {
    const plan = buildMigrationPlan(
      await withReviewedRow({ ...structuredClone(reviewedEmptyRecord), recordId: 'recUnreviewed' }),
    );
    expect(plan.anomalies).toContainEqual({
      code: 'MISSING_REQUIRED_VALUE',
      blocking: true,
      sourceKey: 'source:RING_BASE:tblpctHbFSnU7Dvp:recUnreviewed:OUTBOUND',
    });
  });

  it.each([
    ['fldUyCtwCE', '2026-09-09T00:00:00.000+08:00'],
    ['fldh6bCVIu', 1],
    ['fldCyVySwb', '昆仑款'],
    ['fldtu53q1K', '6#'],
    ['fld7aWOhwm', 'test-claimant'],
    ['fldwVeNWDo', 'test-destination'],
    ['unexpectedField', 'new-content'],
  ])('voids the empty-row exception when %s changes', async (field, value) => {
    const record = {
      ...reviewedEmptyRecord,
      fields: { ...reviewedEmptyRecord.fields, [field]: value },
    };
    const plan = buildMigrationPlan(await withReviewedRow(record));
    expect(plan.summary.blockingIssues).toBeGreaterThan(0);
    expect(plan.anomalies.some((anomaly) => anomaly.code === 'USER_CONFIRMED_EMPTY_ROW')).toBe(
      false,
    );
  });

  it('processes a subsequently completed reviewed record normally rather than hiding its quantity', async () => {
    const record = {
      ...reviewedEmptyRecord,
      fields: {
        ...reviewedEmptyRecord.fields,
        fldCyVySwb: '昆仑款',
        fldtu53q1K: '6#',
        fldh6bCVIu: 1,
      },
    };
    const plan = buildMigrationPlan(await withReviewedRow(record));
    expect(plan.rows.find((row) => row.recordId === record.recordId)).toMatchObject({
      variantKey: 'RING_BUSINESS_ELITE_KUNLUN_GREY:6#',
      quantity: 1,
    });
    expect(plan.summary.movements).toBe(674);
    expect(plan.anomalies.some((anomaly) => anomaly.code === 'USER_CONFIRMED_EMPTY_ROW')).toBe(
      false,
    );
    expect(plan.anomalies.some((anomaly) => anomaly.code === 'LEDGER_MISMATCH')).toBe(true);
  });

  it('recalculates all 715 source rows, historical watches and the 24 new issues without hardcoded totals', async () => {
    const snapshot = await fixture();
    const plan = buildMigrationPlan(snapshot);
    expect(plan.summary).toEqual({
      sourceRecords: 715,
      movements: 673,
      ledgerRows: 32,
      ignoredBlankRows: 10,
      blockingIssues: 0,
      targets: {
        RING_BASE: { inbound: 2984, outbound: 866, balance: 2118 },
        WATCH_BASE: { inbound: 326, outbound: 61, balance: 265 },
      },
    });
    expect(
      plan.balances
        .filter((balance) => balance.variantKey.startsWith('WATCH_HISTORICAL_'))
        .map((balance) => balance.quantity)
        .sort((a, b) => a - b),
    ).toEqual([27, 42, 68]);
    const originalExport = await readFile(
      new URL('../../test/fixtures/feishu-migration/ring-outbound.ndjson', import.meta.url),
      'utf8',
    );
    const addedIds = new Set(
      originalExport
        .trim()
        .split(/\r?\n/)
        .slice(523)
        .map((line) => (JSON.parse(line) as { record_id: string }).record_id),
    );
    const additions = plan.rows.filter(
      (row) => row.target === 'RING_BASE' && row.kind === 'OUTBOUND' && addedIds.has(row.recordId),
    );
    expect(additions).toHaveLength(24);
    expect(additions.reduce((sum, row) => sum + row.quantity, 0)).toBe(38);
    expect(additions.every((row) => row.businessKind === null)).toBe(true);
    expect(plan.anomalies.filter((item) => item.code === 'NEGATIVE_LEGACY_BALANCE')).toHaveLength(
      2,
    );
    expect(
      plan.balances
        .filter((balance) => balance.quantity < 0)
        .map((balance) => balance.quantity)
        .sort(),
    ).toEqual([-1, -4]);
  });
  it('rejects modified snapshot contents and duplicate or incomplete source identities', async () => {
    const snapshot = await fixture();
    snapshot.tables[0]!.records.pop();
    expect(() => validateSnapshot(snapshot)).toThrow('MIGRATION_REVISION_CHANGED');
    const complete = await fixture();
    expect(() =>
      sealSnapshot([...complete.tables.slice(0, 5), complete.tables[0]!], new Date()),
    ).toThrow('MIGRATION_REVISION_CHANGED');
  });
  it('blocks unknown products and per-variant ledger differences instead of silently correcting them', async () => {
    const snapshot = await fixture();
    const table = snapshot.tables[0]!;
    const name = table.fields.find((field) => field.name === table.source.columns.name)!;
    table.records[0]!.fields[name.fieldId] = ['Unapproved product'];
    snapshot.tables[0] = snapshotTable(
      table.source,
      table.revision,
      table.fields,
      table.records,
      1,
    );
    const plan = buildMigrationPlan(sealSnapshot(snapshot.tables, new Date()));
    expect(plan.anomalies.some((item) => item.code === 'UNKNOWN_PRODUCT' && item.blocking)).toBe(
      true,
    );
    expect(plan.anomalies.some((item) => item.code === 'LEDGER_MISMATCH' && item.blocking)).toBe(
      true,
    );
  });
  it('retains missing timestamps and distinguishes empty rows from malformed multi-select values', async () => {
    const snapshot = await fixture();
    const table = snapshot.tables[0]!;
    const date = table.fields.find((field) => field.name === table.source.columns.occurredAt)!;
    table.records[0]!.fields[date.fieldId] = null;
    snapshot.tables[0] = snapshotTable(
      table.source,
      table.revision,
      table.fields,
      table.records,
      1,
    );
    const plan = buildMigrationPlan(sealSnapshot(snapshot.tables, new Date()));
    expect(plan.summary.blockingIssues).toBe(0);
    expect(
      plan.rows.find(
        (row) => row.recordId === table.records[0]!.recordId && row.kind === 'INBOUND',
      )!.occurredAt,
    ).toBeNull();
    table.records[0]!.fields[date.fieldId] = ['2026-01-01', '2026-01-02'];
    snapshot.tables[0] = snapshotTable(
      table.source,
      table.revision,
      table.fields,
      table.records,
      1,
    );
    expect(
      buildMigrationPlan(sealSnapshot(snapshot.tables, new Date())).anomalies.some(
        (item) => item.code === 'INVALID_DATE',
      ),
    ).toBe(true);
  });
});
