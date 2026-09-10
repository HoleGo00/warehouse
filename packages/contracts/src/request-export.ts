import { z } from 'zod';
export const exportErrorCodes = [
  'EXPORT_NOT_FOUND',
  'EXPORT_NOT_READY',
  'EXPORT_EXPIRED',
  'EXPORT_LIMIT',
  'EXPORT_TOO_LARGE',
  'EXPORT_TIMEOUT',
  'EXPORT_STORAGE',
  'EXPORT_FAILED',
  'EXPORT_LEASE_LOST',
  'EXPORT_INVALID_TEXT',
] as const;
export const exportErrorCodeSchema = z.enum(exportErrorCodes);
export type ExportErrorCode = z.infer<typeof exportErrorCodeSchema>;
export const exportJobSchema = z.object({
  id: z.uuid(),
  status: z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'EXPIRED']),
  createdAt: z.iso.datetime(),
  snapshotAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  summaryCount: z.number().int().nonnegative(),
  detailCount: z.number().int().nonnegative(),
  fileSize: z.number().int().nonnegative().nullable(),
  errorCode: z.string().nullable(),
});
export type ExportJob = z.infer<typeof exportJobSchema>;
export const exportJobResponseSchema = z.object({ job: exportJobSchema });
export const exportJobListSchema = z.object({
  items: z.array(exportJobSchema),
  nextCursor: z.string().nullable(),
});
export type ExportJobList = z.infer<typeof exportJobListSchema>;
export const exportListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(512).optional(),
});
export const exportListCursorSchema = z
  .object({ id: z.uuid(), createdAt: z.iso.datetime() })
  .strict();
