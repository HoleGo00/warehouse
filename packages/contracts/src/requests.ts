import { z } from 'zod';
import {
  approvalDecisionSchema,
  requestOriginSchema,
  requestStatusSchema,
  requestTypeSchema,
  returnModeSchema,
  returnStatusSchema,
  returnTriggerSchema,
  syncStatusSchema,
  warehouseCodeSchema,
} from './enums.js';

const businessTextSchema = z.string().trim().min(1).max(200);
const optionalNotesSchema = z.string().trim().max(1000).optional();
const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD.')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === (month ?? 0) - 1 &&
      date.getUTCDate() === day
    );
  }, 'Expected a valid calendar date.');

export const idempotencyKeySchema = z.string().trim().min(1).max(128);

export const requestItemInputSchema = z.object({
  variantId: z.uuid(),
  quantity: z.number().int().positive().max(10_000),
});
export type RequestItemInput = z.infer<typeof requestItemInputSchema>;
export const normalRequestItemInputSchema = requestItemInputSchema;
export type NormalRequestItemInput = RequestItemInput;

const requestItemsSchema = z.array(requestItemInputSchema).min(1).max(100);
const requestBusinessFieldsSchema = z.object({
  type: requestTypeSchema,
  purposeObject: businessTextSchema,
  finalDestination: businessTextSchema,
  notes: optionalNotesSchema,
  returnMode: returnModeSchema,
  expectedReturnDate: dateOnlySchema.nullable().optional(),
});
const normalRequestFieldsSchema = requestBusinessFieldsSchema.extend({ items: requestItemsSchema });

const refineRequestItems = (
  value: { readonly items: readonly RequestItemInput[] },
  context: z.RefinementCtx,
): void => {
  const variantIds = value.items.map((item) => item.variantId);
  if (new Set(variantIds).size !== variantIds.length) {
    context.addIssue({
      code: 'custom',
      message: 'Each variant may appear only once.',
      path: ['items'],
    });
  }
};

const refineBusinessFields = (
  value: z.infer<typeof requestBusinessFieldsSchema>,
  context: z.RefinementCtx,
): void => {
  const hasDate = value.expectedReturnDate !== undefined && value.expectedReturnDate !== null;
  if (value.type === 'GIFT' || value.type === 'SALE') {
    if (value.returnMode !== 'NOT_REQUIRED' || hasDate) {
      context.addIssue({
        code: 'custom',
        message: 'Gift and sale requests cannot require a return.',
        path: ['returnMode'],
      });
    }
    return;
  }

  if (value.type === 'EXHIBIT') {
    if (value.returnMode !== 'BY_DATE' || !hasDate) {
      context.addIssue({
        code: 'custom',
        message: 'Exhibit requests require a return date.',
        path: ['expectedReturnDate'],
      });
    }
    return;
  }

  if (value.returnMode === 'BY_DATE' && !hasDate) {
    context.addIssue({
      code: 'custom',
      message: 'A return date is required for date-based returns.',
      path: ['expectedReturnDate'],
    });
  }
  if (value.returnMode !== 'BY_DATE' && hasDate) {
    context.addIssue({
      code: 'custom',
      message: 'A return date is only allowed for date-based returns.',
      path: ['expectedReturnDate'],
    });
  }
};

const refineNormalRequest = (
  value: z.infer<typeof normalRequestFieldsSchema>,
  context: z.RefinementCtx,
): void => {
  refineRequestItems(value, context);
  refineBusinessFields(value, context);
};

export const normalRequestDraftSchema = normalRequestFieldsSchema.superRefine(refineNormalRequest);
export type NormalRequestDraft = z.infer<typeof normalRequestDraftSchema>;

export const createNormalRequestSchema = normalRequestFieldsSchema
  .extend({ warehouse: warehouseCodeSchema })
  .superRefine(refineNormalRequest);
export type CreateNormalRequest = z.infer<typeof createNormalRequestSchema>;

export const resubmitNormalRequestSchema = normalRequestDraftSchema;
export type ResubmitNormalRequest = z.infer<typeof resubmitNormalRequestSchema>;

