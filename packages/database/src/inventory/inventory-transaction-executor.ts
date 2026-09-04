import { randomUUID } from 'node:crypto';
import {
  calculateAvailability,
  inventoryLineSchema,
  movementLineSchema,
} from '@glorychips/contracts';
import type { InventoryAvailability } from '@glorychips/contracts';
import type { Prisma } from '../generated/prisma/client.js';
import {
  InsufficientInventoryError,
  InvalidInventoryCommandError,
  ReservationStateError,
} from './errors.js';
import type {
  ApplyMovementBatchCommand,
  InventoryLineInput,
  MovementBatchResult,
  MovementLineInput,
  ReleaseReservationCommand,
  ReleaseReservationResult,
  ReservationBatchResult,
  ReserveBatchCommand,
} from './types.js';

type Transaction = Prisma.TransactionClient;
interface InventoryKey {
  readonly warehouseId: string;
  readonly variantId: string;
}
type LockedBalance = {
  readonly confirmedFeishuQuantity: number;
  readonly pendingMovementDelta: number;
  readonly reservedQuantity: number;
};

const keyOf = (key: InventoryKey): string => `${key.warehouseId}:${key.variantId}`;
const compareKeys = (left: InventoryKey, right: InventoryKey): number =>
  keyOf(left).localeCompare(keyOf(right));
const toJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

export const normalizeInventoryLines = (
  lines: readonly InventoryLineInput[],
): readonly InventoryLineInput[] => {
  if (lines.length === 0) {
    throw new InvalidInventoryCommandError('At least one inventory line is required.');
  }
  const quantities = new Map<string, InventoryLineInput>();
  for (const rawLine of lines) {
    const line = inventoryLineSchema.parse(rawLine);
    const key = keyOf(line);
    const existing = quantities.get(key);
    quantities.set(key, { ...line, quantity: (existing?.quantity ?? 0) + line.quantity });
  }
  return [...quantities.values()].sort(compareKeys);
};

const inboundTypes = new Set([
  'INBOUND',
  'RETURN',
  'TRANSFER_IN',
  'STOCKTAKE_GAIN',
  'MIGRATION_OPENING',
]);
const outboundTypes = new Set(['ISSUE', 'TRANSFER_OUT', 'STOCKTAKE_LOSS']);

const assertMovementDirection = (line: MovementLineInput): void => {
  if (inboundTypes.has(line.type) && line.quantityDelta < 0) {
    throw new InvalidInventoryCommandError(`${line.type} requires a positive delta.`);
  }
  if (outboundTypes.has(line.type) && line.quantityDelta > 0) {
    throw new InvalidInventoryCommandError(`${line.type} requires a negative delta.`);
  }
};

export const normalizeMovementLines = (
  lines: readonly MovementLineInput[],
): readonly MovementLineInput[] => {
  if (lines.length === 0) {
    throw new InvalidInventoryCommandError('At least one movement line is required.');
  }
  const aggregated = new Map<string, MovementLineInput>();
  for (const rawLine of lines) {
    const line = movementLineSchema.parse(rawLine);
    assertMovementDirection(line);
    const key = keyOf(line);
    const existing = aggregated.get(key);
    if (existing !== undefined && existing.type !== line.type) {
      throw new InvalidInventoryCommandError(
        'A stock key cannot contain multiple movement types in one command.',
        { warehouseId: line.warehouseId, variantId: line.variantId },
      );
    }
    aggregated.set(key, {
      ...line,
      quantityDelta: (existing?.quantityDelta ?? 0) + line.quantityDelta,
    });
  }
  const normalized = [...aggregated.values()]
    .filter((line) => line.quantityDelta !== 0)
    .sort(compareKeys);
  if (normalized.length === 0) {
    throw new InvalidInventoryCommandError('Movement lines cannot net to zero.');
  }
  return normalized;
};

