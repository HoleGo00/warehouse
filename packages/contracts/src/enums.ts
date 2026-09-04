import { z } from 'zod';

export const warehouseCodes = ['XIHU', 'YUHANG'] as const;
export const warehouseCodeSchema = z.enum(warehouseCodes);
export type WarehouseCode = z.infer<typeof warehouseCodeSchema>;

export const roleCodes = ['CLAIMANT', 'WAREHOUSE_ADMIN', 'SYSTEM_ADMIN'] as const;
export const roleCodeSchema = z.enum(roleCodes);
export type RoleCode = z.infer<typeof roleCodeSchema>;

export const productCategoryCodes = ['SMART_RING', 'SMART_WATCH'] as const;
export const productCategoryCodeSchema = z.enum(productCategoryCodes);
export type ProductCategoryCode = z.infer<typeof productCategoryCodeSchema>;

export const productStatuses = ['ACTIVE', 'INACTIVE', 'INACTIVE_HISTORICAL'] as const;
export const productStatusSchema = z.enum(productStatuses);
export type ProductStatus = z.infer<typeof productStatusSchema>;

export const specificationModes = ['RING_SIZE', 'NONE'] as const;
export const specificationModeSchema = z.enum(specificationModes);
export type SpecificationMode = z.infer<typeof specificationModeSchema>;

export const ringSizes = ['6#', '7#', '8#', '9#', '10#', '11#', '12#', '13#'] as const;
export const ringSizeSchema = z.enum(ringSizes);
export type RingSize = z.infer<typeof ringSizeSchema>;

export const baseTargets = ['RING', 'WATCH'] as const;
export const baseTargetSchema = z.enum(baseTargets);
export type BaseTarget = z.infer<typeof baseTargetSchema>;

export const userStatuses = ['ACTIVE', 'INACTIVE'] as const;
export const userStatusSchema = z.enum(userStatuses);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const imageKinds = ['MAIN', 'DETAIL'] as const;
export const imageKindSchema = z.enum(imageKinds);
export type ImageKind = z.infer<typeof imageKindSchema>;

export const requestOrigins = ['ONLINE', 'OFFLINE', 'EXPRESS'] as const;
export const requestOriginSchema = z.enum(requestOrigins);
export type RequestOrigin = z.infer<typeof requestOriginSchema>;

export const requestTypes = ['INTERNAL', 'GIFT', 'SALE', 'EXHIBIT'] as const;
export const requestTypeSchema = z.enum(requestTypes);
export type RequestType = z.infer<typeof requestTypeSchema>;

export const returnModes = ['NOT_REQUIRED', 'BY_DATE', 'ON_DEPARTURE'] as const;
export const returnModeSchema = z.enum(returnModes);
export type ReturnMode = z.infer<typeof returnModeSchema>;

export const requestStatuses = [
  'DRAFT',
  'PENDING_APPROVAL',
  'PENDING_RELEASE',
  'PENDING_PAPERWORK',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
] as const;
export const requestStatusSchema = z.enum(requestStatuses);
export type RequestStatus = z.infer<typeof requestStatusSchema>;

export const syncStatuses = ['NOT_REQUIRED', 'PENDING', 'SYNCED', 'FAILED'] as const;
export const syncStatusSchema = z.enum(syncStatuses);
export type SyncStatus = z.infer<typeof syncStatusSchema>;

export const approvalDecisions = ['APPROVED', 'REJECTED'] as const;
export const approvalDecisionSchema = z.enum(approvalDecisions);
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

export const fulfillmentStatuses = ['COMPLETED', 'VOIDED'] as const;
export const fulfillmentStatusSchema = z.enum(fulfillmentStatuses);
export type FulfillmentStatus = z.infer<typeof fulfillmentStatusSchema>;

export const reservationStatuses = ['ACTIVE', 'RELEASED', 'CONSUMED', 'EXPIRED'] as const;
export const reservationStatusSchema = z.enum(reservationStatuses);
export type ReservationStatus = z.infer<typeof reservationStatusSchema>;

export const inventoryMovementTypes = [
  'INBOUND',
  'ISSUE',
  'RETURN',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'STOCKTAKE_GAIN',
  'STOCKTAKE_LOSS',
  'MIGRATION_OPENING',
] as const;
export const inventoryMovementTypeSchema = z.enum(inventoryMovementTypes);
export type InventoryMovementType = z.infer<typeof inventoryMovementTypeSchema>;

