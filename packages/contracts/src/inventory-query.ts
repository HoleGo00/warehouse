import { z } from 'zod';
import { productCategoryCodeSchema, productStatusSchema, warehouseCodeSchema } from './enums.js';
import { catalogImageSchema } from './catalog.js';

export const inventoryWarehouseFilters = ['ALL', 'XIHU', 'YUHANG'] as const;
export const inventoryWarehouseFilterSchema = z.enum(inventoryWarehouseFilters);
export type InventoryWarehouseFilter = z.infer<typeof inventoryWarehouseFilterSchema>;

export const inventorySyncIndicators = ['CONFIRMED', 'PENDING_LOCAL_CHANGES'] as const;
export const inventorySyncIndicatorSchema = z.enum(inventorySyncIndicators);
export type InventorySyncIndicator = z.infer<typeof inventorySyncIndicatorSchema>;

export const inventoryQuerySchema = z.object({
  warehouse: inventoryWarehouseFilterSchema.default('ALL'),
  category: productCategoryCodeSchema.optional(),
});
export type InventoryQuery = z.infer<typeof inventoryQuerySchema>;

export const inventoryQuantityProjectionSchema = z.object({
  confirmedFeishuQuantity: z.number().int(),
  pendingMovementDelta: z.number().int(),
  effectiveOnHandQuantity: z.number().int(),
  reservedQuantity: z.number().int().nonnegative(),
  availableQuantity: z.number().int(),
  syncIndicator: inventorySyncIndicatorSchema,
});
export type InventoryQuantityProjection = z.infer<typeof inventoryQuantityProjectionSchema>;

export const inventoryWarehouseQuantitySchema = inventoryQuantityProjectionSchema.extend({
  warehouse: warehouseCodeSchema,
});
export type InventoryWarehouseQuantity = z.infer<typeof inventoryWarehouseQuantitySchema>;

export const inventoryVariantProjectionSchema = z.object({
  id: z.uuid(),
  code: z.string().min(1),
  displayName: z.string().min(1),
  size: z.string().min(1).nullable(),
  isActive: z.boolean(),
  warehouses: z.array(inventoryWarehouseQuantitySchema),
  total: inventoryQuantityProjectionSchema,
});
export type InventoryVariantProjection = z.infer<typeof inventoryVariantProjectionSchema>;

export const inventoryProductProjectionSchema = z.object({
  id: z.uuid(),
  code: z.string().min(1),
  name: z.string().min(1),
  category: productCategoryCodeSchema,
  status: productStatusSchema,
  imageReady: z.boolean(),
  mainImage: catalogImageSchema.nullable(),
  variants: z.array(inventoryVariantProjectionSchema),
});
export type InventoryProductProjection = z.infer<typeof inventoryProductProjectionSchema>;

export const inventoryWarehouseSummarySchema = z.object({
  code: warehouseCodeSchema,
  name: z.string().min(1),
});
export type InventoryWarehouseSummary = z.infer<typeof inventoryWarehouseSummarySchema>;

export const inventoryQueryResponseSchema = z.object({
  warehouse: inventoryWarehouseFilterSchema,
  category: productCategoryCodeSchema.nullable(),
  warehouses: z.array(inventoryWarehouseSummarySchema),
  products: z.array(inventoryProductProjectionSchema),
});
export type InventoryQueryResponse = z.infer<typeof inventoryQueryResponseSchema>;
