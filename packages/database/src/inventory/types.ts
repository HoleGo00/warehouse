import type { InventoryAvailability, InventoryMovementType } from '@glorychips/contracts';

export interface InventoryLineInput {
  readonly warehouseId: string;
  readonly variantId: string;
  readonly quantity: number;
}

export interface ReserveBatchCommand {
  readonly lines: readonly InventoryLineInput[];
  readonly requestId?: string;
  readonly expiresAt?: Date;
  readonly actorUserId?: string;
}

export interface ReservationBatchResult {
  readonly batchId: string;
  readonly reservationIds: readonly string[];
  readonly availability: readonly InventoryAvailability[];
}

export interface ReleaseReservationCommand {
  readonly batchId: string;
  readonly actorUserId?: string;
}

export interface ReleaseReservationResult {
  readonly batchId: string;
  readonly releasedReservationIds: readonly string[];
  readonly availability: readonly InventoryAvailability[];
}

export interface MovementLineInput {
  readonly warehouseId: string;
  readonly variantId: string;
  readonly quantityDelta: number;
  readonly type: InventoryMovementType;
}

export interface ApplyMovementBatchCommand {
  readonly businessNumber: string;
  readonly source: 'ONLINE' | 'OFFLINE' | 'EXPRESS';
  readonly lines: readonly MovementLineInput[];
  readonly requestId?: string;
  readonly consumeReservationBatchId?: string;
  readonly actorUserId?: string;
}

export interface MovementBatchResult {
  readonly movementIds: readonly string[];
  readonly availability: readonly InventoryAvailability[];
  readonly outboxJobId: string;
}

export interface TransferLineInput {
  readonly variantId: string;
  readonly quantity: number;
}

export interface TransferBatchCommand {
  readonly businessNumber: string;
  readonly source: 'ONLINE' | 'OFFLINE' | 'EXPRESS';
  readonly fromWarehouseId: string;
  readonly toWarehouseId: string;
  readonly lines: readonly TransferLineInput[];
  readonly actorUserId?: string;
}

export interface TransferBatchResult extends MovementBatchResult {
  readonly transferId: string;
}
