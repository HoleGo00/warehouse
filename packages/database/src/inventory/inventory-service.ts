import { randomUUID } from 'node:crypto';
import {
  calculateAvailability,
  inventoryLineSchema,
  movementLineSchema,
} from '@glorychips/contracts';
import type { InventoryAvailability } from '@glorychips/contracts';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import {
  IdempotencyConflictError,
  InsufficientInventoryError,
  InvalidInventoryCommandError,
  ReservationStateError,
} from './errors.js';
import { hashCommand } from './stable-json.js';
import type {
  ApplyMovementBatchCommand,
  InventoryLineInput,
  MovementBatchResult,
  MovementLineInput,
  ReleaseReservationCommand,
  ReleaseReservationResult,
  ReservationBatchResult,
  ReserveBatchCommand,
  TransferBatchCommand,
  TransferBatchResult,
  TransferLineInput,
} from './types.js';

type Transaction = Prisma.TransactionClient;

interface InventoryKey {
  readonly warehouseId: string;
  readonly variantId: string;
}

const keyOf = (key: InventoryKey): string => `${key.warehouseId}:${key.variantId}`;

const compareKeys = (left: InventoryKey, right: InventoryKey): number =>
  keyOf(left).localeCompare(keyOf(right));

const toJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

const validatePositiveInteger = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new InvalidInventoryCommandError(`${label} must be a positive safe integer.`, {
      value,
    });
  }
};

const aggregateInventoryLines = (
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
    quantities.set(key, {
      warehouseId: line.warehouseId,
      variantId: line.variantId,
      quantity: (existing?.quantity ?? 0) + line.quantity,
    });
  }

  return [...quantities.values()].sort(compareKeys);
};

const aggregateMovementLines = (
  lines: readonly MovementLineInput[],
): readonly MovementLineInput[] => {
  if (lines.length === 0) {
    throw new InvalidInventoryCommandError('At least one movement line is required.');
  }

  const aggregated = new Map<string, MovementLineInput>();
  for (const rawLine of lines) {
    const line = movementLineSchema.parse(rawLine);
    // Validate each submitted line before aggregation so contradictory signs
    // cannot cancel into a seemingly valid net delta.
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
      warehouseId: line.warehouseId,
      variantId: line.variantId,
      quantityDelta: (existing?.quantityDelta ?? 0) + line.quantityDelta,
      type: line.type,
    });
  }

  const result = [...aggregated.values()]
    .filter((line) => line.quantityDelta !== 0)
    .sort(compareKeys);
  if (result.length === 0) {
    throw new InvalidInventoryCommandError('Movement lines cannot net to zero.');
  }
  return result;
};

