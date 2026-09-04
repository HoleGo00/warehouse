import { z } from 'zod';
import { authErrorCodes } from './auth.js';

export const catalogErrorCodes = [
  'CATALOG_CONFLICT',
  'CATALOG_NOT_FOUND',
  'PRODUCT_IMAGE_REQUIRED',
  'CATALOG_CATEGORY_LOCKED',
  'IMAGE_UNAVAILABLE',
  'PUBLIC_URL_NOT_READY',
] as const;
export const catalogErrorCodeSchema = z.enum(catalogErrorCodes);
export type CatalogErrorCode = z.infer<typeof catalogErrorCodeSchema>;

export const apiErrorCodes = [...authErrorCodes, ...catalogErrorCodes] as const;
export const apiErrorCodeSchema = z.enum(apiErrorCodes);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorResponseSchema = z.object({
  code: apiErrorCodeSchema,
  message: z.string().min(1),
  traceId: z.uuid(),
});
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
