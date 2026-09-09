import { catalogRingSizes, productCatalog } from '@glorychips/contracts';
import type {
  MigrationSnapshot,
  MigrationSnapshotTable,
  OutboxStepTarget,
} from '@glorychips/contracts';
import { hashCommand } from '../inventory/stable-json.js';
import { validateSnapshot } from './migration-snapshot.js';
import type { FeishuCellValue } from './types.js';

export const migrationBatchSize = 20;
export const migrationCatalogShape = {
  product: productCatalog.length,
  balance:
    2 *
    productCatalog.reduce(
      (sum, product) =>
        sum + (product.specificationMode === 'RING_SIZE' ? catalogRingSizes.length : 1),
      0,
    ),
};

export interface MigrationSourceRow {
  target: OutboxStepTarget;
  tableId: string;
  recordId: string;
  kind: 'INBOUND' | 'OUTBOUND' | 'LEDGER';
  key: string;
  sourceHash: string;
  variantKey: string | null;
  sourceName: string | null;
  quantity: number;
  occurredAt: string | null;
  businessKind: string | null;
  inbound: number | null;
  outbound: number | null;
}
export interface MigrationAnomaly {
  code: string;
  blocking: boolean;
  sourceKey?: string;
  variantKey?: string;
  reviewedRecordHash?: string;
}
export interface MigrationPlan {
  fingerprint: string;
  rows: MigrationSourceRow[];
  anomalies: MigrationAnomaly[];
  plannedBatches: number;
  balances: {
    variantKey: string;
    target: OutboxStepTarget;
    quantity: number;
    inbound: number;
    outbound: number;
  }[];
  summary: {
    sourceRecords: number;
    movements: number;
    ledgerRows: number;
    ignoredBlankRows: number;
    blockingIssues: number;
    targets: Record<OutboxStepTarget, { inbound: number; outbound: number; balance: number }>;
  };
}

function scalar(value: FeishuCellValue | undefined): string | null {
  if (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  )
    return null;
  if (Array.isArray(value) && value.length === 1) return scalar(value[0] as FeishuCellValue);
  if (typeof value === 'string') return value;
  throw new Error('INVALID_TEXT');
}

function integer(value: FeishuCellValue | undefined, nullable = false): number | null {
  if (nullable && (value === undefined || value === null || value === '')) return null;
  const result =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^-?\d+$/.test(value)
        ? Number(value)
        : NaN;
  if (!Number.isSafeInteger(result) || result < -2_147_483_648 || result > 2_147_483_647)
    throw new Error('INVALID_QUANTITY');
  return result;
}

function isReviewedEmptyRecord(
  table: MigrationSnapshotTable,
  record: MigrationSnapshotTable['records'][number],
): boolean {
  // User confirmed this accidental row on 2026-09-08; any content change voids the exception.
  return (
    table.source.baseToken === 'PTPhb4v7waNskrskwCTccQpJnXc' &&
    table.source.target === 'RING_BASE' &&
    table.source.tableId === 'tblpctHbFSnU7Dvp' &&
    table.source.kind === 'OUTBOUND' &&
    record.recordId === 'recvuAsBLXpK1h' &&
    hashCommand(record.fields) ===
      '271d076e518126a26b58ac1d92971869489ed1c5115ab57e6a36cc95e1eacc5f'
  );
}

function recordRow(
  table: MigrationSnapshotTable,
  record: MigrationSnapshotTable['records'][number],
): MigrationSourceRow {
  const { source } = table;
  const read = (key: keyof typeof source.columns) => {
    const name = source.columns[key];
    if (!name) return null;
    const matches = table.fields.filter((field) => field.name === name);
    if (matches.length !== 1) throw new Error('INVALID_SOURCE_SCHEMA');
    return record.fields[matches[0]!.fieldId] ?? null;
  };
  const sourceName = scalar(read('name'));
  const size = scalar(read('size'));
  const businessKind = scalar(read('businessKind'));
  const rawDate = read('occurredAt');
  let occurredAt: string | null = null;
  if (rawDate !== null && rawDate !== '') {
    if (
      typeof rawDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(rawDate) ||
      !Number.isFinite(Date.parse(rawDate))
    )
      throw new Error('INVALID_DATE');
    occurredAt = new Date(rawDate).toISOString();
  }
  const quantity = integer(read('quantity'), true);
  const inbound = integer(read('inbound'), true);
  const outbound = integer(read('outbound'), true);
  const blank =
    sourceName === null &&
    size === null &&
    businessKind === null &&
    (occurredAt === null || isReviewedEmptyRecord(table, record)) &&
    (quantity === null || quantity === 0) &&
    (inbound === null || inbound === 0) &&
    (outbound === null || outbound === 0);
  let variantKey: string | null = null;
  if (!blank) {
    if (sourceName === null || quantity === null) throw new Error('MISSING_REQUIRED_VALUE');
    const products = productCatalog.filter(
      (product) =>
        `${product.baseTarget}_BASE` === source.target &&
        (product.name === sourceName || product.aliases.includes(sourceName)),
    );
    if (products.length !== 1) throw new Error('UNKNOWN_PRODUCT');
    const product = products[0]!;
    if (
      product.specificationMode === 'RING_SIZE' &&
      (!size || !(catalogRingSizes as readonly string[]).includes(size))
    )
      throw new Error('INVALID_SIZE');
    if (product.specificationMode === 'NONE' && size !== null) throw new Error('INVALID_SIZE');
    variantKey = `${product.code}:${size ?? 'NONE'}`;
    if (source.kind !== 'LEDGER' && quantity < 0) throw new Error('NEGATIVE_MOVEMENT_QUANTITY');
    if (
      source.kind === 'LEDGER' &&
      (inbound === null || outbound === null || inbound < 0 || outbound < 0)
    )
      throw new Error('INVALID_LEDGER_TOTALS');
  }
  const values = { sourceName, size, quantity, occurredAt, businessKind, inbound, outbound };
  return {
    target: source.target,
    kind: source.kind,
    tableId: source.tableId,
    recordId: record.recordId,
    key: `source:${source.target}:${source.tableId}:${record.recordId}:${source.kind}`,
    // Derived lookup values outside the migration columns are not business edits.
    sourceHash: hashCommand(values),
    variantKey,
    sourceName,
    quantity: quantity ?? 0,
    occurredAt,
    businessKind,
    inbound,
    outbound,
  };
}

