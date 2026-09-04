import {
  cancelNormalRequestSchema,
  createNormalRequestSchema,
  normalRequestActionResponseSchema,
  normalRequestAdminQueueQuerySchema,
  normalRequestDetailResponseSchema,
  normalRequestListResponseSchema,
  resubmitNormalRequestSchema,
  reviewNormalRequestSchema,
} from '@glorychips/contracts';
import type {
  CancelNormalRequest,
  CreateNormalRequest,
  NormalRequestActionResponse,
  NormalRequestAdminQueueQuery,
  NormalRequestDetailResponse,
  NormalRequestDraft,
  NormalRequestListResponse,
  ReviewNormalRequest,
} from '@glorychips/contracts';
import { executeIdempotently } from '../idempotency/execute-idempotently.js';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import type { SessionPrincipal } from '../auth/types.js';
import { InventoryTransactionExecutor } from '../inventory/inventory-transaction-executor.js';
import { RequestDomainError } from './errors.js';
import {
  assertAdminAccess,
  assertExpectedReturnDate,
  assertRequestVisible,
  createRequestNumber,
  createReturnObligations,
  isAdminForWarehouse,
  loadRequestDetail,
  loadWarehouseCode,
  lockRequest,
  parseDateOnly,
  requestDetailInclude,
  toJson,
  toRequestDetail as toDetail,
  toRequestSummary as toSummary,
  validateRequestItems,
} from './request-shared.js';

type Transaction = Prisma.TransactionClient;

export class NormalRequestService {
  private readonly inventory = new InventoryTransactionExecutor();

  public constructor(private readonly database: PrismaClient) {}

  public async createAndSubmit(
    rawCommand: CreateNormalRequest,
    idempotencyKey: string,
    principal: SessionPrincipal,
  ): Promise<NormalRequestActionResponse> {
    const command = createNormalRequestSchema.parse(rawCommand);
    assertExpectedReturnDate(command);
    return executeIdempotently({
      database: this.database,
      key: idempotencyKey,
      operation: 'NORMAL_REQUEST_CREATE',
      command: { ...command, claimantId: principal.userId },
      invalidKeyError: () =>
        new RequestDomainError('VALIDATION_ERROR', 'An idempotency key is required.'),
      conflictError: () =>
        new RequestDomainError(
          'IDEMPOTENCY_CONFLICT',
          'The idempotency key was reused with different input.',
        ),
      execute: async (transaction) => {
        const warehouse = await transaction.warehouse.findFirst({
          where: { code: command.warehouse, isActive: true },
        });
        if (warehouse === null) {
          throw new RequestDomainError('REQUEST_ITEM_UNAVAILABLE', 'The warehouse is unavailable.');
        }
        const items = await validateRequestItems(transaction, warehouse.id, command.items);
        const now = new Date();
        const request = await transaction.request.create({
          data: {
            requestNumber: createRequestNumber('NR'),
            warehouseId: warehouse.id,
            claimantId: principal.userId,
            origin: 'ONLINE',
            type: command.type,
            purposeObject: command.purposeObject,
            finalDestination: command.finalDestination,
            notes: command.notes,
            returnMode: command.returnMode,
            expectedReturnDate: parseDateOnly(command.expectedReturnDate),
            status: 'PENDING_APPROVAL',
            submittedAt: now,
            items: { create: items },
          },
        });
        await transaction.auditLog.create({
          data: {
            actorUserId: principal.userId,
            warehouseId: warehouse.id,
            action: 'NORMAL_REQUEST_SUBMITTED',
            entityType: 'REQUEST',
            entityId: request.id,
            after: toJson({ status: 'PENDING_APPROVAL', type: command.type }),
          },
        });
        return normalRequestActionResponseSchema.parse({
          request: toDetail(await loadRequestDetail(transaction, request.id), principal),
        });
      },
    });
  }

