import { randomUUID } from 'node:crypto';
import {
  calculateAvailability,
  cancelNormalRequestSchema,
  createNormalRequestSchema,
  normalRequestActionResponseSchema,
  normalRequestAdminQueueQuerySchema,
  normalRequestDetailResponseSchema,
  normalRequestListResponseSchema,
  resubmitNormalRequestSchema,
  reviewNormalRequestSchema,
  warehouseCodeSchema,
} from '@glorychips/contracts';
import type {
  CancelNormalRequest,
  CreateNormalRequest,
  NormalRequestActionResponse,
  NormalRequestAdminQueueQuery,
  NormalRequestDetail,
  NormalRequestDetailResponse,
  NormalRequestDraft,
  NormalRequestListResponse,
  ReviewNormalRequest,
  WarehouseCode,
} from '@glorychips/contracts';
import { executeIdempotently } from '../idempotency/execute-idempotently.js';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import type { SessionPrincipal } from '../auth/types.js';
import { InventoryTransactionExecutor } from '../inventory/inventory-transaction-executor.js';
import { RequestDomainError } from './errors.js';

type Transaction = Prisma.TransactionClient;

const requestDetailInclude = {
  warehouse: true,
  claimant: true,
  items: { orderBy: { createdAt: 'asc' } },
  approvals: { include: { reviewer: true }, orderBy: { reviewedAt: 'asc' } },
  fulfillment: { include: { executor: true } },
  returnObligations: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.RequestInclude;

type RequestRecord = Prisma.RequestGetPayload<{ include: typeof requestDetailInclude }>;

const toJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const toDateOnly = (date: Date | null): string | null =>
  date === null ? null : date.toISOString().slice(0, 10);
const parseDateOnly = (date: string | null | undefined): Date | null =>
  date === undefined || date === null ? null : new Date(`${date}T00:00:00.000Z`);
const shanghaiToday = (): string => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
};

const createRequestNumber = (): string =>
  `NR-${shanghaiToday().replaceAll('-', '')}-${randomUUID().slice(0, 8).toUpperCase()}`;

const isAdminForWarehouse = (principal: SessionPrincipal, warehouse: WarehouseCode): boolean =>
  principal.roles.includes('SYSTEM_ADMIN') ||
  (principal.roles.includes('WAREHOUSE_ADMIN') && principal.warehouses.includes(warehouse));

const allowedActions = (record: RequestRecord, principal: SessionPrincipal) => {
  const own = record.claimantId === principal.userId;
  const warehouse = warehouseCodeSchema.parse(record.warehouse.code);
  const admin = isAdminForWarehouse(principal, warehouse);
  return {
    resubmit: own && record.status === 'REJECTED',
    cancel: own && (record.status === 'PENDING_APPROVAL' || record.status === 'PENDING_RELEASE'),
    review: admin && record.status === 'PENDING_APPROVAL',
    fulfill: admin && record.status === 'PENDING_RELEASE',
    adminCancel: admin && record.status === 'PENDING_RELEASE',
  };
};

const toDetail = (record: RequestRecord, principal: SessionPrincipal): NormalRequestDetail => {
  const latestApproval = record.approvals.at(-1);
  return {
    id: record.id,
    requestNumber: record.requestNumber,
    warehouse: warehouseCodeSchema.parse(record.warehouse.code),
    warehouseName: record.warehouse.name,
    claimantId: record.claimantId,
    claimantName: record.claimant.name,
    type: record.type,
    purposeObject: record.purposeObject ?? '未填写',
    finalDestination: record.finalDestination ?? '未填写',
    notes: record.notes,
    returnMode: record.returnMode,
    expectedReturnDate: toDateOnly(record.expectedReturnDate),
    status: record.status,
    syncStatus: record.syncStatus,
    itemCount: record.items.length,
    totalQuantity: record.items.reduce((sum, item) => sum + item.quantity, 0),
    submittedAt: (record.submittedAt ?? record.createdAt).toISOString(),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    latestReviewComment: latestApproval?.comment ?? null,
    allowedActions: allowedActions(record, principal),
    items: record.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      variantId: item.variantId,
      productName: item.productNameSnapshot,
      variantName:
        item.sizeSnapshot === null
          ? item.productNameSnapshot
          : `${item.productNameSnapshot} ${item.sizeSnapshot}`,
      size: item.sizeSnapshot,
      quantity: item.quantity,
    })),
    approvals: record.approvals.map((approval) => ({
      id: approval.id,
      reviewerId: approval.reviewerId,
      reviewerName: approval.reviewer.name,
      decision: approval.decision,
      comment: approval.comment,
      previousStatus: approval.previousStatus,
      nextStatus: approval.nextStatus,
      reviewedAt: approval.reviewedAt.toISOString(),
    })),
    fulfillment:
      record.fulfillment === null
        ? null
        : {
            id: record.fulfillment.id,
            executorId: record.fulfillment.executorId,
            executorName: record.fulfillment.executor.name,
            fulfilledAt: record.fulfillment.fulfilledAt.toISOString(),
          },
    returnObligations: record.returnObligations.map((obligation) => ({
      id: obligation.id,
      variantId: obligation.variantId,
      trigger: obligation.trigger,
      dueDate: toDateOnly(obligation.dueDate),
      requiredQuantity: obligation.requiredQuantity,
      returnedQuantity: obligation.returnedQuantity,
      status: obligation.status,
    })),
  };
};

