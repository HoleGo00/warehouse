import { z } from 'zod';

export const healthResponseSchema = z.object({
  service: z.string().min(1),
  status: z.literal('ok'),
  database: z.enum(['ok', 'not-configured']),
  timestamp: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
