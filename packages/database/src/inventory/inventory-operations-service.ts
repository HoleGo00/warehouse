import { randomUUID } from 'node:crypto';
import {
  createInboundSchema,
  createStocktakeSchema,
  createTransferSchema,
  inventoryOperationResponseSchema,
  warehouseCodeSchema,
} from '@glorychips/contracts';
import type {
  CreateInbound,
  CreateStocktake,
  CreateTransfer,
  InventoryAvailability,
  InventoryOperationResponse,
  WarehouseCode,
} from '@glorychips/contracts';
import type { SessionPrincipal } from '../auth/types.js';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { executeIdempotently } from '../idempotency/execute-idempotently.js';
import { IdempotencyConflictError, InventoryDomainError } from './errors.js';
import { InventoryTransactionExecutor } from './inventory-transaction-executor.js';

type Transaction = Prisma.TransactionClient;

const toJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const operationNumber = (prefix: 'IN' | 'TF' | 'ST'): string =>
  `${prefix}-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomUUID()
    .slice(0, 8)
    .toUpperCase()}`;
const availabilityKey = (warehouseId: string, variantId: string): string =>
  `${warehouseId}:${variantId}`;

interface WarehouseRecord {
  readonly id: string;
  readonly code: WarehouseCode;
  readonly name: string;
}

interface VariantRecord {
  readonly id: string;
  readonly displayName: string;
  readonly isActive: boolean;
  readonly product: { readonly officialName: string; readonly status: string };
}

export class InventoryOperationsService {
  private readonly executor = new InventoryTransactionExecutor();

  public constructor(private readonly database: PrismaClient) {}

  public createInbound(
    rawCommand: CreateInbound,
    idempotencyKey: string,
    principal: SessionPrincipal,
  ): Promise<InventoryOperationResponse> {
    const command = createInboundSchema.parse(rawCommand);
    this.assertWarehouseAccess(principal, command.warehouse);
    return this.runIdempotently(idempotencyKey, 'CREATE_INBOUND', command, async (transaction) => {
      const warehouse = await this.loadWarehouse(transaction, command.warehouse);
      const variants = await this.loadVariants(
        transaction,
        command.lines.map((line) => line.variantId),
        true,
      );
      const number = operationNumber('IN');
      const operation = await transaction.inventoryOperation.create({
        data: {
          operationNumber: number,
          type: 'INBOUND',
          inboundType: command.inboundType,
          warehouseId: warehouse.id,
          actorUserId: principal.userId,
          occurredAt: new Date(command.occurredAt),
          reason: command.reason,
          notes: command.notes,
          lines: {
            create: command.lines.map((line) => ({
              variantId: line.variantId,
              quantity: line.quantity,
            })),
          },
        },
        include: { lines: true },
      });
      const movement = await this.executor.applyMovementBatchInTransaction(
        transaction,
        {
          businessNumber: number,
          source: 'ADMIN_INBOUND',
          operationId: operation.id,
          actorUserId: principal.userId,
          occurredAt: new Date(command.occurredAt),
          lines: command.lines.map((line) => ({
            warehouseId: warehouse.id,
            variantId: line.variantId,
            quantityDelta: line.quantity,
            type: 'INBOUND',
          })),
        },
        idempotencyKey,
      );
      await transaction.auditLog.create({
        data: {
          actorUserId: principal.userId,
          warehouseId: warehouse.id,
          action: 'INVENTORY_INBOUND_RECORDED',
          entityType: 'INVENTORY_OPERATION',
          entityId: operation.id,
          after: toJson({ operationNumber: number, inboundType: command.inboundType, command }),
        },
      });
      return inventoryOperationResponseSchema.parse({
        operation: {
          id: operation.id,
          operationNumber: number,
          type: 'INBOUND',
          inboundType: command.inboundType,
          warehouse: warehouse.code,
          sourceWarehouse: null,
          destinationWarehouse: null,
          actorUserId: principal.userId,
          occurredAt: new Date(command.occurredAt).toISOString(),
          reason: command.reason,
          notes: command.notes ?? null,
          lines: operation.lines.map((line) => {
            const variant = this.requireVariant(variants, line.variantId);
            return {
              id: line.id,
              variantId: line.variantId,
              productName: variant.product.officialName,
              variantName: variant.displayName,
              quantity: line.quantity,
              systemQuantity: null,
              countedQuantity: null,
              difference: null,
              adjustedQuantity: this.requireAvailability(
                movement.availability,
                warehouse.id,
                line.variantId,
              ).effectiveOnHandQuantity,
            };
          }),
          movementIds: movement.movementIds,
          outboxJobId: movement.outboxJobId,
          availability: movement.availability,
        },
      });
    });
  }