export function buildMigrationPlan(input: MigrationSnapshot): MigrationPlan {
  const snapshot = validateSnapshot(input);
  const rows: MigrationSourceRow[] = [];
  const anomalies: MigrationAnomaly[] = [];
  for (const table of snapshot.tables) {
    for (const record of table.records) {
      const sourceKey = `source:${table.source.target}:${table.source.tableId}:${record.recordId}:${table.source.kind}`;
      try {
        const row = recordRow(table, record);
        rows.push(row);
        if (!row.variantKey && isReviewedEmptyRecord(table, record))
          anomalies.push({
            code: 'USER_CONFIRMED_EMPTY_ROW',
            blocking: false,
            sourceKey,
            reviewedRecordHash: hashCommand(record.fields),
          });
        else if (!row.variantKey)
          anomalies.push({ code: 'BLANK_ZERO_ROW', blocking: false, sourceKey });
        else if (row.kind !== 'LEDGER' && row.quantity === 0)
          anomalies.push({ code: 'ZERO_MOVEMENT', blocking: false, sourceKey });
        else if (row.kind !== 'LEDGER' && row.occurredAt === null)
          anomalies.push({ code: 'MISSING_DATE', blocking: false, sourceKey });
      } catch (error) {
        anomalies.push({
          code: error instanceof Error ? error.message : 'INVALID_SOURCE_ROW',
          blocking: true,
          sourceKey,
        });
      }
    }
  }
  const balances: MigrationPlan['balances'] = [];
  for (const variantKey of [
    ...new Set(rows.flatMap((row) => (row.variantKey ? [row.variantKey] : []))),
  ].sort()) {
    const group = rows.filter((row) => row.variantKey === variantKey);
    const ledgers = group.filter((row) => row.kind === 'LEDGER');
    const inbound = group
      .filter((row) => row.kind === 'INBOUND')
      .reduce((sum, row) => sum + row.quantity, 0);
    const outbound = group
      .filter((row) => row.kind === 'OUTBOUND')
      .reduce((sum, row) => sum + row.quantity, 0);
    if (ledgers.length !== 1) {
      anomalies.push({
        code: ledgers.length ? 'DUPLICATE_LEDGER' : 'MISSING_LEDGER',
        blocking: true,
        variantKey,
      });
      continue;
    }
    const ledger = ledgers[0]!;
    if (
      ledger.quantity !== inbound - outbound ||
      ledger.inbound !== inbound ||
      ledger.outbound !== outbound
    ) {
      anomalies.push({ code: 'LEDGER_MISMATCH', blocking: true, variantKey });
    }
    if (ledger.quantity < 0)
      anomalies.push({ code: 'NEGATIVE_LEGACY_BALANCE', blocking: false, variantKey });
    balances.push({
      variantKey,
      target: ledger.target,
      quantity: ledger.quantity,
      inbound,
      outbound,
    });
  }
  const targets = {
    RING_BASE: { inbound: 0, outbound: 0, balance: 0 },
    WATCH_BASE: { inbound: 0, outbound: 0, balance: 0 },
  };
  for (const balance of balances) {
    const total = targets[balance.target];
    total.inbound += balance.inbound;
    total.outbound += balance.outbound;
    total.balance += balance.quantity;
  }
  return {
    fingerprint: snapshot.fingerprint,
    rows,
    anomalies,
    plannedBatches: balances.reduce(
      (sum, balance) =>
        sum +
        Math.ceil(
          rows.filter(
            (row) =>
              row.variantKey === balance.variantKey && row.kind !== 'LEDGER' && row.quantity !== 0,
          ).length / migrationBatchSize,
        ),
      0,
    ),
    balances,
    summary: {
      sourceRecords: snapshot.tables.reduce((sum, table) => sum + table.records.length, 0),
      movements: rows.filter((row) => row.variantKey && row.kind !== 'LEDGER' && row.quantity !== 0)
        .length,
      ledgerRows: rows.filter((row) => row.variantKey && row.kind === 'LEDGER').length,
      ignoredBlankRows: rows.filter((row) => !row.variantKey).length,
      blockingIssues: anomalies.filter((anomaly) => anomaly.blocking).length,
      targets,
    },
  };
}

export const migrationRowOrder = (a: MigrationSourceRow, b: MigrationSourceRow): number =>
  (a.occurredAt ?? '9999').localeCompare(b.occurredAt ?? '9999') ||
  Number(a.kind === 'OUTBOUND') - Number(b.kind === 'OUTBOUND') ||
  a.key.localeCompare(b.key);
