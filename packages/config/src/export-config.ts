import { z } from 'zod';
export const exportEnvironmentSchema = z.object({
  EXPORT_STORAGE_DIR: z.string().min(1).default('.trellis/.runtime/exports'),
  EXPORT_MAX_ROWS: z.coerce.number().int().min(1).max(100_000).default(100_000),
  EXPORT_MAX_BYTES: z.coerce.number().int().min(1024).max(67_108_864).default(67_108_864),
  EXPORT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300_000).default(300_000),
  EXPORT_POLL_MS: z.coerce.number().int().min(250).max(60_000).default(2000),
  EXPORT_RUN_ONCE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
export const parseExportEnvironment = (env: Record<string, string | undefined>) =>
  exportEnvironmentSchema.parse(env);
export type ExportEnvironment = z.infer<typeof exportEnvironmentSchema>;