  public createTransfer(
    rawCommand: CreateTransfer,
    idempotencyKey: string,
    principal: SessionPrincipal,
  ): Promise<InventoryOperationResponse> {
    const command = createTransferSchema.parse(rawCommand);
    this.assertWarehouseAccess(principal, command.sourceWarehouse);
    this.assertWarehouseAccess(principal, command.destinationWarehouse);
    return this.runIdempotently(idempotencyKey, 'CREATE_TRANSFER', command, async (transaction) => {
      const [source, destination] = await Promise.all([
        this.loadWarehouse(transaction, command.sourceWarehouse),
        this.loadWarehouse(transaction, command.destinationWarehouse),
      ]);
      const variants = await this.loadVariants(
        transaction,
        command.lines.map((line) => line.variantId),
        false,
      );
      const number = operationNumber('TF');
      const operation = await transaction.inventoryOperation.create({
        data: {
          operationNumber: number,
          type: 'TRANSFER',
          sourceWarehouseId: source.id,
          destinationWarehouseId: destination.id,
          actorUserId: principal.userId,
          occurredAt: new Date(command.occurredAt),
          reason: command.reason,
          notes: command.notes,
          lines: {
            create: command.lines.map((line) => ({
              variantId: line.variantId,
              quantity: line.quantity,
            })),
          },
        },
        include: { lines: true },
      });
      const movement = await this.executor.transferBatchInTransaction(
        transaction,
        {
          businessNumber: number,
          source: 'ADMIN_TRANSFER',
          fromWarehouseId: source.id,
          toWarehouseId: destination.id,
          operationId: operation.id,
          transferId: operation.id,
          actorUserId: principal.userId,
          occurredAt: new Date(command.occurredAt),
          lines: command.lines,
        },
        idempotencyKey,
      );
      await transaction.auditLog.create({
        data: {
          actorUserId: principal.userId,
          action: 'INVENTORY_TRANSFER_RECORDED',
          entityType: 'INVENTORY_OPERATION',
          entityId: operation.id,
          after: toJson({
            operationNumber: number,
            source: source.code,
            destination: destination.code,
          }),
        },
      });
      return inventoryOperationResponseSchema.parse({
        operation: {
          id: operation.id,
          operationNumber: number,
          type: 'TRANSFER',
          inboundType: null,
          warehouse: null,
          sourceWarehouse: source.code,
          destinationWarehouse: destination.code,
          actorUserId: principal.userId,
          occurredAt: new Date(command.occurredAt).toISOString(),
          reason: command.reason,
          notes: command.notes ?? null,
          lines: operation.lines.map((line) => {
            const variant = this.requireVariant(variants, line.variantId);
            return {
              id: line.id,
              variantId: line.variantId,
              productName: variant.product.officialName,
              variantName: variant.displayName,
              quantity: line.quantity,
              systemQuantity: null,
              countedQuantity: null,
              difference: null,
              adjustedQuantity: this.requireAvailability(
                movement.availability,
                source.id,
                line.variantId,
              ).effectiveOnHandQuantity,
            };
          }),
          movementIds: movement.movementIds,
          outboxJobId: movement.outboxJobId,
          availability: movement.availability,
        },
      });
    });
  }

