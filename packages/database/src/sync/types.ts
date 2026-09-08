import { createHash } from 'node:crypto';
import type {
  FeishuBindingEnvironment,
  FeishuTableKind,
  OutboxStepTarget,
} from '@glorychips/contracts';

export type FeishuCellValue = string | number | boolean | null | readonly unknown[];
export type FeishuFields = Readonly<Record<string, FeishuCellValue>>;

export interface FeishuTableCoordinate {
  readonly baseToken: string;
  readonly tableId: string;
}

export interface FeishuRecord {
  readonly recordId: string;
  readonly fields: FeishuFields;
}

export interface FeishuField {
  readonly fieldId: string;
  readonly name: string;
  readonly type: string;
  readonly isPrimary?: boolean;
  readonly property?: Readonly<Record<string, unknown>>;
}

export const feishuSchemaFingerprint = (fields: readonly FeishuField[]): string =>
  createHash('sha256')
    .update(
      JSON.stringify(
        [...fields]
          .sort((a, b) => a.fieldId.localeCompare(b.fieldId))
          .map(({ fieldId, name, type }) => ({ fieldId, name, type })),
      ),
    )
    .digest('hex');

export interface FeishuTable {
  readonly tableId: string;
  readonly name: string;
  readonly revision?: number;
  readonly recordCount?: number;
}

export interface FeishuRecordPage {
  readonly records: readonly FeishuRecord[];
  readonly hasMore: boolean;
  readonly pageToken?: string;
}

/** All filters use real field IDs. Adapters must fetch every search page. */
export interface FeishuBaseGateway {
  listTables(baseToken: string): Promise<readonly FeishuTable[]>;
  createTable(
    baseToken: string,
    name: string,
    fields?: readonly Omit<FeishuField, 'fieldId'>[],
  ): Promise<FeishuTable>;
  listFields(table: FeishuTableCoordinate): Promise<readonly FeishuField[]>;
  createField(
    table: FeishuTableCoordinate,
    field: Omit<FeishuField, 'fieldId'>,
  ): Promise<FeishuField>;
  listRecords(table: FeishuTableCoordinate, pageToken?: string): Promise<FeishuRecordPage>;
  findRecords(
    table: FeishuTableCoordinate,
    fieldId: string,
    value: string,
  ): Promise<readonly FeishuRecord[]>;
  getRecord(table: FeishuTableCoordinate, recordId: string): Promise<FeishuRecord | null>;
  createRecords(
    table: FeishuTableCoordinate,
    records: readonly FeishuFields[],
  ): Promise<readonly FeishuRecord[]>;
  updateRecord(
    table: FeishuTableCoordinate,
    recordId: string,
    fields: FeishuFields,
  ): Promise<FeishuRecord>;
}

export type FeishuGatewayFailureKind = 'retryable' | 'uncertain' | 'permanent';

/** Message is deliberately a fixed code, never raw CLI output. */
export class FeishuGatewayError extends Error {
  public constructor(
    public readonly code: string,
    public readonly kind: FeishuGatewayFailureKind,
    public readonly writeOutcome: 'unknown' | 'not-applied' = 'unknown',
  ) {
    super(code);
    this.name = 'FeishuGatewayError';
  }
}

export interface PreparedFeishuBinding extends FeishuTableCoordinate {
  readonly target: OutboxStepTarget;
  readonly environment: FeishuBindingEnvironment;
  readonly kind: FeishuTableKind;
  readonly schemaVersion: number;
  readonly schemaFingerprint: string;
  /** Semantic names (stableKey, quantity, ...) to verified remote field IDs. */
  readonly fieldIds: Readonly<Record<string, string>>;
}

export interface FeishuSyncOptions {
  readonly environment: FeishuBindingEnvironment;
  readonly mode: 'TEST' | 'MIGRATION_SHADOW' | 'ACTIVE';
  readonly migrationBatchId?: string;
  readonly workerId?: string;
  readonly leaseMs?: number;
  readonly maxAttempts?: number;
  readonly retryBaseMs?: number;
  readonly retryMaxMs?: number;
  readonly transactionTimeoutMs?: number;
  readonly now?: () => Date;
  readonly random?: () => number;
}

export interface FeishuSyncRunResult {
  readonly claimed: number;
  readonly succeeded: number;
  readonly retried: number;
  readonly manualReview: number;
}