export const inventoryMovementSources = [
  'ONLINE_REQUEST',
  'EXPRESS_REQUEST',
  'OFFLINE_REQUEST',
  'ADMIN_INBOUND',
  'ADMIN_RETURN',
  'ADMIN_TRANSFER',
  'ADMIN_STOCKTAKE',
  'MIGRATION',
] as const;
export const inventoryMovementSourceSchema = z.enum(inventoryMovementSources);
export type InventoryMovementSource = z.infer<typeof inventoryMovementSourceSchema>;

export const inventoryOperationTypes = ['INBOUND', 'TRANSFER', 'STOCKTAKE'] as const;
export const inventoryOperationTypeSchema = z.enum(inventoryOperationTypes);
export type InventoryOperationType = z.infer<typeof inventoryOperationTypeSchema>;

export const inventoryInboundTypes = ['PURCHASE', 'OTHER'] as const;
export const inventoryInboundTypeSchema = z.enum(inventoryInboundTypes);
export type InventoryInboundType = z.infer<typeof inventoryInboundTypeSchema>;

export const reconciliationStatuses = ['MATCHED', 'MISMATCH', 'RESOLVED'] as const;
export const reconciliationStatusSchema = z.enum(reconciliationStatuses);
export type ReconciliationStatus = z.infer<typeof reconciliationStatusSchema>;

export const returnTriggers = ['DATE', 'DEPARTURE'] as const;
export const returnTriggerSchema = z.enum(returnTriggers);
export type ReturnTrigger = z.infer<typeof returnTriggerSchema>;

export const returnStatuses = ['PENDING', 'PARTIAL', 'COMPLETED', 'WAIVED'] as const;
export const returnStatusSchema = z.enum(returnStatuses);
export type ReturnStatus = z.infer<typeof returnStatusSchema>;

export const adminTaskTypes = [
  'PAPERWORK_REQUIRED',
  'PAPERWORK_OVERDUE',
  'RETURN_DUE',
  'RETURN_OVERDUE',
  'SYNC_EXCEPTION',
] as const;
export const adminTaskTypeSchema = z.enum(adminTaskTypes);
export type AdminTaskType = z.infer<typeof adminTaskTypeSchema>;

export const adminTaskStatuses = ['OPEN', 'COMPLETED', 'DISMISSED'] as const;
export const adminTaskStatusSchema = z.enum(adminTaskStatuses);
export type AdminTaskStatus = z.infer<typeof adminTaskStatusSchema>;

export const taskSeverities = ['INFO', 'WARNING', 'CRITICAL'] as const;
export const taskSeveritySchema = z.enum(taskSeverities);
export type TaskSeverity = z.infer<typeof taskSeveritySchema>;

export const idempotencyStatuses = ['IN_PROGRESS', 'COMPLETED'] as const;
export const idempotencyStatusSchema = z.enum(idempotencyStatuses);
export type IdempotencyStatus = z.infer<typeof idempotencyStatusSchema>;

export const outboxJobTypes = ['SYNC_INVENTORY_MOVEMENTS', 'RECONCILE_INVENTORY'] as const;
export const outboxJobTypeSchema = z.enum(outboxJobTypes);
export type OutboxJobType = z.infer<typeof outboxJobTypeSchema>;

export const outboxStatuses = [
  'PENDING',
  'PROCESSING',
  'SUCCEEDED',
  'RETRY',
  'MANUAL_REVIEW',
] as const;
export const outboxStatusSchema = z.enum(outboxStatuses);
export type OutboxStatus = z.infer<typeof outboxStatusSchema>;

export const outboxStepTargets = ['RING_BASE', 'WATCH_BASE'] as const;
export const outboxStepTargetSchema = z.enum(outboxStepTargets);
export type OutboxStepTarget = z.infer<typeof outboxStepTargetSchema>;

export const outboxStepStatuses = ['PENDING', 'SUCCEEDED', 'RETRY', 'MANUAL_REVIEW'] as const;
export const outboxStepStatusSchema = z.enum(outboxStepStatuses);
export type OutboxStepStatus = z.infer<typeof outboxStepStatusSchema>;
