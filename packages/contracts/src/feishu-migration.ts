import { z } from 'zod';
import { feishuFieldsSchema, migrationModeSchema } from './feishu-sync.js';
import { outboxStepTargetSchema } from './enums.js';

export const migrationSourceKindSchema = z.enum(['INBOUND', 'OUTBOUND', 'LEDGER']);
export const migrationSourceTableSchema = z.object({
  target: outboxStepTargetSchema,
  kind: migrationSourceKindSchema,
  baseToken: z.string().regex(/^[A-Za-z0-9]+$/),
  tableId: z.string().regex(/^tbl[A-Za-z0-9]+$/),
  name: z.string().min(1),
  columns: z.object({
    name: z.string().min(1),
    size: z.string().min(1).optional(),
    quantity: z.string().min(1),
    occurredAt: z.string().min(1).optional(),
    businessKind: z.string().min(1).optional(),
    inbound: z.string().min(1).optional(),
    outbound: z.string().min(1).optional(),
  }),
});
export type MigrationSourceTable = z.infer<typeof migrationSourceTableSchema>;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const migrationSnapshotTableSchema = z.object({
  source: migrationSourceTableSchema,
  revision: z.number().int().nonnegative(),
  fields: z
    .array(
      z.object({
        fieldId: z.string().min(1),
        name: z.string().min(1),
        type: z.string().min(1),
        isPrimary: z.boolean().optional(),
        property: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(1),
  records: z.array(z.object({ recordId: z.string().min(1), fields: feishuFieldsSchema })),
  pageCount: z.number().int().positive(),
  hasMore: z.literal(false),
  schemaHash: sha256,
  recordIdHash: sha256,
  contentHash: sha256,
});
export const migrationSnapshotSchema = z.object({
  version: z.literal(1),
  capturedAt: z.iso.datetime(),
  tables: z.array(migrationSnapshotTableSchema).length(6),
  fingerprint: sha256,
});
export type MigrationSnapshot = z.infer<typeof migrationSnapshotSchema>;
export type MigrationSnapshotTable = z.infer<typeof migrationSnapshotTableSchema>;

export const migrationApplyOptionsSchema = z.object({
  batchKey: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/),
  mode: migrationModeSchema.exclude(['DRY_RUN']),
  expectedFingerprint: sha256,
  freezeConfirmedAt: z.iso.datetime().optional(),
  operator: z.string().trim().min(1).max(80),
});
export type MigrationApplyOptions = z.infer<typeof migrationApplyOptionsSchema>;