  public createStocktake(
    rawCommand: CreateStocktake,
    idempotencyKey: string,
    principal: SessionPrincipal,
  ): Promise<InventoryOperationResponse> {
    const command = createStocktakeSchema.parse(rawCommand);
    this.assertWarehouseAccess(principal, command.warehouse);
    return this.runIdempotently(
      idempotencyKey,
      'CREATE_STOCKTAKE',
      command,
      async (transaction) => {
        const warehouse = await this.loadWarehouse(transaction, command.warehouse);
        const variants = await this.loadVariants(
          transaction,
          command.lines.map((line) => line.variantId),
          false,
        );
        const locked = await this.executor.readLockedAvailabilityInTransaction(
          transaction,
          command.lines.map((line) => ({ warehouseId: warehouse.id, variantId: line.variantId })),
        );
        const lockedByVariant = new Map(locked.map((item) => [item.variantId, item]));
        const stocktakeLines = command.lines.map((line) => {
          const before = lockedByVariant.get(line.variantId);
          if (before === undefined) {
            throw new InventoryDomainError(
              'INVENTORY_OPERATION_CONFLICT',
              'A locked stocktake balance disappeared.',
            );
          }
          const difference = line.countedQuantity - before.effectiveOnHandQuantity;
          if (line.countedQuantity < before.reservedQuantity) {
            throw new InventoryDomainError(
              'STOCKTAKE_RESERVATION_CONFLICT',
              'The counted quantity cannot satisfy active reservations.',
              {
                variantId: line.variantId,
                countedQuantity: line.countedQuantity,
                reservedQuantity: before.reservedQuantity,
              },
            );
          }
          return { ...line, systemQuantity: before.effectiveOnHandQuantity, difference };
        });
        const number = operationNumber('ST');
        const operation = await transaction.inventoryOperation.create({
          data: {
            operationNumber: number,
            type: 'STOCKTAKE',
            warehouseId: warehouse.id,
            actorUserId: principal.userId,
            occurredAt: new Date(command.occurredAt),
            reason: command.reason,
            notes: command.notes,
            lines: {
              create: stocktakeLines.map((line) => ({
                variantId: line.variantId,
                systemQuantity: line.systemQuantity,
                countedQuantity: line.countedQuantity,
                difference: line.difference,
              })),
            },
          },
          include: { lines: true },
        });
        const changedLines = stocktakeLines.filter((line) => line.difference !== 0);
        const movement =
          changedLines.length === 0
            ? { movementIds: [] as string[], outboxJobId: null, availability: locked }
            : await this.executor.applyMovementBatchInTransaction(
                transaction,
                {
                  businessNumber: number,
                  source: 'ADMIN_STOCKTAKE',
                  operationId: operation.id,
                  actorUserId: principal.userId,
                  occurredAt: new Date(command.occurredAt),
                  lines: changedLines.map((line) => ({
                    warehouseId: warehouse.id,
                    variantId: line.variantId,
                    quantityDelta: line.difference,
                    type: line.difference > 0 ? 'STOCKTAKE_GAIN' : 'STOCKTAKE_LOSS',
                  })),
                },
                idempotencyKey,
              );
        await transaction.auditLog.create({
          data: {
            actorUserId: principal.userId,
            warehouseId: warehouse.id,
            action: 'INVENTORY_STOCKTAKE_RECORDED',
            entityType: 'INVENTORY_OPERATION',
            entityId: operation.id,
            after: toJson({
              operationNumber: number,
              reason: command.reason,
              lines: stocktakeLines,
            }),
          },
        });
        return inventoryOperationResponseSchema.parse({
          operation: {
            id: operation.id,
            operationNumber: number,
            type: 'STOCKTAKE',
            inboundType: null,
            warehouse: warehouse.code,
            sourceWarehouse: null,
            destinationWarehouse: null,
            actorUserId: principal.userId,
            occurredAt: new Date(command.occurredAt).toISOString(),
            reason: command.reason,
            notes: command.notes ?? null,
            lines: operation.lines.map((line) => {
              const variant = this.requireVariant(variants, line.variantId);
              const source = stocktakeLines.find((item) => item.variantId === line.variantId);
              if (source === undefined) {
                throw new InventoryDomainError(
                  'INVENTORY_OPERATION_CONFLICT',
                  'A stocktake line disappeared.',
                );
              }
              return {
                id: line.id,
                variantId: line.variantId,
                productName: variant.product.officialName,
                variantName: variant.displayName,
                quantity: null,
                systemQuantity: source.systemQuantity,
                countedQuantity: source.countedQuantity,
                difference: source.difference,
                adjustedQuantity: source.countedQuantity,
              };
            }),
            movementIds: movement.movementIds,
            outboxJobId: movement.outboxJobId,
            availability: movement.availability,
          },
        });
      },
    );
  }

