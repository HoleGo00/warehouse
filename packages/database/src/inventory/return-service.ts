import { randomUUID } from 'node:crypto';
import {
  confirmReturnSchema,
  requestActionResponseSchema,
  returnQueueQuerySchema,
  returnQueueResponseSchema,
  warehouseCodeSchema,
} from '@glorychips/contracts';
import type {
  ConfirmReturn,
  RequestActionResponse,
  ReturnQueueQuery,
  ReturnQueueResponse,
  WarehouseCode,
} from '@glorychips/contracts';
import type { SessionPrincipal } from '../auth/types.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { executeIdempotently } from '../idempotency/execute-idempotently.js';
import {
  actionResponse,
  loadRequestDetail,
  shanghaiDate,
  toJson,
} from '../requests/request-shared.js';
import { IdempotencyConflictError, InventoryDomainError } from './errors.js';
import { InventoryTransactionExecutor } from './inventory-transaction-executor.js';

export class ReturnService {
  private readonly executor = new InventoryTransactionExecutor();

  public constructor(private readonly database: PrismaClient) {}

  public async list(
    rawQuery: ReturnQueueQuery,
    principal: SessionPrincipal,
    now = new Date(),
  ): Promise<ReturnQueueResponse> {
    this.assertAdministrator(principal);
    const query = returnQueueQuerySchema.parse(rawQuery);
    if (query.warehouse !== undefined) this.assertWarehouseAccess(principal, query.warehouse);
    const visibleWarehouses = principal.roles.includes('SYSTEM_ADMIN')
      ? undefined
      : principal.warehouses;
    const today = shanghaiDate(now);
    const todayDate = new Date(`${today}T00:00:00.000Z`);
    const obligations = await this.database.returnObligation.findMany({
      where: {
        status: { in: ['PENDING', 'PARTIAL'] },
        request: {
          warehouse: {
            code:
              query.warehouse ??
              (visibleWarehouses === undefined ? undefined : { in: [...visibleWarehouses] }),
          },
        },
        ...(query.status === 'PENDING' || query.status === 'PARTIAL'
          ? { status: query.status }
          : query.status === 'DUE'
            ? { trigger: 'DATE', dueDate: todayDate }
            : query.status === 'OVERDUE'
              ? { trigger: 'DATE', dueDate: { lt: todayDate } }
              : {}),
      },
      include: { request: { include: { claimant: true, warehouse: true } } },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
    });
    const grouped = new Map<string, (typeof obligations)[number][]>();
    for (const obligation of obligations) {
      const rows = grouped.get(obligation.requestId) ?? [];
      rows.push(obligation);
      grouped.set(obligation.requestId, rows);
    }
    return returnQueueResponseSchema.parse({
      items: [...grouped.values()].map((rows) => {
        const first = rows[0];
        if (first === undefined) {
          throw new InventoryDomainError('RETURN_STATE_CONFLICT', 'A return group is empty.');
        }
        const requiredQuantity = rows.reduce((sum, item) => sum + item.requiredQuantity, 0);
        const returnedQuantity = rows.reduce((sum, item) => sum + item.returnedQuantity, 0);
        return {
          requestId: first.requestId,
          requestNumber: first.request.requestNumber,
          claimantId: first.request.claimantId,
          claimantName: first.request.claimant.name,
          sourceWarehouse: warehouseCodeSchema.parse(first.request.warehouse.code),
          sourceWarehouseName: first.request.warehouse.name,
          dueDate:
            rows
              .map((item) => item.dueDate?.toISOString().slice(0, 10) ?? null)
              .find((date) => date !== null) ?? null,
          status: rows.some((item) => item.status === 'PARTIAL') ? 'PARTIAL' : 'PENDING',
          requiredQuantity,
          returnedQuantity,
          remainingQuantity: requiredQuantity - returnedQuantity,
          allowedWarehouses: principal.roles.includes('SYSTEM_ADMIN')
            ? (['XIHU', 'YUHANG'] as const)
            : principal.warehouses,
        };
      }),
    });
  }

