import { z } from 'zod';
import {
  inventoryMovementTypeSchema,
  productCategoryCodeSchema,
  requestOriginSchema,
  requestStatusSchema,
  requestTypeSchema,
  ringSizeSchema,
  roleCodeSchema,
  syncStatusSchema,
  userStatusSchema,
  warehouseCodeSchema,
} from './enums.js';
import { accessProfileSchema } from './auth.js';
import { dateOnlySchema } from './inventory-operations.js';

export const reportCursorSchema = z
  .object({
    id: z.uuid(),
    date: z.iso.datetime(),
    hash: z.string().length(64),
  })
  .strict();

export const reportFiltersSchema = z
  .object({
    dateMode: z.enum(['SUBMITTED', 'FULFILLED']).default('SUBMITTED'),
    from: dateOnlySchema.optional(),
    to: dateOnlySchema.optional(),
    warehouse: warehouseCodeSchema.optional(),
    claimantId: z.uuid().optional(),
    category: productCategoryCodeSchema.optional(),
    productId: z.uuid().optional(),
    size: ringSizeSchema.optional(),
    type: requestTypeSchema.optional(),
    origin: requestOriginSchema.optional(),
    status: requestStatusSchema.optional(),
    syncStatus: syncStatusSchema.optional(),
    finalDestination: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: '起始日期不能晚于结束日期。',
    path: ['to'],
  });
export type ReportFilters = z.infer<typeof reportFiltersSchema>;
export const reportPageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(2048).optional(),
});
export const reportQuerySchema = reportFiltersSchema.safeExtend(reportPageSchema.shape);
export type ReportQuery = z.infer<typeof reportQuerySchema>;
export const reportRowSchema = z.object({
  id: z.uuid(),
  requestNumber: z.string(),
  warehouse: warehouseCodeSchema,
  warehouseName: z.string(),
  claimantId: z.uuid(),
  claimantName: z.string(),
  origin: requestOriginSchema,
  type: requestTypeSchema.nullable(),
  purposeObject: z.string().nullable(),
  finalDestination: z.string().nullable(),
  notes: z.string().nullable(),
  submittedAt: z.iso.datetime(),
  fulfilledAt: z.iso.datetime().nullable(),
  status: requestStatusSchema,
  syncStatus: syncStatusSchema,
  matchedItemCount: z.number().int().nonnegative(),
  matchedQuantity: z.number().int().nonnegative(),
  returnedQuantity: z.number().int().nonnegative(),
  pendingReturnQuantity: z.number().int().nonnegative(),
  reviewerName: z.string().nullable(),
  reviewedAt: z.iso.datetime().nullable(),
  reviewDecision: z.string().nullable(),
  executorName: z.string().nullable(),
  returnMode: z.string(),
  expectedReturnDate: z.string().nullable(),
});
export type ReportRow = z.infer<typeof reportRowSchema>;
export const reportResponseSchema = z.object({
  items: z.array(reportRowSchema),
  nextCursor: z.string().nullable(),
});
export type ReportResponse = z.infer<typeof reportResponseSchema>;
export const reportCandidatesQuerySchema = z.object({
  warehouse: warehouseCodeSchema.optional(),
  query: z.string().trim().max(100).default(''),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const reportCandidatesResponseSchema = z.object({
  items: z.array(z.object({ id: z.uuid(), name: z.string(), status: userStatusSchema })),
  nextCursor: z.string().nullable(),
});
export const reportMovementSchema = z.object({
  id: z.uuid(),
  businessNumber: z.string(),
  type: inventoryMovementTypeSchema,
  productName: z.string(),
  size: z.string().nullable(),
  quantityDelta: z.number().int(),
  effectiveBefore: z.number().int(),
  effectiveAfter: z.number().int(),
  actorName: z.string().nullable(),
  syncStatus: syncStatusSchema,
  occurredAt: z.iso.datetime(),
});
export const reportMovementsResponseSchema = z.object({
  items: z.array(reportMovementSchema),
  nextCursor: z.string().nullable(),
});
export type ReportMovementsResponse = z.infer<typeof reportMovementsResponseSchema>;
export const staffQuerySchema = z.object({
  query: z.string().trim().max(100).default(''),
  status: userStatusSchema.optional(),
  role: roleCodeSchema.optional(),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const staffRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  status: userStatusSchema,
  access: accessProfileSchema,
});
export type StaffRow = z.infer<typeof staffRowSchema>;
export const staffResponseSchema = z.object({
  items: z.array(staffRowSchema),
  nextCursor: z.string().nullable(),
});
export type StaffResponse = z.infer<typeof staffResponseSchema>;