export const createTemporaryRequestSchema = z
  .object({ warehouse: warehouseCodeSchema, items: requestItemsSchema })
  .superRefine(refineRequestItems);
export type CreateTemporaryRequest = z.infer<typeof createTemporaryRequestSchema>;

export const completeTemporaryPaperworkSchema =
  requestBusinessFieldsSchema.superRefine(refineBusinessFields);
export type CompleteTemporaryPaperwork = z.infer<typeof completeTemporaryPaperworkSchema>;

export const createOfflineRequestSchema = normalRequestFieldsSchema
  .extend({ warehouse: warehouseCodeSchema, claimantId: z.uuid() })
  .superRefine(refineNormalRequest);
export type CreateOfflineRequest = z.infer<typeof createOfflineRequestSchema>;

export const reviewNormalRequestSchema = z
  .object({
    decision: approvalDecisionSchema,
    comment: z.string().trim().max(1000).optional(),
  })
  .superRefine((value, context) => {
    if (value.decision === 'REJECTED' && (value.comment?.length ?? 0) === 0) {
      context.addIssue({
        code: 'custom',
        message: 'A rejection comment is required.',
        path: ['comment'],
      });
    }
  });
export type ReviewNormalRequest = z.infer<typeof reviewNormalRequestSchema>;
export const reviewRequestSchema = reviewNormalRequestSchema;
export type ReviewRequest = ReviewNormalRequest;

export const cancelNormalRequestSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});
export type CancelNormalRequest = z.infer<typeof cancelNormalRequestSchema>;

export const fulfillNormalRequestSchema = z.object({}).strict();
export type FulfillNormalRequest = z.infer<typeof fulfillNormalRequestSchema>;

export const normalRequestAdminQueueStatuses = ['PENDING_APPROVAL', 'PENDING_RELEASE'] as const;
export const normalRequestAdminQueueStatusSchema = z.enum(normalRequestAdminQueueStatuses);
export type NormalRequestAdminQueueStatus = z.infer<typeof normalRequestAdminQueueStatusSchema>;

export const normalRequestAdminQueueQuerySchema = z.object({
  warehouse: warehouseCodeSchema,
  status: normalRequestAdminQueueStatusSchema,
});
export type NormalRequestAdminQueueQuery = z.infer<typeof normalRequestAdminQueueQuerySchema>;

export const paperworkQueueStates = ['REQUIRED', 'CORRECTION', 'OVERDUE'] as const;
export const paperworkQueueStateSchema = z.enum(paperworkQueueStates);
export type PaperworkQueueState = z.infer<typeof paperworkQueueStateSchema>;

export const paperworkQueueQuerySchema = z.object({
  warehouse: warehouseCodeSchema,
  state: paperworkQueueStateSchema,
});
export type PaperworkQueueQuery = z.infer<typeof paperworkQueueQuerySchema>;

export const claimantSearchQuerySchema = z.object({
  query: z.string().trim().max(100).default(''),
});
export type ClaimantSearchQuery = z.infer<typeof claimantSearchQuerySchema>;

export const requestAllowedActionsSchema = z.object({
  resubmit: z.boolean(),
  completePaperwork: z.boolean(),
  cancel: z.boolean(),
  review: z.boolean(),
  fulfill: z.boolean(),
  adminCancel: z.boolean(),
});
export type RequestAllowedActions = z.infer<typeof requestAllowedActionsSchema>;
export const normalRequestAllowedActionsSchema = requestAllowedActionsSchema;
export type NormalRequestAllowedActions = RequestAllowedActions;

export const requestItemSchema = z.object({
  id: z.uuid(),
  productId: z.uuid(),
  variantId: z.uuid(),
  productName: z.string().min(1),
  variantName: z.string().min(1),
  size: z.string().min(1).nullable(),
  quantity: z.number().int().positive(),
});
export type RequestItem = z.infer<typeof requestItemSchema>;
export const normalRequestItemSchema = requestItemSchema;
export type NormalRequestItem = RequestItem;

