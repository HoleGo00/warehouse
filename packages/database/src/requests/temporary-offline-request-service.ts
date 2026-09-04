import {
  completeTemporaryPaperworkSchema,
  createOfflineRequestSchema,
  createTemporaryRequestSchema,
  reviewRequestSchema,
} from '@glorychips/contracts';
import type {
  CompleteTemporaryPaperwork,
  CreateOfflineRequest,
  CreateTemporaryRequest,
  RequestActionResponse,
  ReviewRequest,
} from '@glorychips/contracts';
import type { SessionPrincipal } from '../auth/types.js';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { executeIdempotently } from '../idempotency/execute-idempotently.js';
import { InventoryTransactionExecutor } from '../inventory/inventory-transaction-executor.js';
import { RequestDomainError } from './errors.js';
import {
  actionResponse,
  assertAdminAccess,
  assertExpectedReturnDate,
  createRequestNumber,
  createReturnObligations,
  loadRequestDetail,
  loadWarehouseCode,
  lockRequest,
  parseDateOnly,
  requireCompleteType,
  toJson,
  validateRequestItems,
} from './request-shared.js';
import { WorkCalendarService } from './work-calendar-service.js';

type Transaction = Prisma.TransactionClient;

export class TemporaryOfflineRequestService {
  private readonly inventory = new InventoryTransactionExecutor();

  public constructor(private readonly database: PrismaClient) {}

  public async createTemporary(
    rawCommand: CreateTemporaryRequest,
    idempotencyKey: string,
    principal: SessionPrincipal,
  ): Promise<RequestActionResponse> {
    const command = createTemporaryRequestSchema.parse(rawCommand);
    return this.executeRequestAction(
      idempotencyKey,
      'TEMPORARY_REQUEST_CREATE',
      { ...command, claimantId: principal.userId },
      async (transaction) => {
        const warehouse = await transaction.warehouse.findFirst({
          where: { code: command.warehouse, isActive: true },
        });
        if (warehouse === null) {
          throw new RequestDomainError('REQUEST_ITEM_UNAVAILABLE', 'The warehouse is unavailable.');
        }
        const items = await validateRequestItems(transaction, warehouse.id, command.items);
        const submittedAt = new Date();
        const dueAt = await new WorkCalendarService(transaction).deadlineAfterWorkingDays(
          submittedAt,
          3,
        );
        const request = await transaction.request.create({
          data: {
            requestNumber: createRequestNumber('TR'),
            warehouseId: warehouse.id,
            claimantId: principal.userId,
            origin: 'EXPRESS',
            type: null,
            purposeObject: null,
            finalDestination: null,
            notes: null,
            returnMode: 'NOT_REQUIRED',
            expectedReturnDate: null,
            status: 'PENDING_PAPERWORK',
            submittedAt,
            items: { create: items },
          },
        });
        const movement = await this.inventory.applyMovementBatchInTransaction(
          transaction,
          {
            businessNumber: request.requestNumber,
            source: 'EXPRESS',
            requestId: request.id,
            actorUserId: principal.userId,
            lines: items.map((item) => ({
              warehouseId: warehouse.id,
              variantId: item.variantId,
              quantityDelta: -item.quantity,
              type: 'ISSUE',
            })),
          },
          `${idempotencyKey}:temporary-issue`,
        );
        await transaction.fulfillment.create({
          data: { requestId: request.id, executorId: principal.userId },
        });
        await transaction.adminTask.create({
          data: {
            type: 'PAPERWORK_REQUIRED',
            severity: 'WARNING',
            warehouseId: warehouse.id,
            requestId: request.id,
            title: `待补手续 ${request.requestNumber}`,
            dueAt,
            detail: toJson({ claimantId: principal.userId }),
          },
        });
        await transaction.request.update({
          where: { id: request.id },
          data: { syncStatus: 'PENDING' },
        });
        await transaction.auditLog.create({
          data: {
            actorUserId: principal.userId,
            warehouseId: warehouse.id,
            action: 'TEMPORARY_REQUEST_ISSUED',
            entityType: 'REQUEST',
            entityId: request.id,
            after: toJson({
              status: 'PENDING_PAPERWORK',
              dueAt,
              claimantId: principal.userId,
              movementIds: movement.movementIds,
              outboxJobId: movement.outboxJobId,
            }),
          },
        });
        return actionResponse(await loadRequestDetail(transaction, request.id), principal);
      },
    );
  }

