import { z } from 'zod';
import { warehouseCodeSchema } from './enums.js';

export const warehouseEntrySchema = z.object({
  code: warehouseCodeSchema,
  name: z.string().min(1),
  applyPath: z.string().regex(/^\/w\/(XIHU|YUHANG)\/apply$/),
  publicUrl: z.url(),
  qrCodeUrl: z.string().regex(/^\/warehouses\/(XIHU|YUHANG)\/qr\.svg$/),
});
export type WarehouseEntry = z.infer<typeof warehouseEntrySchema>;

export const warehouseEntriesResponseSchema = z.object({
  items: z.array(warehouseEntrySchema),
  productionReady: z.boolean(),
});
export type WarehouseEntriesResponse = z.infer<typeof warehouseEntriesResponseSchema>;