export class InventoryTransactionExecutor {
  public async reserveBatchInTransaction(
    transaction: Transaction,
    command: ReserveBatchCommand,
    lineKeyPrefix: string,
  ): Promise<ReservationBatchResult> {
    const lines = normalizeInventoryLines(command.lines);
    const balances = await this.lockBalances(transaction, lines);
    this.assertSufficient(balances, lines);

    const batchId = randomUUID();
    const reservationIds: string[] = [];
    for (const line of lines) {
      const reservation = await transaction.inventoryReservation.create({
        data: {
          batchId,
          lineKey: `${lineKeyPrefix}:${keyOf(line)}`,
          requestId: command.requestId,
          warehouseId: line.warehouseId,
          variantId: line.variantId,
          quantity: line.quantity,
          expiresAt: command.expiresAt,
        },
      });
      reservationIds.push(reservation.id);
      await transaction.inventoryBalance.update({
        where: {
          warehouseId_variantId: {
            warehouseId: line.warehouseId,
            variantId: line.variantId,
          },
        },
        data: { reservedQuantity: { increment: line.quantity }, version: { increment: 1 } },
      });
    }

    await transaction.auditLog.create({
      data: {
        actorUserId: command.actorUserId,
        warehouseId: this.singleWarehouseId(lines),
        action: 'INVENTORY_RESERVED',
        entityType: 'INVENTORY_RESERVATION_BATCH',
        entityId: batchId,
        after: toJson({ lines, reservationIds }),
      },
    });
    return {
      batchId,
      reservationIds,
      availability: await this.readAvailability(transaction, lines),
    };
  }

  public async releaseReservationInTransaction(
    transaction: Transaction,
    command: ReleaseReservationCommand,
  ): Promise<ReleaseReservationResult> {
    const initialReservations = await transaction.inventoryReservation.findMany({
      where: { batchId: command.batchId, status: 'ACTIVE' },
      orderBy: [{ warehouseId: 'asc' }, { variantId: 'asc' }],
    });
    if (initialReservations.length === 0) throw new ReservationStateError(command.batchId);
    const lockLines = normalizeInventoryLines(initialReservations);
    await this.lockBalances(transaction, lockLines);

    const reservations = await transaction.inventoryReservation.findMany({
      where: { batchId: command.batchId, status: 'ACTIVE' },
      orderBy: [{ warehouseId: 'asc' }, { variantId: 'asc' }],
    });
    if (reservations.length === 0) throw new ReservationStateError(command.batchId);
    const lines = normalizeInventoryLines(reservations);
    for (const line of lines) {
      await transaction.inventoryBalance.update({
        where: {
          warehouseId_variantId: {
            warehouseId: line.warehouseId,
            variantId: line.variantId,
          },
        },
        data: { reservedQuantity: { decrement: line.quantity }, version: { increment: 1 } },
      });
    }
    await transaction.inventoryReservation.updateMany({
      where: { batchId: command.batchId, status: 'ACTIVE' },
      data: { status: 'RELEASED', releasedAt: new Date() },
    });
    const releasedReservationIds = reservations.map((reservation) => reservation.id);
    await transaction.auditLog.create({
      data: {
        actorUserId: command.actorUserId,
        warehouseId: this.singleWarehouseId(lines),
        action: 'INVENTORY_RESERVATION_RELEASED',
        entityType: 'INVENTORY_RESERVATION_BATCH',
        entityId: command.batchId,
        after: toJson({ releasedReservationIds }),
      },
    });
    return {
      batchId: command.batchId,
      releasedReservationIds,
      availability: await this.readAvailability(transaction, lines),
    };
  }