  public async resubmit(
    requestId: string,
    rawCommand: NormalRequestDraft,
    idempotencyKey: string,
    principal: SessionPrincipal,
  ): Promise<NormalRequestActionResponse> {
    const command = resubmitNormalRequestSchema.parse(rawCommand);
    assertExpectedReturnDate(command);
    return executeIdempotently({
      database: this.database,
      key: idempotencyKey,
      operation: 'NORMAL_REQUEST_RESUBMIT',
      command: { requestId, ...command, claimantId: principal.userId },
      invalidKeyError: () =>
        new RequestDomainError('VALIDATION_ERROR', 'An idempotency key is required.'),
      conflictError: () =>
        new RequestDomainError(
          'IDEMPOTENCY_CONFLICT',
          'The idempotency key was reused with different input.',
        ),
      execute: async (transaction) => {
        const current = await lockRequest(transaction, requestId);
        if (current.claimantId !== principal.userId) this.forbidden();
        if (current.origin !== 'ONLINE' || current.status !== 'REJECTED') this.stateConflict();
        const items = await validateRequestItems(transaction, current.warehouseId, command.items);
        const now = new Date();
        await transaction.requestItem.deleteMany({ where: { requestId } });
        await transaction.request.update({
          where: { id: requestId },
          data: {
            type: command.type,
            purposeObject: command.purposeObject,
            finalDestination: command.finalDestination,
            notes: command.notes,
            returnMode: command.returnMode,
            expectedReturnDate: parseDateOnly(command.expectedReturnDate),
            status: 'PENDING_APPROVAL',
            submittedAt: now,
            items: { create: items },
          },
        });
        await transaction.auditLog.create({
          data: {
            actorUserId: principal.userId,
            warehouseId: current.warehouseId,
            action: 'NORMAL_REQUEST_RESUBMITTED',
            entityType: 'REQUEST',
            entityId: requestId,
            before: toJson({ status: current.status }),
            after: toJson({ status: 'PENDING_APPROVAL', type: command.type }),
          },
        });
        return normalRequestActionResponseSchema.parse({
          request: toDetail(await loadRequestDetail(transaction, requestId), principal),
        });
      },
    });
  }

  public async listMine(principal: SessionPrincipal): Promise<NormalRequestListResponse> {
    const records = await this.database.request.findMany({
      where: { claimantId: principal.userId, origin: 'ONLINE' },
      include: requestDetailInclude,
      orderBy: { createdAt: 'desc' },
    });
    return normalRequestListResponseSchema.parse({
      items: records.map((record) => toSummary(toDetail(record, principal))),
    });
  }

  public async getVisibleDetail(
    requestId: string,
    principal: SessionPrincipal,
  ): Promise<NormalRequestDetailResponse> {
    const record = await this.database.request.findFirst({
      where: { id: requestId, origin: 'ONLINE' },
      include: requestDetailInclude,
    });
    if (record === null) this.notFound();
    assertRequestVisible(record, principal);
    return normalRequestDetailResponseSchema.parse({ request: toDetail(record, principal) });
  }

  public async listAdminQueue(
    rawQuery: NormalRequestAdminQueueQuery,
    principal: SessionPrincipal,
  ): Promise<NormalRequestListResponse> {
    const query = normalRequestAdminQueueQuerySchema.parse(rawQuery);
    assertAdminAccess(principal, query.warehouse);
    const records = await this.database.request.findMany({
      where: {
        origin: 'ONLINE',
        status: query.status,
        warehouse: { code: query.warehouse },
      },
      include: requestDetailInclude,
      orderBy: { submittedAt: 'asc' },
    });
    return normalRequestListResponseSchema.parse({
      items: records.map((record) => toSummary(toDetail(record, principal))),
    });
  }