export const requestApprovalSchema = z.object({
  id: z.uuid(),
  reviewerId: z.uuid(),
  reviewerName: z.string().min(1),
  decision: approvalDecisionSchema,
  comment: z.string().nullable(),
  previousStatus: requestStatusSchema,
  nextStatus: requestStatusSchema,
  reviewedAt: z.iso.datetime(),
});
export type RequestApproval = z.infer<typeof requestApprovalSchema>;
export const normalRequestApprovalSchema = requestApprovalSchema;
export type NormalRequestApproval = RequestApproval;

export const requestFulfillmentSchema = z.object({
  id: z.uuid(),
  executorId: z.uuid(),
  executorName: z.string().min(1),
  fulfilledAt: z.iso.datetime(),
});
export type RequestFulfillment = z.infer<typeof requestFulfillmentSchema>;
export const normalRequestFulfillmentSchema = requestFulfillmentSchema;
export type NormalRequestFulfillment = RequestFulfillment;

export const requestReturnObligationSchema = z.object({
  id: z.uuid(),
  variantId: z.uuid(),
  trigger: returnTriggerSchema,
  dueDate: dateOnlySchema.nullable(),
  requiredQuantity: z.number().int().positive(),
  returnedQuantity: z.number().int().nonnegative(),
  status: returnStatusSchema,
});
export type RequestReturnObligation = z.infer<typeof requestReturnObligationSchema>;
export const normalRequestReturnObligationSchema = requestReturnObligationSchema;
export type NormalRequestReturnObligation = RequestReturnObligation;

export const requestSummarySchema = z.object({
  id: z.uuid(),
  requestNumber: z.string().min(1),
  warehouse: warehouseCodeSchema,
  warehouseName: z.string().min(1),
  claimantId: z.uuid(),
  claimantName: z.string().min(1),
  origin: requestOriginSchema,
  type: requestTypeSchema.nullable(),
  purposeObject: z.string().min(1).nullable(),
  finalDestination: z.string().min(1).nullable(),
  returnMode: returnModeSchema,
  expectedReturnDate: dateOnlySchema.nullable(),
  status: requestStatusSchema,
  syncStatus: syncStatusSchema,
  itemCount: z.number().int().positive(),
  totalQuantity: z.number().int().positive(),
  submittedAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  latestReviewComment: z.string().nullable(),
  paperworkDueAt: z.iso.datetime().nullable(),
  paperworkOverdue: z.boolean(),
  allowedActions: requestAllowedActionsSchema,
});
export type RequestSummary = z.infer<typeof requestSummarySchema>;
export const normalRequestSummarySchema = requestSummarySchema;
export type NormalRequestSummary = RequestSummary;

export const requestDetailSchema = requestSummarySchema.extend({
  notes: z.string().nullable(),
  items: z.array(requestItemSchema).min(1),
  approvals: z.array(requestApprovalSchema),
  fulfillment: requestFulfillmentSchema.nullable(),
  returnObligations: z.array(requestReturnObligationSchema),
});
export type RequestDetail = z.infer<typeof requestDetailSchema>;
export const normalRequestDetailSchema = requestDetailSchema;
export type NormalRequestDetail = RequestDetail;

export const requestListResponseSchema = z.object({ items: z.array(requestSummarySchema) });
export type RequestListResponse = z.infer<typeof requestListResponseSchema>;
export const normalRequestListResponseSchema = requestListResponseSchema;
export type NormalRequestListResponse = RequestListResponse;

export const requestDetailResponseSchema = z.object({ request: requestDetailSchema });
export type RequestDetailResponse = z.infer<typeof requestDetailResponseSchema>;
export const normalRequestDetailResponseSchema = requestDetailResponseSchema;
export type NormalRequestDetailResponse = RequestDetailResponse;

export const requestActionResponseSchema = requestDetailResponseSchema;
export type RequestActionResponse = z.infer<typeof requestActionResponseSchema>;
export const normalRequestActionResponseSchema = requestActionResponseSchema;
export type NormalRequestActionResponse = RequestActionResponse;

export const claimantCandidateSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  avatarUrl: z.url().nullable(),
});
export type ClaimantCandidate = z.infer<typeof claimantCandidateSchema>;

export const claimantCandidateListResponseSchema = z.object({
  items: z.array(claimantCandidateSchema),
});
export type ClaimantCandidateListResponse = z.infer<typeof claimantCandidateListResponseSchema>;