  public async applyMovementBatchInTransaction(
    transaction: Transaction,
    command: ApplyMovementBatchCommand,
    deduplicationPrefix: string,
  ): Promise<MovementBatchResult> {
    const lines = normalizeMovementLines(command.lines);
    const balances = await this.lockBalances(transaction, lines);
    const consumedReservations = await this.loadConsumedReservations(
      transaction,
      command.consumeReservationBatchId,
      lines,
    );
    this.assertMovementBalances(balances, lines, consumedReservations);

    if (command.consumeReservationBatchId !== undefined) {
      await transaction.inventoryReservation.updateMany({
        where: { batchId: command.consumeReservationBatchId, status: 'ACTIVE' },
        data: { status: 'CONSUMED', releasedAt: new Date() },
      });
    }

    const movementIds: string[] = [];
    for (const [index, line] of lines.entries()) {
      const balance = balances.get(keyOf(line));
      if (balance === undefined) {
        throw new InvalidInventoryCommandError('Locked inventory balance disappeared.', {
          warehouseId: line.warehouseId,
          variantId: line.variantId,
        });
      }
      const quantityBefore = balance.confirmedFeishuQuantity + balance.pendingMovementDelta;
      const movement = await transaction.inventoryMovement.create({
        data: {
          deduplicationKey: `${deduplicationPrefix}:${index}:${keyOf(line)}`,
          businessNumber: command.businessNumber,
          requestId: command.requestId,
          warehouseId: line.warehouseId,
          variantId: line.variantId,
          type: line.type,
          quantityDelta: line.quantityDelta,
          quantityBefore,
          quantityAfter: quantityBefore + line.quantityDelta,
          source: command.source,
          actorUserId: command.actorUserId,
        },
      });
      movementIds.push(movement.id);
      await transaction.inventoryBalance.update({
        where: {
          warehouseId_variantId: {
            warehouseId: line.warehouseId,
            variantId: line.variantId,
          },
        },
        data: {
          pendingMovementDelta: { increment: line.quantityDelta },
          reservedQuantity: { decrement: consumedReservations.get(keyOf(line)) ?? 0 },
          version: { increment: 1 },
          lastMovementId: movement.id,
        },
      });
    }

    const outboxJobId = await this.createMovementOutbox(
      transaction,
      deduplicationPrefix,
      command.businessNumber,
      movementIds,
      lines.map((line) => line.variantId),
    );
    await transaction.auditLog.create({
      data: {
        actorUserId: command.actorUserId,
        warehouseId: this.singleWarehouseId(lines),
        action: 'INVENTORY_MOVEMENT_BATCH_APPLIED',
        entityType: 'INVENTORY_MOVEMENT_BATCH',
        entityId: command.businessNumber,
        after: toJson({ movementIds, lines, outboxJobId }),
      },
    });
    return {
      movementIds,
      outboxJobId,
      availability: await this.readAvailability(transaction, lines),
    };
  }

  private async lockBalances(
    transaction: Transaction,
    keys: readonly InventoryKey[],
  ): Promise<Map<string, LockedBalance>> {
    const sortedKeys = [...new Map(keys.map((key) => [keyOf(key), key])).values()].sort(
      compareKeys,
    );
    const warehouseIds = [...new Set(sortedKeys.map((key) => key.warehouseId))];
    const variantIds = [...new Set(sortedKeys.map((key) => key.variantId))];
    const [warehouses, variants] = await Promise.all([
      transaction.warehouse.findMany({ where: { id: { in: warehouseIds } }, select: { id: true } }),
      transaction.productVariant.findMany({
        where: { id: { in: variantIds } },
        select: { id: true },
      }),
    ]);
    if (warehouses.length !== warehouseIds.length || variants.length !== variantIds.length) {
      throw new InvalidInventoryCommandError(
        'An inventory key references an unknown warehouse or variant.',
      );
    }
    await transaction.inventoryBalance.createMany({
      data: sortedKeys.map((key) => ({
        warehouseId: key.warehouseId,
        variantId: key.variantId,
      })),
      skipDuplicates: true,
    });
    for (const key of sortedKeys) {
      await transaction.$queryRaw`
        SELECT "id" FROM "inventory_balances"
        WHERE "warehouse_id" = ${key.warehouseId}::uuid
          AND "variant_id" = ${key.variantId}::uuid
        FOR UPDATE
      `;
    }
    const balances = await transaction.inventoryBalance.findMany({
      where: {
        OR: sortedKeys.map((key) => ({
          warehouseId: key.warehouseId,
          variantId: key.variantId,
        })),
      },
    });
    return new Map(balances.map((balance) => [keyOf(balance), balance]));
  }

  private assertSufficient(
    balances: ReadonlyMap<string, LockedBalance>,
    lines: readonly InventoryLineInput[],
  ): void {
    const shortages = lines.flatMap((line) => {
      const balance = balances.get(keyOf(line));
      const availableQuantity =
        balance === undefined ? 0 : calculateAvailability(balance).availableQuantity;
      return availableQuantity < line.quantity ? [{ ...line, availableQuantity }] : [];
    });
    if (shortages.length > 0) throw new InsufficientInventoryError({ shortages });
  }

