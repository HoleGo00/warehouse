import { randomUUID } from 'node:crypto';
import {
  calculateAvailability,
  requestActionResponseSchema,
  warehouseCodeSchema,
} from '@glorychips/contracts';
import type {
  RequestActionResponse,
  RequestDetail,
  RequestItemInput,
  RequestSummary,
  RequestType,
  ReturnMode,
  WarehouseCode,
} from '@glorychips/contracts';
import type { SessionPrincipal } from '../auth/types.js';
import type { Prisma } from '../generated/prisma/client.js';
import { RequestDomainError } from './errors.js';

export type RequestTransaction = Prisma.TransactionClient;

export const requestDetailInclude = {
  warehouse: true,
  claimant: true,
  items: { orderBy: { createdAt: 'asc' } },
  approvals: { include: { reviewer: true }, orderBy: { reviewedAt: 'asc' } },
  fulfillment: { include: { executor: true } },
  returnObligations: { orderBy: { createdAt: 'asc' } },
  adminTasks: {
    where: { type: { in: ['PAPERWORK_REQUIRED', 'PAPERWORK_OVERDUE'] } },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.RequestInclude;

export type RequestRecord = Prisma.RequestGetPayload<{ include: typeof requestDetailInclude }>;

export const toJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
export const toDateOnly = (date: Date | null): string | null =>
  date === null ? null : date.toISOString().slice(0, 10);
export const parseDateOnly = (date: string | null | undefined): Date | null =>
  date === undefined || date === null ? null : new Date(`${date}T00:00:00.000Z`);

export const shanghaiDate = (value = new Date()): string => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
};

export const createRequestNumber = (prefix: 'NR' | 'TR' | 'OR'): string =>
  `${prefix}-${shanghaiDate().replaceAll('-', '')}-${randomUUID().slice(0, 8).toUpperCase()}`;

export const isAdminForWarehouse = (
  principal: SessionPrincipal,
  warehouse: WarehouseCode,
): boolean =>
  principal.roles.includes('SYSTEM_ADMIN') ||
  (principal.roles.includes('WAREHOUSE_ADMIN') && principal.warehouses.includes(warehouse));

export const assertAdminAccess = (principal: SessionPrincipal, warehouse: WarehouseCode): void => {
  if (!isAdminForWarehouse(principal, warehouse)) {
    throw new RequestDomainError('REQUEST_FORBIDDEN', 'The request is outside the granted scope.');
  }
};

export const assertRequestVisible = (record: RequestRecord, principal: SessionPrincipal): void => {
  const warehouse = warehouseCodeSchema.parse(record.warehouse.code);
  if (record.claimantId !== principal.userId && !isAdminForWarehouse(principal, warehouse)) {
    throw new RequestDomainError('REQUEST_FORBIDDEN', 'The request is outside the granted scope.');
  }
};

export const assertExpectedReturnDate = (
  command: { readonly returnMode: ReturnMode; readonly expectedReturnDate?: string | null },
  now = new Date(),
): void => {
  if (
    command.returnMode === 'BY_DATE' &&
    command.expectedReturnDate !== undefined &&
    command.expectedReturnDate !== null &&
    command.expectedReturnDate < shanghaiDate(now)
  ) {
    throw new RequestDomainError(
      'VALIDATION_ERROR',
      'The expected return date cannot be in the past.',
    );
  }
};

export const validateRequestItems = async (
  transaction: RequestTransaction,
  warehouseId: string,
  items: readonly RequestItemInput[],
): Promise<
  {
    productId: string;
    variantId: string;
    productNameSnapshot: string;
    sizeSnapshot: string | null;
    quantity: number;
  }[]
> => {
  const variantIds = items.map((item) => item.variantId);
  const variants = await transaction.productVariant.findMany({
    where: { id: { in: variantIds } },
    include: { product: true },
  });
  const byId = new Map(variants.map((variant) => [variant.id, variant]));
  const unavailable = items.filter((item) => {
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
  const shortages = items.flatMap((item) => {
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

  return items.map((item) => {
    const variant = byId.get(item.variantId);
    if (variant === undefined) {
      throw new RequestDomainError('REQUEST_ITEM_UNAVAILABLE', 'A requested variant disappeared.');
    }
    return {
      productId: variant.productId,
      variantId: variant.id,
      productNameSnapshot: variant.product.officialName,
      sizeSnapshot: variant.size,
      quantity: item.quantity,
    };
  });
};

const assertProjectionIntegrity = (record: RequestRecord): void => {
  if (record.origin === 'EXPRESS' && record.adminTasks.length !== 1) {
    throw new RequestDomainError(
      'REQUEST_STATE_CONFLICT',
      'The temporary request must have exactly one paperwork task.',
    );
  }
  if (
    record.origin !== 'EXPRESS' &&
    (record.type === null || record.purposeObject === null || record.finalDestination === null)
  ) {
    throw new RequestDomainError(
      'REQUEST_STATE_CONFLICT',
      'The request contains incomplete business data.',
    );
  }
  if (
    record.origin === 'EXPRESS' &&
    record.status !== 'PENDING_PAPERWORK' &&
    (record.type === null || record.purposeObject === null || record.finalDestination === null)
  ) {
    throw new RequestDomainError(
      'REQUEST_STATE_CONFLICT',
      'The temporary request contains incomplete paperwork.',
    );
  }
};

const allowedActions = (record: RequestRecord, principal: SessionPrincipal) => {
  const own = record.claimantId === principal.userId;
  const warehouse = warehouseCodeSchema.parse(record.warehouse.code);
  const admin = isAdminForWarehouse(principal, warehouse);
  return {
    resubmit: own && record.origin === 'ONLINE' && record.status === 'REJECTED',
    completePaperwork:
      own &&
      record.origin === 'EXPRESS' &&
      (record.status === 'PENDING_PAPERWORK' || record.status === 'REJECTED'),
    cancel:
      own &&
      record.origin === 'ONLINE' &&
      (record.status === 'PENDING_APPROVAL' || record.status === 'PENDING_RELEASE'),
    review:
      admin &&
      (record.origin === 'ONLINE' || record.origin === 'EXPRESS') &&
      record.status === 'PENDING_APPROVAL',
    fulfill: admin && record.origin === 'ONLINE' && record.status === 'PENDING_RELEASE',
    adminCancel: admin && record.origin === 'ONLINE' && record.status === 'PENDING_RELEASE',
  };
};

export const toRequestDetail = (
  record: RequestRecord,
  principal: SessionPrincipal,
  now = new Date(),
): RequestDetail => {
  assertProjectionIntegrity(record);
  const latestApproval = record.approvals.at(-1);
  const paperworkTask = record.adminTasks.at(0) ?? null;
  const paperworkOpen =
    record.origin === 'EXPRESS' &&
    (record.status === 'PENDING_PAPERWORK' || record.status === 'REJECTED');
  return {
    id: record.id,
    requestNumber: record.requestNumber,
    warehouse: warehouseCodeSchema.parse(record.warehouse.code),
    warehouseName: record.warehouse.name,
    claimantId: record.claimantId,
    claimantName: record.claimant.name,
    origin: record.origin,
    type: record.type,
    purposeObject: record.purposeObject,
    finalDestination: record.finalDestination,
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
    paperworkDueAt: paperworkTask?.dueAt?.toISOString() ?? null,
    paperworkOverdue:
      paperworkOpen && paperworkTask?.dueAt !== null && paperworkTask?.dueAt !== undefined
        ? paperworkTask.dueAt.getTime() < now.getTime()
        : false,
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

export const toRequestSummary = (detail: RequestDetail): RequestSummary => ({
  id: detail.id,
  requestNumber: detail.requestNumber,
  warehouse: detail.warehouse,
  warehouseName: detail.warehouseName,
  claimantId: detail.claimantId,
  claimantName: detail.claimantName,
  origin: detail.origin,
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
  paperworkDueAt: detail.paperworkDueAt,
  paperworkOverdue: detail.paperworkOverdue,
  allowedActions: detail.allowedActions,
});

export const loadRequestDetail = async (
  transaction: RequestTransaction,
  requestId: string,
): Promise<RequestRecord> =>
  transaction.request.findUniqueOrThrow({
    where: { id: requestId },
    include: requestDetailInclude,
  });

export const lockRequest = async (transaction: RequestTransaction, requestId: string) => {
  const rows = await transaction.$queryRaw<readonly { id: string }[]>`
    SELECT "id" FROM "requests" WHERE "id" = ${requestId}::uuid FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new RequestDomainError('REQUEST_NOT_FOUND', 'The request was not found.');
  }
  return transaction.request.findUniqueOrThrow({ where: { id: requestId } });
};

export const loadWarehouseCode = async (
  transaction: RequestTransaction,
  warehouseId: string,
): Promise<WarehouseCode> => {
  const warehouse = await transaction.warehouse.findUniqueOrThrow({
    where: { id: warehouseId },
    select: { code: true },
  });
  return warehouseCodeSchema.parse(warehouse.code);
};

export const createReturnObligations = async (
  transaction: RequestTransaction,
  requestId: string,
  returnMode: ReturnMode,
  expectedReturnDate: Date | null,
  items: readonly { readonly variantId: string; readonly quantity: number }[],
): Promise<void> => {
  if (returnMode === 'NOT_REQUIRED') return;
  await transaction.returnObligation.createMany({
    data: items.map((item) => ({
      requestId,
      variantId: item.variantId,
      trigger: returnMode === 'BY_DATE' ? ('DATE' as const) : ('DEPARTURE' as const),
      dueDate: expectedReturnDate,
      requiredQuantity: item.quantity,
    })),
  });
};

export const actionResponse = (
  record: RequestRecord,
  principal: SessionPrincipal,
): RequestActionResponse =>
  requestActionResponseSchema.parse({ request: toRequestDetail(record, principal) });

export const requireCompleteType = (type: RequestType | null): RequestType => {
  if (type === null) {
    throw new RequestDomainError('REQUEST_STATE_CONFLICT', 'The request paperwork is incomplete.');
  }
  return type;
};
