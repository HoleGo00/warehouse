import { z } from 'zod';

const nodeEnvironmentSchema = z.enum(['development', 'test', 'production']).default('development');

export const databaseEnvironmentSchema = z.object({
  DATABASE_URL: z.url().startsWith('postgresql://'),
});

export const apiEnvironmentSchema = databaseEnvironmentSchema.extend({
  NODE_ENV: nodeEnvironmentSchema,
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
});

export const workerEnvironmentSchema = databaseEnvironmentSchema.extend({
  NODE_ENV: nodeEnvironmentSchema,
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).default(5000),
  WORKER_RUN_ONCE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type ApiEnvironment = z.infer<typeof apiEnvironmentSchema>;
export type DatabaseEnvironment = z.infer<typeof databaseEnvironmentSchema>;
export type WorkerEnvironment = z.infer<typeof workerEnvironmentSchema>;

export type EnvironmentRecord = Record<string, string | undefined>;

export const parseApiEnvironment = (environment: EnvironmentRecord): ApiEnvironment =>
  apiEnvironmentSchema.parse(environment);

export const parseDatabaseEnvironment = (environment: EnvironmentRecord): DatabaseEnvironment =>
  databaseEnvironmentSchema.parse(environment);

export const parseWorkerEnvironment = (environment: EnvironmentRecord): WorkerEnvironment =>
  workerEnvironmentSchema.parse(environment);
