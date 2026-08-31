import { z } from 'zod';
import { inventoryMovementTypeSchema } from './enums.js';

export const inventoryKeySchema = z.object({
  warehouseId: z.uuid(),
  variantId: z.uuid(),
});

export const inventoryQuantitySchema = z.number().int().positive();

export const inventoryLineSchema = inventoryKeySchema.extend({
  quantity: inventoryQuantitySchema,
});

export const movementLineSchema = inventoryKeySchema.extend({
  quantityDelta: z
    .number()
    .int()
    .refine((value) => value !== 0, 'Quantity delta cannot be zero'),
  type: inventoryMovementTypeSchema,
});

export const availabilitySchema = inventoryKeySchema.extend({
  confirmedFeishuQuantity: z.number().int(),
  pendingMovementDelta: z.number().int(),
  effectiveOnHandQuantity: z.number().int(),
  reservedQuantity: z.number().int().nonnegative(),
  availableQuantity: z.number().int(),
});

export type InventoryKey = z.infer<typeof inventoryKeySchema>;
export type InventoryLine = z.infer<typeof inventoryLineSchema>;
export type MovementLine = z.infer<typeof movementLineSchema>;
export type InventoryAvailability = z.infer<typeof availabilitySchema>;

export const calculateAvailability = (input: {
  confirmedFeishuQuantity: number;
  pendingMovementDelta: number;
  reservedQuantity: number;
}): Pick<InventoryAvailability, 'effectiveOnHandQuantity' | 'availableQuantity'> => {
  const effectiveOnHandQuantity = input.confirmedFeishuQuantity + input.pendingMovementDelta;
  return {
    effectiveOnHandQuantity,
    availableQuantity: effectiveOnHandQuantity - input.reservedQuantity,
  };
};
