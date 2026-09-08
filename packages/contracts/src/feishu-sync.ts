import { z } from 'zod';
import {
  outboxJobTypeSchema,
  outboxStatusSchema,
  outboxStepStatusSchema,
  outboxStepTargetSchema,
  reconciliationStatusSchema,
  warehouseCodeSchema,
} from './enums.js';

export const feishuBindingEnvironmentSchema = z.enum(['TEST', 'FORMAL']);
export type FeishuBindingEnvironment = z.infer<typeof feishuBindingEnvironmentSchema>;
export const feishuTableKindSchema = z.enum(['PRODUCT', 'BALANCE', 'MOVEMENT']);
export const feishuFieldIdsSchema = z.record(z.string(), z.string().min(1));
export const feishuFieldsSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.unknown())]),
);
export const syncJobIdSchema = z.uuid();
export type FeishuTableKind = z.infer<typeof feishuTableKindSchema>;
export const feishuBindingStatusSchema = z.enum(['PREPARED', 'ACTIVE', 'ROLLED_BACK']);
export const migrationModeSchema = z.enum(['DRY_RUN', 'TEST', 'FORMAL_SHADOW', 'FINAL_DELTA']);
export const migrationStatusSchema = z.enum([
  'PLANNED',
  'RUNNING',
  'RECONCILING',
  'SUCCEEDED',
  'FAILED',
]);
export const syncErrorCodes = [
  'SYNC_JOB_NOT_FOUND',
  'SYNC_STATE_CONFLICT',
  'SYNC_BINDING_INVALID',
  'SYNC_REMOTE_CONFLICT',
  'SYNC_REMOTE_UNCERTAIN',
  'SYNC_ORDER_BLOCKED',
  'SYNC_LEASE_LOST',
  'SYNC_REMOTE_UNAVAILABLE',
  'SYNC_LOCAL_INVARIANT',
  'MIGRATION_REVISION_CHANGED',
  'MIGRATION_FREEZE_REQUIRED',
] as const;
export const syncErrorCodeSchema = z.enum(syncErrorCodes);
export type SyncErrorCode = z.infer<typeof syncErrorCodeSchema>;

const limitSchema = z.coerce.number().int().min(1).max(200).default(50);
const safeError = z.string().max(160).nullable();
export const syncJobsQuerySchema = z.object({
  target: outboxStepTargetSchema.optional(),
  status: outboxStatusSchema.optional(),
  limit: limitSchema,
});
export type SyncJobsQuery = z.infer<typeof syncJobsQuerySchema>;
export const syncStepSchema = z.object({
  id: z.uuid(),
  target: outboxStepTargetSchema,
  status: outboxStepStatusSchema,
  attempts: z.number().int().nonnegative(),
  availableAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  lastErrorCode: safeError,
  lastError: safeError,
});
export const syncJobSchema = z.object({
  id: z.uuid(),
  type: outboxJobTypeSchema,
  businessNumber: z.string(),
  status: outboxStatusSchema,
  attempts: z.number().int().nonnegative(),
  availableAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  lastErrorCode: safeError,
  lastError: safeError,
  steps: z.array(syncStepSchema),
  canRetry: z.boolean(),
});
export const syncJobsResponseSchema = z.object({ items: z.array(syncJobSchema) });
export const syncJobResponseSchema = z.object({ job: syncJobSchema });
export type SyncJobsResponse = z.infer<typeof syncJobsResponseSchema>;
export type SyncJobResponse = z.infer<typeof syncJobResponseSchema>;
export type SyncJob = z.infer<typeof syncJobSchema>;
export const retrySyncJobSchema = z.object({
  target: outboxStepTargetSchema.optional(),
  reason: z.string().trim().min(1).max(500),
});
export type RetrySyncJob = z.infer<typeof retrySyncJobSchema>;

export const syncReconciliationsQuerySchema = z.object({
  target: outboxStepTargetSchema.optional(),
  warehouse: warehouseCodeSchema.optional(),
  status: reconciliationStatusSchema.optional(),
  limit: limitSchema,
});
export type SyncReconciliationsQuery = z.infer<typeof syncReconciliationsQuerySchema>;
export const runSyncReconciliationSchema = z.object({
  target: outboxStepTargetSchema.optional(),
});
export type RunSyncReconciliation = z.infer<typeof runSyncReconciliationSchema>;
export const syncReconciliationEvidenceSchema = z.object({
  remoteCount: z.number().int().nonnegative().optional(),
  validQuantity: z.boolean().optional(),
  missing: z.boolean().optional(),
});
export const syncReconciliationSchema = z.object({
  id: z.uuid(),
  target: outboxStepTargetSchema.nullable(),
  warehouse: warehouseCodeSchema,
  warehouseName: z.string(),
  variantId: z.uuid(),
  productName: z.string(),
  variantName: z.string(),
  confirmedFeishuQuantity: z.number().int(),
  pendingMovementDelta: z.number().int(),
  localEffectiveQuantity: z.number().int(),
  feishuQuantity: z.number().int().nullable(),
  difference: z.number().int().nullable(),
  remoteRecordState: z.enum(['PRESENT', 'MISSING', 'DUPLICATE', 'INVALID']).default('PRESENT'),
  status: reconciliationStatusSchema,
  checkedAt: z.iso.datetime(),
  schemaVersion: z.number().int().nullable(),
});
export const syncReconciliationsResponseSchema = z.object({
  items: z.array(syncReconciliationSchema),
});
export type SyncReconciliationsResponse = z.infer<typeof syncReconciliationsResponseSchema>;
export const runSyncReconciliationResponseSchema = z.object({ jobId: z.uuid() });
export type RunSyncReconciliationResponse = z.infer<typeof runSyncReconciliationResponseSchema>;

export const syncBindingSchema = z.object({
  id: z.uuid(),
  target: outboxStepTargetSchema,
  kind: feishuTableKindSchema,
  environment: feishuBindingEnvironmentSchema,
  status: feishuBindingStatusSchema,
  schemaVersion: z.number().int().positive(),
  schemaFingerprint: z.string(),
  preparedAt: z.iso.datetime(),
  activatedAt: z.iso.datetime().nullable(),
});
export const syncBindingsResponseSchema = z.object({ items: z.array(syncBindingSchema) });
export type SyncBindingsResponse = z.infer<typeof syncBindingsResponseSchema>;
export const migrationBatchSchema = z.object({
  id: z.uuid(),
  batchKey: z.string(),
  mode: migrationModeSchema,
  status: migrationStatusSchema,
  startedAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  lastErrorCode: safeError,
  lastError: safeError,
});
export const migrationBatchesResponseSchema = z.object({
  items: z.array(migrationBatchSchema),
});
export type MigrationBatchesResponse = z.infer<typeof migrationBatchesResponseSchema>;

export const movementOutboxPayloadSchema = z.object({
  businessNumber: z.string().min(1),
  migrationOrder: z.number().int().nonnegative().optional(),
  movementIds: z
    .array(z.uuid())
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, 'Movement IDs must be unique.'),
});