  public confirm(
    rawCommand: ConfirmReturn,
    idempotencyKey: string,
    principal: SessionPrincipal,
  ): Promise<RequestActionResponse> {
    const command = confirmReturnSchema.parse(rawCommand);
    this.assertWarehouseAccess(principal, command.warehouse);
    return executeIdempotently({
      database: this.database,
      key: idempotencyKey,
      operation: 'CONFIRM_PHYSICAL_RETURN',
      command,
      invalidKeyError: () =>
        new InventoryDomainError('VALIDATION_ERROR', 'An idempotency key is required.'),
      conflictError: () => new IdempotencyConflictError(idempotencyKey),
      execute: async (transaction) => {
        const warehouse = await transaction.warehouse.findUnique({
          where: { code: command.warehouse },
        });
        if (warehouse === null || !warehouse.isActive) {
          throw new InventoryDomainError(
            'RETURN_STATE_CONFLICT',
            'The return warehouse is unavailable.',
          );
        }
        const request = await transaction.request.findUnique({
          where: { id: command.requestId },
          include: { warehouse: true },
        });
        if (request === null) {
          throw new InventoryDomainError(
            'RETURN_OBLIGATION_NOT_FOUND',
            'The request was not found.',
          );
        }
        this.assertWarehouseAccess(principal, warehouseCodeSchema.parse(request.warehouse.code));
        const obligationIds = [...command.lines.map((line) => line.obligationId)].sort();
        for (const obligationId of obligationIds) {
          await transaction.$queryRaw`
            SELECT "id" FROM "return_obligations"
            WHERE "id" = ${obligationId}::uuid
            FOR UPDATE
          `;
        }
        const obligations = await transaction.returnObligation.findMany({
          where: { id: { in: obligationIds } },
          include: { variant: true },
          orderBy: { id: 'asc' },
        });
        if (
          obligations.length !== obligationIds.length ||
          obligations.some((obligation) => obligation.requestId !== command.requestId)
        ) {
          throw new InventoryDomainError(
            'RETURN_OBLIGATION_NOT_FOUND',
            'One or more return obligations were not found.',
          );
        }
        const quantityById = new Map(
          command.lines.map((line) => [line.obligationId, line.quantity]),
        );
        for (const obligation of obligations) {
          if (obligation.status !== 'PENDING' && obligation.status !== 'PARTIAL') {
            throw new InventoryDomainError(
              'RETURN_STATE_CONFLICT',
              'A return obligation is closed.',
            );
          }
          const quantity = quantityById.get(obligation.id);
          if (quantity === undefined) {
            throw new InventoryDomainError(
              'RETURN_STATE_CONFLICT',
              'A return quantity disappeared.',
            );
          }
          if (obligation.returnedQuantity + quantity > obligation.requiredQuantity) {
            throw new InventoryDomainError(
              'RETURN_QUANTITY_EXCEEDED',
              'The returned quantity exceeds the remaining obligation.',
              { obligationId: obligation.id },
            );
          }
        }
        const businessNumber = `RT-${request.requestNumber}-${randomUUID()
          .slice(0, 8)
          .toUpperCase()}`;
        const movement = await this.executor.applyMovementBatchInTransaction(
          transaction,
          {
            businessNumber,
            source: 'ADMIN_RETURN',
            requestId: request.id,
            actorUserId: principal.userId,
            occurredAt: new Date(command.occurredAt),
            lines: obligations.map((obligation) => ({
              warehouseId: warehouse.id,
              variantId: obligation.variantId,
              quantityDelta: quantityById.get(obligation.id) ?? 0,
              type: 'RETURN',
            })),
          },
          idempotencyKey,
        );
        const movements = await transaction.inventoryMovement.findMany({
          where: { id: { in: [...movement.movementIds] } },
        });
        const movementByVariant = new Map(movements.map((item) => [item.variantId, item]));
        for (const obligation of obligations) {
          const quantity = quantityById.get(obligation.id);
          const inventoryMovement = movementByVariant.get(obligation.variantId);
          if (quantity === undefined || inventoryMovement === undefined) {
            throw new InventoryDomainError(
              'RETURN_STATE_CONFLICT',
              'A return movement disappeared.',
            );
          }
          const returnedQuantity = obligation.returnedQuantity + quantity;
          await transaction.returnRecord.create({
            data: {
              obligationId: obligation.id,
              warehouseId: warehouse.id,
              variantId: obligation.variantId,
              processorId: principal.userId,
              movementId: inventoryMovement.id,
              quantity,
              returnedAt: new Date(command.occurredAt),
            },
          });
          await transaction.returnObligation.update({
            where: { id: obligation.id },
            data: {
              returnedQuantity,
              status: returnedQuantity === obligation.requiredQuantity ? 'COMPLETED' : 'PARTIAL',
            },
          });
        }
        const openCount = await transaction.returnObligation.count({
          where: { requestId: command.requestId, status: { in: ['PENDING', 'PARTIAL'] } },
        });
        if (openCount === 0) {
          await transaction.adminTask.updateMany({
            where: {
              requestId: command.requestId,
              type: { in: ['RETURN_DUE', 'RETURN_OVERDUE'] },
              status: 'OPEN',
            },
            data: { status: 'COMPLETED', completedAt: new Date(command.occurredAt) },
          });
        }
        await transaction.auditLog.create({
          data: {
            actorUserId: principal.userId,
            warehouseId: warehouse.id,
            action: 'RETURN_PHYSICAL_RECEIPT_RECORDED',
            entityType: 'REQUEST',
            entityId: command.requestId,
            after: toJson({
              command,
              businessNumber,
              movementIds: movement.movementIds,
              outboxJobId: movement.outboxJobId,
            }),
          },
        });
        const detail = await loadRequestDetail(transaction, command.requestId);
        return requestActionResponseSchema.parse(actionResponse(detail, principal));
      },
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

  private assertAdministrator(principal: SessionPrincipal): void {
    if (!principal.roles.includes('SYSTEM_ADMIN') && !principal.roles.includes('WAREHOUSE_ADMIN')) {
      throw new InventoryDomainError(
        'FORBIDDEN_ROLE',
        'Warehouse administrator access is required.',
      );
    }
  }
}