const aggregateTransferLines = (
  warehouseId: string,
  lines: readonly TransferLineInput[],
): readonly InventoryLineInput[] => {
  const normalized = lines.map((line) => {
    validatePositiveInteger(line.quantity, 'Transfer quantity');
    return { warehouseId, variantId: line.variantId, quantity: line.quantity };
  });
  return aggregateInventoryLines(normalized);
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

export class InventoryService {
  public constructor(private readonly database: PrismaClient) {}

  public async getAvailability(
    warehouseId: string,
    variantIds: readonly string[],
  ): Promise<readonly InventoryAvailability[]> {
    const uniqueVariantIds = [...new Set(variantIds)].sort();
    if (uniqueVariantIds.length === 0) {
      return [];
    }

    const balances = await this.database.inventoryBalance.findMany({
      where: { warehouseId, variantId: { in: uniqueVariantIds } },
    });
    const balancesByVariant = new Map(balances.map((balance) => [balance.variantId, balance]));

    return uniqueVariantIds.map((variantId) => {
      const balance = balancesByVariant.get(variantId);
      const confirmedFeishuQuantity = balance?.confirmedFeishuQuantity ?? 0;
      const pendingMovementDelta = balance?.pendingMovementDelta ?? 0;
      const reservedQuantity = balance?.reservedQuantity ?? 0;
      return {
        warehouseId,
        variantId,
        confirmedFeishuQuantity,
        pendingMovementDelta,
        reservedQuantity,
        ...calculateAvailability({
          confirmedFeishuQuantity,
          pendingMovementDelta,
          reservedQuantity,
        }),
      };
    });
  }

  public reserveBatch(
    command: ReserveBatchCommand,
    idempotencyKey: string,
  ): Promise<ReservationBatchResult> {
    const lines = aggregateInventoryLines(command.lines);
    const normalizedCommand = { ...command, lines };

    return this.executeIdempotently(
      idempotencyKey,
      'RESERVE_BATCH',
      normalizedCommand,
      async (transaction) => {
        const balances = await this.lockBalances(transaction, lines);
        this.assertSufficient(balances, lines);

        const batchId = randomUUID();
        const reservationIds: string[] = [];
        for (const line of lines) {
          const reservation = await transaction.inventoryReservation.create({
            data: {
              batchId,
              lineKey: `${idempotencyKey}:${keyOf(line)}`,
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
            data: {
              reservedQuantity: { increment: line.quantity },
              version: { increment: 1 },
            },
          });
        }

        await transaction.auditLog.create({
          data: {
            actorUserId: command.actorUserId,
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
      },
    );
  }

  public releaseReservation(
    command: ReleaseReservationCommand,
    idempotencyKey: string,
  ): Promise<ReleaseReservationResult> {
    return this.executeIdempotently(
      idempotencyKey,
      'RELEASE_RESERVATION',
      command,
      async (transaction) => {
        const initialReservations = await transaction.inventoryReservation.findMany({
          where: { batchId: command.batchId, status: 'ACTIVE' },
          orderBy: [{ warehouseId: 'asc' }, { variantId: 'asc' }],
        });
        if (initialReservations.length === 0) {
          throw new ReservationStateError(command.batchId);
        }

        const lockLines = aggregateInventoryLines(
          initialReservations.map((reservation) => ({
            warehouseId: reservation.warehouseId,
            variantId: reservation.variantId,
            quantity: reservation.quantity,
          })),
        );
        await this.lockBalances(transaction, lockLines);

        // Re-read after the balance locks. A concurrent release/consume may have
        // changed the reservation state while this transaction was waiting.
        const reservations = await transaction.inventoryReservation.findMany({
          where: { batchId: command.batchId, status: 'ACTIVE' },
          orderBy: [{ warehouseId: 'asc' }, { variantId: 'asc' }],
        });
        if (reservations.length === 0) {
          throw new ReservationStateError(command.batchId);
        }
        const lines = aggregateInventoryLines(
          reservations.map((reservation) => ({
            warehouseId: reservation.warehouseId,
            variantId: reservation.variantId,
            quantity: reservation.quantity,
          })),
        );

        for (const line of lines) {
          await transaction.inventoryBalance.update({
            where: {
              warehouseId_variantId: {
                warehouseId: line.warehouseId,
                variantId: line.variantId,
              },
            },
            data: {
              reservedQuantity: { decrement: line.quantity },
              version: { increment: 1 },
            },
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
      },
    );
  }

  public applyMovementBatch(
    command: ApplyMovementBatchCommand,
    idempotencyKey: string,
  ): Promise<MovementBatchResult> {
    const lines = aggregateMovementLines(command.lines);
    lines.forEach(assertMovementDirection);
    const normalizedCommand = { ...command, lines };

    return this.executeIdempotently(
      idempotencyKey,
      'APPLY_MOVEMENT_BATCH',
      normalizedCommand,
      async (transaction) => {
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
              deduplicationKey: `${idempotencyKey}:${index}:${keyOf(line)}`,
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
          const reservedRelease = consumedReservations.get(keyOf(line)) ?? 0;
          await transaction.inventoryBalance.update({
            where: {
              warehouseId_variantId: {
                warehouseId: line.warehouseId,
                variantId: line.variantId,
              },
            },
            data: {
              pendingMovementDelta: { increment: line.quantityDelta },
              reservedQuantity: { decrement: reservedRelease },
              version: { increment: 1 },
              lastMovementId: movement.id,
            },
          });
        }

        const outboxJobId = await this.createMovementOutbox(
          transaction,
          idempotencyKey,
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
      },
    );
  }

  public transferBatch(
    command: TransferBatchCommand,
    idempotencyKey: string,
  ): Promise<TransferBatchResult> {
    if (command.fromWarehouseId === command.toWarehouseId) {
      throw new InvalidInventoryCommandError('Transfer warehouses must be different.');
    }
    const sourceLines = aggregateTransferLines(command.fromWarehouseId, command.lines);
    const destinationLines = sourceLines.map((line) => ({
      ...line,
      warehouseId: command.toWarehouseId,
    }));
    const allKeys = [...sourceLines, ...destinationLines].sort(compareKeys);
    const normalizedCommand = {
      ...command,
      lines: sourceLines.map(({ variantId, quantity }) => ({ variantId, quantity })),
    };

    return this.executeIdempotently(
      idempotencyKey,
      'TRANSFER_BATCH',
      normalizedCommand,
      async (transaction) => {
        const balances = await this.lockBalances(transaction, allKeys);
        this.assertSufficient(balances, sourceLines);

        const transferId = randomUUID();
        const movementIds: string[] = [];
        for (const [index, sourceLine] of sourceLines.entries()) {
          const destinationLine = destinationLines[index];
          if (destinationLine === undefined) {
            throw new InvalidInventoryCommandError('Transfer destination line is missing.');
          }

          const sourceBalance = balances.get(keyOf(sourceLine));
          const destinationBalance = balances.get(keyOf(destinationLine));
          if (sourceBalance === undefined || destinationBalance === undefined) {
            throw new InvalidInventoryCommandError('Locked inventory balance disappeared.', {
              variantId: sourceLine.variantId,
            });
          }
          const sourceBefore =
            sourceBalance.confirmedFeishuQuantity + sourceBalance.pendingMovementDelta;
          const destinationBefore =
            destinationBalance.confirmedFeishuQuantity + destinationBalance.pendingMovementDelta;

          const outbound = await transaction.inventoryMovement.create({
            data: {
              deduplicationKey: `${idempotencyKey}:${index}:OUT`,
              businessNumber: command.businessNumber,
              transferId,
              warehouseId: sourceLine.warehouseId,
              variantId: sourceLine.variantId,
              type: 'TRANSFER_OUT',
              quantityDelta: -sourceLine.quantity,
              quantityBefore: sourceBefore,
              quantityAfter: sourceBefore - sourceLine.quantity,
              source: command.source,
              actorUserId: command.actorUserId,
            },
          });
          const inbound = await transaction.inventoryMovement.create({
            data: {
              deduplicationKey: `${idempotencyKey}:${index}:IN`,
              businessNumber: command.businessNumber,
              transferId,
              warehouseId: destinationLine.warehouseId,
              variantId: destinationLine.variantId,
              type: 'TRANSFER_IN',
              quantityDelta: destinationLine.quantity,
              quantityBefore: destinationBefore,
              quantityAfter: destinationBefore + destinationLine.quantity,
              source: command.source,
              actorUserId: command.actorUserId,
            },
          });
          movementIds.push(outbound.id, inbound.id);

          await transaction.inventoryBalance.update({
            where: {
              warehouseId_variantId: {
                warehouseId: sourceLine.warehouseId,
                variantId: sourceLine.variantId,
              },
            },
            data: {
              pendingMovementDelta: { decrement: sourceLine.quantity },
              version: { increment: 1 },
              lastMovementId: outbound.id,
            },
          });
          await transaction.inventoryBalance.update({
            where: {
              warehouseId_variantId: {
                warehouseId: destinationLine.warehouseId,
                variantId: destinationLine.variantId,
              },
            },
            data: {
              pendingMovementDelta: { increment: destinationLine.quantity },
              version: { increment: 1 },
              lastMovementId: inbound.id,
            },
          });
        }

        const outboxJobId = await this.createMovementOutbox(
          transaction,
          idempotencyKey,
          command.businessNumber,
          movementIds,
          sourceLines.map((line) => line.variantId),
        );
        await transaction.auditLog.create({
          data: {
            actorUserId: command.actorUserId,
            action: 'INVENTORY_TRANSFER_APPLIED',
            entityType: 'INVENTORY_TRANSFER',
            entityId: transferId,
            after: toJson({
              fromWarehouseId: command.fromWarehouseId,
              toWarehouseId: command.toWarehouseId,
              lines: sourceLines,
              movementIds,
              outboxJobId,
            }),
          },
        });

        return {
          transferId,
          movementIds,
          outboxJobId,
          availability: await this.readAvailability(transaction, allKeys),
        };
      },
    );
  }

  private async executeIdempotently<T>(
    key: string,
    operation: string,
    command: unknown,
    execute: (transaction: Transaction) => Promise<T>,
  ): Promise<T> {
    if (key.trim().length === 0) {
      throw new InvalidInventoryCommandError('An idempotency key is required.');
    }
    const requestHash = hashCommand(command);

    return this.database.$transaction(
      async (transaction) => {
        // Serialize callers sharing a client idempotency key before the unique upsert.
        // This avoids a P2002 race while preserving the same response for retries.
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
        const record = await transaction.idempotencyKey.upsert({
          where: { key },
          create: { key, operation, requestHash },
          update: {},
        });
        if (record.operation !== operation || record.requestHash !== requestHash) {
          throw new IdempotencyConflictError(key);
        }
        if (record.status === 'COMPLETED' && record.response !== null) {
          return record.response as unknown as T;
        }

        const response = await execute(transaction);
        await transaction.idempotencyKey.update({
          where: { key },
          data: {
            status: 'COMPLETED',
            response: toJson(response),
            completedAt: new Date(),
          },
        });
        return response;
      },
      {
        isolationLevel: 'ReadCommitted',
        maxWait: 5_000,
        timeout: 20_000,
      },
    );
  }

  private async lockBalances(
    transaction: Transaction,
    keys: readonly InventoryKey[],
  ): Promise<
    Map<
      string,
      { confirmedFeishuQuantity: number; pendingMovementDelta: number; reservedQuantity: number }
    >
  > {
    const sortedKeys = [...new Map(keys.map((key) => [keyOf(key), key])).values()].sort(
      compareKeys,
    );
    await this.assertKeysExist(transaction, sortedKeys);
    await transaction.inventoryBalance.createMany({
      data: sortedKeys.map((key) => ({
        warehouseId: key.warehouseId,
        variantId: key.variantId,
      })),
      skipDuplicates: true,
    });

    for (const key of sortedKeys) {
      await transaction.$queryRaw`
        SELECT "id"
        FROM "inventory_balances"
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

  private async assertKeysExist(
    transaction: Transaction,
    keys: readonly InventoryKey[],
  ): Promise<void> {
    const warehouseIds = [...new Set(keys.map((key) => key.warehouseId))];
    const variantIds = [...new Set(keys.map((key) => key.variantId))];
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
  }

  private assertSufficient(
    balances: ReadonlyMap<
      string,
      { confirmedFeishuQuantity: number; pendingMovementDelta: number; reservedQuantity: number }
    >,
    lines: readonly InventoryLineInput[],
  ): void {
    const shortages = lines.flatMap((line) => {
      const balance = balances.get(keyOf(line));
      if (balance === undefined) {
        return [{ ...line, availableQuantity: 0 }];
      }
      const { availableQuantity } = calculateAvailability(balance);
      return availableQuantity < line.quantity ? [{ ...line, availableQuantity }] : [];
    });
    if (shortages.length > 0) {
      throw new InsufficientInventoryError({ shortages });
    }
  }

  private assertMovementBalances(
    balances: ReadonlyMap<
      string,
      { confirmedFeishuQuantity: number; pendingMovementDelta: number; reservedQuantity: number }
    >,
    lines: readonly MovementLineInput[],
    consumedReservations: ReadonlyMap<string, number>,
  ): void {
    const shortages = lines.flatMap((line) => {
      const balance = balances.get(keyOf(line));
      if (balance === undefined) {
        return [{ ...line, availableAfter: line.quantityDelta }];
      }
      const releasedQuantity = consumedReservations.get(keyOf(line)) ?? 0;
      const effectiveAfter =
        balance.confirmedFeishuQuantity + balance.pendingMovementDelta + line.quantityDelta;
      const reservedAfter = balance.reservedQuantity - releasedQuantity;
      const availableAfter = effectiveAfter - reservedAfter;
      return availableAfter < 0 ? [{ ...line, availableAfter }] : [];
    });
    if (shortages.length > 0) {
      throw new InsufficientInventoryError({ shortages });
    }
  }

  private async loadConsumedReservations(
    transaction: Transaction,
    batchId: string | undefined,
    lines: readonly MovementLineInput[],
  ): Promise<Map<string, number>> {
    if (batchId === undefined) {
      return new Map();
    }

    const reservations = await transaction.inventoryReservation.findMany({
      where: { batchId, status: 'ACTIVE' },
    });
    if (reservations.length === 0) {
      throw new ReservationStateError(batchId);
    }
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
        throw new InvalidInventoryCommandError('Locked inventory balance disappeared.', { ...key });
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
        steps: {
          create: targets.map((target) => ({ target })),
        },
      },
    });
    return job.id;
  }

  private singleWarehouseId(lines: readonly InventoryKey[]): string | undefined {
    const warehouseIds = [...new Set(lines.map((line) => line.warehouseId))];
    return warehouseIds.length === 1 ? warehouseIds[0] : undefined;
  }
}
