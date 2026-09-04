import { z } from 'zod';
import {
  adminTaskStatusSchema,
  adminTaskTypeSchema,
  inventoryInboundTypeSchema,
  inventoryOperationTypeSchema,
  returnStatusSchema,
  taskSeveritySchema,
  warehouseCodeSchema,
} from './enums.js';
import { availabilitySchema } from './inventory.js';

export const dateOnlySchema = z
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

const businessReasonSchema = z.string().trim().min(1).max(1000);
const optionalNotesSchema = z.string().trim().max(1000).optional();
const occurredAtSchema = z.iso.datetime();
const quantitySchema = z.number().int().positive().max(1_000_000);
const uniqueLines = <T extends { variantId: string }>(
  value: { lines: T[] },
  context: z.RefinementCtx,
): void => {
  if (new Set(value.lines.map((line) => line.variantId)).size !== value.lines.length) {
    context.addIssue({ code: 'custom', path: ['lines'], message: 'Each variant may appear once.' });
  }
};

export const inventoryOperationQuantityLineSchema = z.object({
  variantId: z.uuid(),
  quantity: quantitySchema,
});

export const createInboundSchema = z
  .object({
    warehouse: warehouseCodeSchema,
    inboundType: inventoryInboundTypeSchema,
    occurredAt: occurredAtSchema,
    reason: businessReasonSchema,
    notes: optionalNotesSchema,
    lines: z.array(inventoryOperationQuantityLineSchema).min(1).max(100),
  })
  .superRefine(uniqueLines);
export type CreateInbound = z.infer<typeof createInboundSchema>;

export const createTransferSchema = z
  .object({
    sourceWarehouse: warehouseCodeSchema,
    destinationWarehouse: warehouseCodeSchema,
    occurredAt: occurredAtSchema,
    reason: businessReasonSchema,
    notes: optionalNotesSchema,
    lines: z.array(inventoryOperationQuantityLineSchema).min(1).max(100),
  })
  .superRefine((value, context) => {
    uniqueLines(value, context);
    if (value.sourceWarehouse === value.destinationWarehouse) {
      context.addIssue({
        code: 'custom',
        path: ['destinationWarehouse'],
        message: 'Transfer warehouses must be different.',
      });
    }
  });
export type CreateTransfer = z.infer<typeof createTransferSchema>;

export const createStocktakeSchema = z
  .object({
    warehouse: warehouseCodeSchema,
    occurredAt: occurredAtSchema,
    reason: businessReasonSchema,
    notes: optionalNotesSchema,
    lines: z
      .array(z.object({ variantId: z.uuid(), countedQuantity: z.number().int().nonnegative() }))
      .min(1)
      .max(100),
  })
  .superRefine(uniqueLines);
export type CreateStocktake = z.infer<typeof createStocktakeSchema>;

export const inventoryOperationLineSchema = z.object({
  id: z.uuid(),
  variantId: z.uuid(),
  productName: z.string().min(1),
  variantName: z.string().min(1),
  quantity: z.number().int().nullable(),
  systemQuantity: z.number().int().nullable(),
  countedQuantity: z.number().int().nonnegative().nullable(),
  difference: z.number().int().nullable(),
  adjustedQuantity: z.number().int(),
});

export const inventoryOperationSchema = z.object({
  id: z.uuid(),
  operationNumber: z.string().min(1),
  type: inventoryOperationTypeSchema,
  inboundType: inventoryInboundTypeSchema.nullable(),
  warehouse: warehouseCodeSchema.nullable(),
  sourceWarehouse: warehouseCodeSchema.nullable(),
  destinationWarehouse: warehouseCodeSchema.nullable(),
  actorUserId: z.uuid(),
  occurredAt: z.iso.datetime(),
  reason: z.string().min(1),
  notes: z.string().nullable(),
  lines: z.array(inventoryOperationLineSchema).min(1),
  movementIds: z.array(z.uuid()),
  outboxJobId: z.uuid().nullable(),
  availability: z.array(availabilitySchema),
});
export const inventoryOperationResponseSchema = z.object({ operation: inventoryOperationSchema });
export type InventoryOperationResponse = z.infer<typeof inventoryOperationResponseSchema>;