  public async review(
    requestId: string,
    rawCommand: ReviewNormalRequest,
    idempotencyKey: string,
    principal: SessionPrincipal,
  ): Promise<NormalRequestActionResponse> {
    const command = reviewNormalRequestSchema.parse(rawCommand);
    return this.executeRequestAction(
      idempotencyKey,
      'NORMAL_REQUEST_REVIEW',
      { requestId, ...command, actorUserId: principal.userId },
      async (transaction) => {
        const current = await lockRequest(transaction, requestId);
        const warehouse = await loadWarehouseCode(transaction, current.warehouseId);
        assertAdminAccess(principal, warehouse);
        if (current.origin !== 'ONLINE' || current.status !== 'PENDING_APPROVAL') {
          this.stateConflict();
        }

        const nextStatus = command.decision === 'APPROVED' ? 'PENDING_RELEASE' : 'REJECTED';
        if (command.decision === 'APPROVED') {
          const detail = await loadRequestDetail(transaction, requestId);
          await validateRequestItems(
            transaction,
            current.warehouseId,
            detail.items.map((item) => ({
              variantId: item.variantId,
              quantity: item.quantity,
            })),
          );
          await this.inventory.reserveBatchInTransaction(
            transaction,
            {
              requestId,
              actorUserId: principal.userId,
              lines: detail.items.map((item) => ({
                warehouseId: current.warehouseId,
                variantId: item.variantId,
                quantity: item.quantity,
              })),
            },
            `${idempotencyKey}:reservation`,
          );
        }
        await transaction.approvalRecord.create({
          data: {
            requestId,
            reviewerId: principal.userId,
            decision: command.decision,
            comment: command.comment,
            previousStatus: current.status,
            nextStatus,
          },
        });
        await transaction.request.update({
          where: { id: requestId },
          data: { status: nextStatus },
        });
        await transaction.auditLog.create({
          data: {
            actorUserId: principal.userId,
            warehouseId: current.warehouseId,
            action:
              command.decision === 'APPROVED'
                ? 'NORMAL_REQUEST_APPROVED'
                : 'NORMAL_REQUEST_REJECTED',
            entityType: 'REQUEST',
            entityId: requestId,
            before: toJson({ status: current.status }),
            after: toJson({ status: nextStatus, comment: command.comment ?? null }),
          },
        });
        return normalRequestActionResponseSchema.parse({
          request: toDetail(await loadRequestDetail(transaction, requestId), principal),
        });
      },
    );
  }

  public async cancel(
    requestId: string,
    rawCommand: CancelNormalRequest,
    idempotencyKey: string,
    principal: SessionPrincipal,
  ): Promise<NormalRequestActionResponse> {
    const command = cancelNormalRequestSchema.parse(rawCommand);
    return this.executeRequestAction(
      idempotencyKey,
      'NORMAL_REQUEST_CANCEL',
      { requestId, ...command, actorUserId: principal.userId },
      async (transaction) => {
        const current = await lockRequest(transaction, requestId);
        const warehouse = await loadWarehouseCode(transaction, current.warehouseId);
        const own = current.claimantId === principal.userId;
        const claimantCanCancel =
          own && (current.status === 'PENDING_APPROVAL' || current.status === 'PENDING_RELEASE');
        const adminCanCancel =
          current.status === 'PENDING_RELEASE' && isAdminForWarehouse(principal, warehouse);
        if (!claimantCanCancel && !adminCanCancel) {
          if (!own && !isAdminForWarehouse(principal, warehouse)) this.forbidden();
          this.stateConflict();
        }
        if (current.status === 'PENDING_RELEASE') {
          const batches = await this.activeReservationBatches(transaction, requestId);
          if (batches.length !== 1 || batches[0] === undefined) this.stateConflict();
          await this.inventory.releaseReservationInTransaction(transaction, {
            batchId: batches[0],
            actorUserId: principal.userId,
          });
        }
        await transaction.request.update({
          where: { id: requestId },
          data: { status: 'CANCELLED' },
        });
        await transaction.auditLog.create({
          data: {
            actorUserId: principal.userId,
            warehouseId: current.warehouseId,
            action: 'NORMAL_REQUEST_CANCELLED',
            entityType: 'REQUEST',
            entityId: requestId,
            before: toJson({ status: current.status }),
            after: toJson({ status: 'CANCELLED', reason: command.reason }),
          },
        });
        return normalRequestActionResponseSchema.parse({
          request: toDetail(await loadRequestDetail(transaction, requestId), principal),
        });
      },
    );
  }