  public async completePaperwork(
    requestId: string,
    rawCommand: CompleteTemporaryPaperwork,
    idempotencyKey: string,
    principal: SessionPrincipal,
  ): Promise<RequestActionResponse> {
    const command = completeTemporaryPaperworkSchema.parse(rawCommand);
    assertExpectedReturnDate(command);
    return this.executeRequestAction(
      idempotencyKey,
      'TEMPORARY_REQUEST_COMPLETE_PAPERWORK',
      { requestId, ...command, claimantId: principal.userId },
      async (transaction) => {
        const current = await lockRequest(transaction, requestId);
        if (current.claimantId !== principal.userId) this.forbidden();
        if (
          current.origin !== 'EXPRESS' ||
          (current.status !== 'PENDING_PAPERWORK' && current.status !== 'REJECTED')
        ) {
          this.stateConflict();
        }
        const paperworkTasks = await transaction.adminTask.findMany({
          where: {
            requestId,
            type: { in: ['PAPERWORK_REQUIRED', 'PAPERWORK_OVERDUE'] },
          },
          orderBy: { createdAt: 'asc' },
        });
        const paperworkTask = paperworkTasks.at(0);
        if (
          paperworkTasks.length !== 1 ||
          paperworkTask === undefined ||
          paperworkTask.status !== 'OPEN' ||
          paperworkTask.dueAt === null
        ) {
          this.stateConflict();
        }
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
          },
        });
        await transaction.adminTask.update({
          where: { id: paperworkTask.id },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
        await transaction.auditLog.create({
          data: {
            actorUserId: principal.userId,
            warehouseId: current.warehouseId,
            action: 'TEMPORARY_REQUEST_PAPERWORK_SUBMITTED',
            entityType: 'REQUEST',
            entityId: requestId,
            before: toJson({ status: current.status }),
            after: toJson({
              status: 'PENDING_APPROVAL',
              type: command.type,
              claimantId: current.claimantId,
              dueAt: paperworkTask.dueAt,
            }),
          },
        });
        return actionResponse(await loadRequestDetail(transaction, requestId), principal);
      },
    );
  }

  public async reviewTemporary(
    requestId: string,
    rawCommand: ReviewRequest,
    idempotencyKey: string,
    principal: SessionPrincipal,
  ): Promise<RequestActionResponse> {
    const command = reviewRequestSchema.parse(rawCommand);
    return this.executeRequestAction(
      idempotencyKey,
      'TEMPORARY_REQUEST_REVIEW',
      { requestId, ...command, actorUserId: principal.userId },
      async (transaction) => {
        const current = await lockRequest(transaction, requestId);
        const warehouse = await loadWarehouseCode(transaction, current.warehouseId);
        assertAdminAccess(principal, warehouse);
        if (current.origin !== 'EXPRESS' || current.status !== 'PENDING_APPROVAL') {
          this.stateConflict();
        }
        requireCompleteType(current.type);
        if (current.purposeObject === null || current.finalDestination === null) {
          this.stateConflict();
        }
        const detail = await loadRequestDetail(transaction, requestId);
        const paperworkTask = detail.adminTasks.at(0);
        if (
          detail.adminTasks.length !== 1 ||
          paperworkTask === undefined ||
          paperworkTask.dueAt === null ||
          paperworkTask.status !== 'COMPLETED'
        ) {
          this.stateConflict();
        }
        const nextStatus = command.decision === 'APPROVED' ? 'COMPLETED' : 'REJECTED';
        if (command.decision === 'APPROVED') {
          await createReturnObligations(
            transaction,
            requestId,
            current.returnMode,
            current.expectedReturnDate,
            detail.items,
          );
        } else {
          const overdue = paperworkTask.dueAt.getTime() < Date.now();
          await transaction.adminTask.update({
            where: { id: paperworkTask.id },
            data: {
              type: overdue ? 'PAPERWORK_OVERDUE' : 'PAPERWORK_REQUIRED',
              severity: overdue ? 'CRITICAL' : 'WARNING',
              status: 'OPEN',
              completedAt: null,
            },
          });
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
          data: {
            status: nextStatus,
            completedAt: command.decision === 'APPROVED' ? new Date() : null,
          },
        });
        await transaction.auditLog.create({
          data: {
            actorUserId: principal.userId,
            warehouseId: current.warehouseId,
            action:
              command.decision === 'APPROVED'
                ? 'TEMPORARY_REQUEST_PAPERWORK_APPROVED'
                : 'TEMPORARY_REQUEST_PAPERWORK_REJECTED',
            entityType: 'REQUEST',
            entityId: requestId,
            before: toJson({ status: current.status }),
            after: toJson({
              status: nextStatus,
              comment: command.comment ?? null,
              claimantId: current.claimantId,
              dueAt: paperworkTask.dueAt,
            }),
          },
        });
        return actionResponse(await loadRequestDetail(transaction, requestId), principal);
      },
    );
  }

  public async createOffline(
    rawCommand: CreateOfflineRequest,
    idempotencyKey: string,
    principal: SessionPrincipal,
  ): Promise<RequestActionResponse> {
    const command = createOfflineRequestSchema.parse(rawCommand);
    assertExpectedReturnDate(command);
    return this.executeRequestAction(
      idempotencyKey,
      'OFFLINE_REQUEST_CREATE',
      { ...command, actorUserId: principal.userId },
      async (transaction) => {
        const warehouse = await transaction.warehouse.findFirst({
          where: { code: command.warehouse, isActive: true },
        });
        if (warehouse === null) {
          throw new RequestDomainError('REQUEST_ITEM_UNAVAILABLE', 'The warehouse is unavailable.');
        }
        assertAdminAccess(principal, command.warehouse);
        const claimant = await transaction.user.findFirst({
          where: {
            id: command.claimantId,
            status: 'ACTIVE',
            userRoles: { some: { role: { code: 'CLAIMANT' } } },
          },
        });
        if (claimant === null) {
          throw new RequestDomainError(
            'CLAIMANT_NOT_FOUND',
            'The selected claimant is unavailable.',
          );
        }
        const items = await validateRequestItems(transaction, warehouse.id, command.items);
        const now = new Date();
        const request = await transaction.request.create({
          data: {
            requestNumber: createRequestNumber('OR'),
            warehouseId: warehouse.id,
            claimantId: claimant.id,
            origin: 'OFFLINE',
            type: command.type,
            purposeObject: command.purposeObject,
            finalDestination: command.finalDestination,
            notes: command.notes,
            returnMode: command.returnMode,
            expectedReturnDate: parseDateOnly(command.expectedReturnDate),
            status: 'COMPLETED',
            syncStatus: 'PENDING',
            submittedAt: now,
            completedAt: now,
            items: { create: items },
          },
        });
        const movement = await this.inventory.applyMovementBatchInTransaction(
          transaction,
          {
            businessNumber: request.requestNumber,
            source: 'OFFLINE',
            requestId: request.id,
            actorUserId: principal.userId,
            lines: items.map((item) => ({
              warehouseId: warehouse.id,
              variantId: item.variantId,
              quantityDelta: -item.quantity,
              type: 'ISSUE',
            })),
          },
          `${idempotencyKey}:offline-issue`,
        );
        await transaction.fulfillment.create({
          data: { requestId: request.id, executorId: principal.userId },
        });
        await createReturnObligations(
          transaction,
          request.id,
          command.returnMode,
          parseDateOnly(command.expectedReturnDate),
          items,
        );
        await transaction.auditLog.create({
          data: {
            actorUserId: principal.userId,
            warehouseId: warehouse.id,
            action: 'OFFLINE_REQUEST_RECORDED',
            entityType: 'REQUEST',
            entityId: request.id,
            after: toJson({
              status: 'COMPLETED',
              claimantId: claimant.id,
              recorderId: principal.userId,
              movementIds: movement.movementIds,
              outboxJobId: movement.outboxJobId,
            }),
          },
        });
        return actionResponse(await loadRequestDetail(transaction, request.id), principal);
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