const toSummary = (detail: NormalRequestDetail) => ({
  id: detail.id,
  requestNumber: detail.requestNumber,
  warehouse: detail.warehouse,
  warehouseName: detail.warehouseName,
  claimantId: detail.claimantId,
  claimantName: detail.claimantName,
  type: detail.type,
  purposeObject: detail.purposeObject,
  finalDestination: detail.finalDestination,
  returnMode: detail.returnMode,
  expectedReturnDate: detail.expectedReturnDate,
  status: detail.status,
  syncStatus: detail.syncStatus,
  itemCount: detail.itemCount,
  totalQuantity: detail.totalQuantity,
  submittedAt: detail.submittedAt,
  createdAt: detail.createdAt,
  updatedAt: detail.updatedAt,
  latestReviewComment: detail.latestReviewComment,
  allowedActions: detail.allowedActions,
});

export class NormalRequestService {
  private readonly inventory = new InventoryTransactionExecutor();

  public constructor(private readonly database: PrismaClient) {}

  public async createAndSubmit(
    rawCommand: CreateNormalRequest,
    idempotencyKey: string,
    principal: SessionPrincipal,
  ): Promise<NormalRequestActionResponse> {
    const command = createNormalRequestSchema.parse(rawCommand);
    this.assertExpectedReturnDate(command);
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
        const items = await this.validateItems(transaction, warehouse.id, command);
        const now = new Date();
        const request = await transaction.request.create({
          data: {
            requestNumber: createRequestNumber(),
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
          request: toDetail(await this.loadDetail(transaction, request.id), principal),
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
    this.assertExpectedReturnDate(command);
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
        const current = await this.lockRequest(transaction, requestId);
        if (current.claimantId !== principal.userId) this.forbidden();
        if (current.origin !== 'ONLINE' || current.status !== 'REJECTED') this.stateConflict();
        const items = await this.validateItems(transaction, current.warehouseId, command);
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
          request: toDetail(await this.loadDetail(transaction, requestId), principal),
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
    this.assertVisible(record, principal);
    return normalRequestDetailResponseSchema.parse({ request: toDetail(record, principal) });
  }

  public async listAdminQueue(
    rawQuery: NormalRequestAdminQueueQuery,
    principal: SessionPrincipal,
  ): Promise<NormalRequestListResponse> {
    const query = normalRequestAdminQueueQuerySchema.parse(rawQuery);
    this.assertAdminAccess(principal, query.warehouse);
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
        const current = await this.lockRequest(transaction, requestId);
        const warehouse = await this.loadWarehouseCode(transaction, current.warehouseId);
        this.assertAdminAccess(principal, warehouse);
        if (current.origin !== 'ONLINE' || current.status !== 'PENDING_APPROVAL') {
          this.stateConflict();
        }

        const nextStatus = command.decision === 'APPROVED' ? 'PENDING_RELEASE' : 'REJECTED';
        if (command.decision === 'APPROVED') {
          const detail = await this.loadDetail(transaction, requestId);
          await this.validateItems(transaction, current.warehouseId, {
            type: current.type,
            purposeObject: current.purposeObject ?? '未填写',
            finalDestination: current.finalDestination ?? '未填写',
            returnMode: current.returnMode,
            expectedReturnDate: toDateOnly(current.expectedReturnDate),
            items: detail.items.map((item) => ({
              variantId: item.variantId,
              quantity: item.quantity,
            })),
          });
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
          request: toDetail(await this.loadDetail(transaction, requestId), principal),
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
        const current = await this.lockRequest(transaction, requestId);
        const warehouse = await this.loadWarehouseCode(transaction, current.warehouseId);
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
          request: toDetail(await this.loadDetail(transaction, requestId), principal),
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
        const current = await this.lockRequest(transaction, requestId);
        const warehouse = await this.loadWarehouseCode(transaction, current.warehouseId);
        this.assertAdminAccess(principal, warehouse);
        if (current.origin !== 'ONLINE' || current.status !== 'PENDING_RELEASE') {
          this.stateConflict();
        }
        const detail = await this.loadDetail(transaction, requestId);
        const batches = await this.activeReservationBatches(transaction, requestId);
        if (batches.length !== 1 || batches[0] === undefined) this.stateConflict();
        const movement = await this.inventory.applyMovementBatchInTransaction(
          transaction,
          {
            businessNumber: current.requestNumber,
            source: 'ONLINE',
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
        if (current.returnMode !== 'NOT_REQUIRED') {
          await transaction.returnObligation.createMany({
            data: detail.items.map((item) => ({
              requestId,
              variantId: item.variantId,
              trigger: current.returnMode === 'BY_DATE' ? 'DATE' : 'DEPARTURE',
              dueDate: current.expectedReturnDate,
              requiredQuantity: item.quantity,
            })),
          });
        }
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
          request: toDetail(await this.loadDetail(transaction, requestId), principal),
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

  private assertExpectedReturnDate(command: NormalRequestDraft): void {
    if (
      command.returnMode === 'BY_DATE' &&
      command.expectedReturnDate !== undefined &&
      command.expectedReturnDate !== null &&
      command.expectedReturnDate < shanghaiToday()
    ) {
      throw new RequestDomainError(
        'VALIDATION_ERROR',
        'The expected return date cannot be in the past.',
      );
    }
  }

  private async validateItems(
    transaction: Transaction,
    warehouseId: string,
    command: NormalRequestDraft,
  ): Promise<
    {
      productId: string;
      variantId: string;
      productNameSnapshot: string;
      sizeSnapshot: string | null;
      quantity: number;
    }[]
  > {
    const variantIds = command.items.map((item) => item.variantId);
    const variants = await transaction.productVariant.findMany({
      where: { id: { in: variantIds } },
      include: { product: true },
    });
    const byId = new Map(variants.map((variant) => [variant.id, variant]));
    const unavailable = command.items.filter((item) => {
      const variant = byId.get(item.variantId);
      return variant === undefined || !variant.isActive || variant.product.status !== 'ACTIVE';
    });
    if (unavailable.length > 0) {
      throw new RequestDomainError(
        'REQUEST_ITEM_UNAVAILABLE',
        'One or more requested variants are unavailable.',
        { variantIds: unavailable.map((item) => item.variantId) },
      );
    }

    const balances = await transaction.inventoryBalance.findMany({
      where: { warehouseId, variantId: { in: variantIds } },
    });
    const balanceByVariant = new Map(balances.map((balance) => [balance.variantId, balance]));
    const shortages = command.items.flatMap((item) => {
      const balance = balanceByVariant.get(item.variantId);
      const availableQuantity =
        balance === undefined ? 0 : calculateAvailability(balance).availableQuantity;
      return availableQuantity < item.quantity ? [{ ...item, availableQuantity }] : [];
    });
    if (shortages.length > 0) {
      throw new RequestDomainError(
        'INVENTORY_INSUFFICIENT',
        'One or more requested variants have insufficient inventory.',
        { shortages },
      );
    }

    return command.items.map((item) => {
      const variant = byId.get(item.variantId);
      if (variant === undefined) {
        throw new RequestDomainError(
          'REQUEST_ITEM_UNAVAILABLE',
          'A requested variant disappeared.',
        );
      }
      return {
        productId: variant.productId,
        variantId: variant.id,
        productNameSnapshot: variant.product.officialName,
        sizeSnapshot: variant.size,
        quantity: item.quantity,
      };
    });
  }

  private async lockRequest(transaction: Transaction, requestId: string) {
    const rows = await transaction.$queryRaw<readonly { id: string }[]>`
      SELECT "id" FROM "requests" WHERE "id" = ${requestId}::uuid FOR UPDATE
    `;
    if (rows.length === 0) this.notFound();
    return transaction.request.findUniqueOrThrow({ where: { id: requestId } });
  }

  private async loadDetail(transaction: Transaction, requestId: string): Promise<RequestRecord> {
    return transaction.request.findUniqueOrThrow({
      where: { id: requestId },
      include: requestDetailInclude,
    });
  }

  private async loadWarehouseCode(
    transaction: Transaction,
    warehouseId: string,
  ): Promise<WarehouseCode> {
    const warehouse = await transaction.warehouse.findUniqueOrThrow({
      where: { id: warehouseId },
      select: { code: true },
    });
    return warehouseCodeSchema.parse(warehouse.code);
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

  private assertVisible(record: RequestRecord, principal: SessionPrincipal): void {
    const warehouse = warehouseCodeSchema.parse(record.warehouse.code);
    if (record.claimantId !== principal.userId && !isAdminForWarehouse(principal, warehouse)) {
      this.forbidden();
    }
  }

  private assertAdminAccess(principal: SessionPrincipal, warehouse: WarehouseCode): void {
    if (!isAdminForWarehouse(principal, warehouse)) this.forbidden();
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
