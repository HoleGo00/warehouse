import { z } from 'zod';
import {
  approvalDecisionSchema,
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

export const normalRequestItemInputSchema = z.object({
  variantId: z.uuid(),
  quantity: z.number().int().positive().max(10_000),
});
export type NormalRequestItemInput = z.infer<typeof normalRequestItemInputSchema>;

const normalRequestFieldsSchema = z.object({
  type: requestTypeSchema,
  purposeObject: businessTextSchema,
  finalDestination: businessTextSchema,
  notes: optionalNotesSchema,
  returnMode: returnModeSchema,
  expectedReturnDate: dateOnlySchema.nullable().optional(),
  items: z.array(normalRequestItemInputSchema).min(1).max(100),
});

const refineNormalRequest = (
  value: z.infer<typeof normalRequestFieldsSchema>,
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

export const normalRequestDraftSchema = normalRequestFieldsSchema.superRefine(refineNormalRequest);
export type NormalRequestDraft = z.infer<typeof normalRequestDraftSchema>;

export const createNormalRequestSchema = normalRequestFieldsSchema
  .extend({ warehouse: warehouseCodeSchema })
  .superRefine(refineNormalRequest);
export type CreateNormalRequest = z.infer<typeof createNormalRequestSchema>;

export const resubmitNormalRequestSchema = normalRequestDraftSchema;
export type ResubmitNormalRequest = z.infer<typeof resubmitNormalRequestSchema>;

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

export const normalRequestAllowedActionsSchema = z.object({
  resubmit: z.boolean(),
  cancel: z.boolean(),
  review: z.boolean(),
  fulfill: z.boolean(),
  adminCancel: z.boolean(),
});
export type NormalRequestAllowedActions = z.infer<typeof normalRequestAllowedActionsSchema>;

export const normalRequestItemSchema = z.object({
  id: z.uuid(),
  productId: z.uuid(),
  variantId: z.uuid(),
  productName: z.string().min(1),
  variantName: z.string().min(1),
  size: z.string().min(1).nullable(),
  quantity: z.number().int().positive(),
});
export type NormalRequestItem = z.infer<typeof normalRequestItemSchema>;

export const normalRequestApprovalSchema = z.object({
  id: z.uuid(),
  reviewerId: z.uuid(),
  reviewerName: z.string().min(1),
  decision: approvalDecisionSchema,
  comment: z.string().nullable(),
  previousStatus: requestStatusSchema,
  nextStatus: requestStatusSchema,
  reviewedAt: z.iso.datetime(),
});
export type NormalRequestApproval = z.infer<typeof normalRequestApprovalSchema>;

export const normalRequestFulfillmentSchema = z.object({
  id: z.uuid(),
  executorId: z.uuid(),
  executorName: z.string().min(1),
  fulfilledAt: z.iso.datetime(),
});
export type NormalRequestFulfillment = z.infer<typeof normalRequestFulfillmentSchema>;

export const normalRequestReturnObligationSchema = z.object({
  id: z.uuid(),
  variantId: z.uuid(),
  trigger: returnTriggerSchema,
  dueDate: dateOnlySchema.nullable(),
  requiredQuantity: z.number().int().positive(),
  returnedQuantity: z.number().int().nonnegative(),
  status: returnStatusSchema,
});
export type NormalRequestReturnObligation = z.infer<typeof normalRequestReturnObligationSchema>;

export const normalRequestSummarySchema = z.object({
  id: z.uuid(),
  requestNumber: z.string().min(1),
  warehouse: warehouseCodeSchema,
  warehouseName: z.string().min(1),
  claimantId: z.uuid(),
  claimantName: z.string().min(1),
  type: requestTypeSchema,
  purposeObject: z.string().min(1),
  finalDestination: z.string().min(1),
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
  allowedActions: normalRequestAllowedActionsSchema,
});
export type NormalRequestSummary = z.infer<typeof normalRequestSummarySchema>;

export const normalRequestDetailSchema = normalRequestSummarySchema.extend({
  notes: z.string().nullable(),
  items: z.array(normalRequestItemSchema).min(1),
  approvals: z.array(normalRequestApprovalSchema),
  fulfillment: normalRequestFulfillmentSchema.nullable(),
  returnObligations: z.array(normalRequestReturnObligationSchema),
});
export type NormalRequestDetail = z.infer<typeof normalRequestDetailSchema>;

export const normalRequestListResponseSchema = z.object({
  items: z.array(normalRequestSummarySchema),
});
export type NormalRequestListResponse = z.infer<typeof normalRequestListResponseSchema>;

export const normalRequestDetailResponseSchema = z.object({ request: normalRequestDetailSchema });
export type NormalRequestDetailResponse = z.infer<typeof normalRequestDetailResponseSchema>;

export const normalRequestActionResponseSchema = normalRequestDetailResponseSchema;
export type NormalRequestActionResponse = z.infer<typeof normalRequestActionResponseSchema>;