export const confirmReturnSchema = z.object({
  requestId: z.uuid(),
  warehouse: warehouseCodeSchema,
  occurredAt: occurredAtSchema,
  lines: z
    .array(z.object({ obligationId: z.uuid(), quantity: quantitySchema }))
    .min(1)
    .max(100)
    .superRefine((lines, context) => {
      if (new Set(lines.map((line) => line.obligationId)).size !== lines.length) {
        context.addIssue({ code: 'custom', message: 'Each obligation may appear once.' });
      }
    }),
});
export type ConfirmReturn = z.infer<typeof confirmReturnSchema>;

export const returnQueueStatuses = ['PENDING', 'PARTIAL', 'DUE', 'OVERDUE'] as const;
export const returnQueueStatusSchema = z.enum(returnQueueStatuses);
export const returnQueueQuerySchema = z.object({
  warehouse: warehouseCodeSchema.optional(),
  status: returnQueueStatusSchema.optional(),
});
export type ReturnQueueQuery = z.infer<typeof returnQueueQuerySchema>;

export const returnQueueItemSchema = z.object({
  requestId: z.uuid(),
  requestNumber: z.string().min(1),
  claimantId: z.uuid(),
  claimantName: z.string().min(1),
  sourceWarehouse: warehouseCodeSchema,
  sourceWarehouseName: z.string().min(1),
  dueDate: dateOnlySchema.nullable(),
  status: returnStatusSchema,
  requiredQuantity: z.number().int().positive(),
  returnedQuantity: z.number().int().nonnegative(),
  remainingQuantity: z.number().int().positive(),
  allowedWarehouses: z.array(warehouseCodeSchema),
});
export type ReturnQueueItem = z.infer<typeof returnQueueItemSchema>;
export const returnQueueResponseSchema = z.object({ items: z.array(returnQueueItemSchema) });
export type ReturnQueueResponse = z.infer<typeof returnQueueResponseSchema>;

export const departureTriggerSchema = z.object({
  claimantId: z.uuid(),
  reason: businessReasonSchema,
});
export type DepartureTrigger = z.infer<typeof departureTriggerSchema>;
export const departureTriggerResponseSchema = z.object({ created: z.number().int().nonnegative() });

export const adminTaskQuerySchema = z.object({
  warehouse: warehouseCodeSchema.optional(),
  type: adminTaskTypeSchema.optional(),
  status: adminTaskStatusSchema.optional(),
  severity: taskSeveritySchema.optional(),
});
export type AdminTaskQuery = z.infer<typeof adminTaskQuerySchema>;
export const adminTaskItemSchema = z.object({
  id: z.uuid(),
  type: adminTaskTypeSchema,
  severity: taskSeveritySchema,
  status: adminTaskStatusSchema,
  warehouse: warehouseCodeSchema.nullable(),
  warehouseName: z.string().nullable(),
  requestId: z.uuid().nullable(),
  requestNumber: z.string().nullable(),
  claimantName: z.string().nullable(),
  title: z.string().min(1),
  dueAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  allowedAction: z.enum(['COMPLETE_PAPERWORK', 'CONFIRM_RETURN', 'VIEW']).nullable(),
});
export type AdminTaskItem = z.infer<typeof adminTaskItemSchema>;
export const adminTaskListResponseSchema = z.object({ items: z.array(adminTaskItemSchema) });
export type AdminTaskListResponse = z.infer<typeof adminTaskListResponseSchema>;

export const workCalendarQuerySchema = z.object({ from: dateOnlySchema, to: dateOnlySchema });
export const upsertWorkCalendarDaySchema = z.object({
  isWorkingDay: z.boolean(),
  description: z.string().trim().max(200).optional(),
});
export const workCalendarDaySchema = z.object({
  date: dateOnlySchema,
  isWorkingDay: z.boolean(),
  description: z.string().nullable(),
});
export type WorkCalendarDay = z.infer<typeof workCalendarDaySchema>;
export const workCalendarListResponseSchema = z.object({ items: z.array(workCalendarDaySchema) });
export type WorkCalendarListResponse = z.infer<typeof workCalendarListResponseSchema>;
export const workCalendarDeleteResponseSchema = z.object({ deleted: z.boolean() });