  public async fulfill(
    requestId: string,
    idempotencyKey: string,
    principal: SessionPrincipal,
  ): Promise<NormalRequestActionResponse> {
    return this.executeRequestAction(
      idempotencyKey,
      'NORMAL_REQUEST_FULFILL',
      { requestId, actorUserId: principal.userId },
      async (transaction) => {
        const current = await lockRequest(transaction, requestId);
        const warehouse = await loadWarehouseCode(transaction, current.warehouseId);
        assertAdminAccess(principal, warehouse);
        if (current.origin !== 'ONLINE' || current.status !== 'PENDING_RELEASE') {
          this.stateConflict();
        }
        const detail = await loadRequestDetail(transaction, requestId);
        const batches = await this.activeReservationBatches(transaction, requestId);
        if (batches.length !== 1 || batches[0] === undefined) this.stateConflict();
        const movement = await this.inventory.applyMovementBatchInTransaction(
          transaction,
          {
            businessNumber: current.requestNumber,
            source: 'ONLINE_REQUEST',
            requestId,
            consumeReservationBatchId: batches[0],
            actorUserId: principal.userId,
            lines: detail.items.map((item) => ({
              warehouseId: current.warehouseId,
              variantId: item.variantId,
              quantityDelta: -item.quantity,
              type: 'ISSUE',
            })),
          },
          `${idempotencyKey}:fulfillment`,
        );
        await transaction.fulfillment.create({
          data: { requestId, executorId: principal.userId },
        });
        await createReturnObligations(
          transaction,
          requestId,
          current.returnMode,
          current.expectedReturnDate,
          detail.items,
        );
        const completedAt = new Date();
        await transaction.request.update({
          where: { id: requestId },
          data: { status: 'COMPLETED', syncStatus: 'PENDING', completedAt },
        });
        await transaction.auditLog.create({
          data: {
            actorUserId: principal.userId,
            warehouseId: current.warehouseId,
            action: 'NORMAL_REQUEST_FULFILLED',
            entityType: 'REQUEST',
            entityId: requestId,
            before: toJson({ status: current.status }),
            after: toJson({
              status: 'COMPLETED',
              movementIds: movement.movementIds,
              outboxJobId: movement.outboxJobId,
            }),
          },
        });
        return normalRequestActionResponseSchema.parse({
          request: toDetail(await loadRequestDetail(transaction, requestId), principal),
        });
      },
    );
  }

  private executeRequestAction<T>(
    idempotencyKey: string,
    operation: string,
    command: unknown,
    execute: (transaction: Transaction) => Promise<T>,
  ): Promise<T> {
    return executeIdempotently({
      database: this.database,
      key: idempotencyKey,
      operation,
      command,
      invalidKeyError: () =>
        new RequestDomainError('VALIDATION_ERROR', 'An idempotency key is required.'),
      conflictError: () =>
        new RequestDomainError(
          'IDEMPOTENCY_CONFLICT',
          'The idempotency key was reused with different input.',
        ),
      execute,
    });
  }

  private async activeReservationBatches(
    transaction: Transaction,
    requestId: string,
  ): Promise<readonly string[]> {
    const reservations = await transaction.inventoryReservation.findMany({
      where: { requestId, status: 'ACTIVE' },
      select: { batchId: true },
    });
    return [...new Set(reservations.map((reservation) => reservation.batchId))];
  }

  private notFound(): never {
    throw new RequestDomainError('REQUEST_NOT_FOUND', 'The request was not found.');
  }

  private forbidden(): never {
    throw new RequestDomainError('REQUEST_FORBIDDEN', 'The request is outside the granted scope.');
  }

  private stateConflict(): never {
    throw new RequestDomainError(
      'REQUEST_STATE_CONFLICT',
      'The request cannot perform this action in its current state.',
    );
  }
}