  private assertMovementBalances(
    balances: ReadonlyMap<string, LockedBalance>,
    lines: readonly MovementLineInput[],
    consumedReservations: ReadonlyMap<string, number>,
  ): void {
    const shortages = lines.flatMap((line) => {
      const balance = balances.get(keyOf(line));
      if (balance === undefined) return [{ ...line, availableAfter: line.quantityDelta }];
      const effectiveAfter =
        balance.confirmedFeishuQuantity + balance.pendingMovementDelta + line.quantityDelta;
      const reservedAfter = balance.reservedQuantity - (consumedReservations.get(keyOf(line)) ?? 0);
      const availableAfter = effectiveAfter - reservedAfter;
      return availableAfter < 0 ? [{ ...line, availableAfter }] : [];
    });
    if (shortages.length > 0) throw new InsufficientInventoryError({ shortages });
  }

  private async loadConsumedReservations(
    transaction: Transaction,
    batchId: string | undefined,
    lines: readonly MovementLineInput[],
  ): Promise<Map<string, number>> {
    if (batchId === undefined) return new Map();
    const reservations = await transaction.inventoryReservation.findMany({
      where: { batchId, status: 'ACTIVE' },
    });
    if (reservations.length === 0) throw new ReservationStateError(batchId);
    if (lines.some((line) => line.quantityDelta >= 0)) {
      throw new InvalidInventoryCommandError('Only outbound movements can consume reservations.');
    }
    const reservationQuantities = new Map<string, number>();
    for (const reservation of reservations) {
      const key = keyOf(reservation);
      reservationQuantities.set(key, (reservationQuantities.get(key) ?? 0) + reservation.quantity);
    }
    const movementQuantities = new Map(
      lines.map((line) => [keyOf(line), Math.abs(line.quantityDelta)]),
    );
    if (
      reservationQuantities.size !== movementQuantities.size ||
      [...reservationQuantities].some(([key, quantity]) => movementQuantities.get(key) !== quantity)
    ) {
      throw new InvalidInventoryCommandError(
        'Consumed movement lines must exactly match the active reservation batch.',
        { batchId },
      );
    }
    return reservationQuantities;
  }

  private async readAvailability(
    transaction: Transaction,
    keys: readonly InventoryKey[],
  ): Promise<readonly InventoryAvailability[]> {
    const sortedKeys = [...new Map(keys.map((key) => [keyOf(key), key])).values()].sort(
      compareKeys,
    );
    const balances = await transaction.inventoryBalance.findMany({
      where: {
        OR: sortedKeys.map((key) => ({
          warehouseId: key.warehouseId,
          variantId: key.variantId,
        })),
      },
    });
    const balanceMap = new Map(balances.map((balance) => [keyOf(balance), balance]));
    return sortedKeys.map((key) => {
      const balance = balanceMap.get(keyOf(key));
      if (balance === undefined) {
        throw new InvalidInventoryCommandError('Locked inventory balance disappeared.', {
          warehouseId: key.warehouseId,
          variantId: key.variantId,
        });
      }
      return {
        ...key,
        confirmedFeishuQuantity: balance.confirmedFeishuQuantity,
        pendingMovementDelta: balance.pendingMovementDelta,
        reservedQuantity: balance.reservedQuantity,
        ...calculateAvailability(balance),
      };
    });
  }

  private async createMovementOutbox(
    transaction: Transaction,
    idempotencyKey: string,
    businessNumber: string,
    movementIds: readonly string[],
    variantIds: readonly string[],
  ): Promise<string> {
    const variants = await transaction.productVariant.findMany({
      where: { id: { in: [...new Set(variantIds)] } },
      select: { product: { select: { baseTarget: true } } },
    });
    const targets = [
      ...new Set(
        variants.map((variant) =>
          variant.product.baseTarget === 'RING' ? ('RING_BASE' as const) : ('WATCH_BASE' as const),
        ),
      ),
    ];
    const job = await transaction.outboxJob.create({
      data: {
        type: 'SYNC_INVENTORY_MOVEMENTS',
        aggregateType: 'INVENTORY_MOVEMENT_BATCH',
        aggregateId: businessNumber,
        idempotencyKey: `${idempotencyKey}:outbox`,
        payload: toJson({ businessNumber, movementIds }),
        steps: { create: targets.map((target) => ({ target })) },
      },
    });
    return job.id;
  }

  private singleWarehouseId(lines: readonly InventoryKey[]): string | undefined {
    const warehouseIds = [...new Set(lines.map((line) => line.warehouseId))];
    return warehouseIds.length === 1 ? warehouseIds[0] : undefined;
  }
}