  private runIdempotently<T>(
    key: string,
    operation: string,
    command: unknown,
    execute: (transaction: Transaction) => Promise<T>,
  ): Promise<T> {
    return executeIdempotently({
      database: this.database,
      key,
      operation,
      command,
      invalidKeyError: () =>
        new InventoryDomainError('VALIDATION_ERROR', 'An idempotency key is required.'),
      conflictError: () => new IdempotencyConflictError(key),
      execute,
    });
  }

  private assertWarehouseAccess(principal: SessionPrincipal, warehouse: WarehouseCode): void {
    if (
      !principal.roles.includes('SYSTEM_ADMIN') &&
      (!principal.roles.includes('WAREHOUSE_ADMIN') || !principal.warehouses.includes(warehouse))
    ) {
      throw new InventoryDomainError(
        'FORBIDDEN_WAREHOUSE',
        'The warehouse is outside the granted scope.',
      );
    }
  }

  private async loadWarehouse(
    transaction: Transaction,
    code: WarehouseCode,
  ): Promise<WarehouseRecord> {
    const warehouse = await transaction.warehouse.findUnique({ where: { code } });
    if (warehouse === null || !warehouse.isActive) {
      throw new InventoryDomainError(
        'INVENTORY_OPERATION_NOT_FOUND',
        'The warehouse is unavailable.',
      );
    }
    return {
      id: warehouse.id,
      code: warehouseCodeSchema.parse(warehouse.code),
      name: warehouse.name,
    };
  }

  private async loadVariants(
    transaction: Transaction,
    variantIds: readonly string[],
    requireActive: boolean,
  ): Promise<ReadonlyMap<string, VariantRecord>> {
    const variants = await transaction.productVariant.findMany({
      where: { id: { in: [...new Set(variantIds)] } },
      select: {
        id: true,
        displayName: true,
        isActive: true,
        product: { select: { officialName: true, status: true } },
      },
    });
    if (
      variants.length !== new Set(variantIds).size ||
      (requireActive &&
        variants.some((variant) => !variant.isActive || variant.product.status !== 'ACTIVE'))
    ) {
      throw new InventoryDomainError(
        'INVENTORY_OPERATION_CONFLICT',
        'One or more product variants are unavailable for this operation.',
      );
    }
    return new Map(variants.map((variant) => [variant.id, variant]));
  }

  private requireVariant(
    variants: ReadonlyMap<string, VariantRecord>,
    variantId: string,
  ): VariantRecord {
    const variant = variants.get(variantId);
    if (variant === undefined) {
      throw new InventoryDomainError(
        'INVENTORY_OPERATION_CONFLICT',
        'A product variant disappeared.',
      );
    }
    return variant;
  }

  private requireAvailability(
    values: readonly InventoryAvailability[],
    warehouseId: string,
    variantId: string,
  ): InventoryAvailability {
    const value = new Map(
      values.map((item) => [availabilityKey(item.warehouseId, item.variantId), item]),
    ).get(availabilityKey(warehouseId, variantId));
    if (value === undefined) {
      throw new InventoryDomainError(
        'INVENTORY_OPERATION_CONFLICT',
        'Inventory availability disappeared.',
      );
    }
    return value;
  }
}
