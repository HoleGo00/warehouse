import { z } from 'zod';

const nodeEnvironmentSchema = z.enum(['development', 'test', 'production']).default('development');

export const databaseEnvironmentSchema = z.object({
  DATABASE_URL: z.url().startsWith('postgresql://'),
});

export const apiEnvironmentSchema = databaseEnvironmentSchema
  .extend({
    NODE_ENV: nodeEnvironmentSchema,
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    WEB_PUBLIC_URL: z.url(),
    FEISHU_APP_ID: z.string().min(1),
    FEISHU_APP_SECRET: z.string().min(1),
    FEISHU_ALLOWED_TENANT_KEY: z.string().min(1),
    FEISHU_REDIRECT_URI: z.url(),
    INITIAL_ADMIN_FEISHU_USER_ID: z.string().min(1),
    SESSION_COOKIE_NAME: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .default('glorychips_session'),
    OAUTH_BINDING_COOKIE_NAME: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .default('glorychips_oauth_binding'),
    SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(2_592_000).default(28_800),
    AUTH_STATE_TTL_SECONDS: z.coerce.number().int().min(60).max(1_800).default(600),
  })
  .superRefine((value, context) => {
    if (value.SESSION_COOKIE_NAME === value.OAUTH_BINDING_COOKIE_NAME) {
      context.addIssue({
        code: 'custom',
        message: 'OAuth binding and session cookies must use different names.',
        path: ['OAUTH_BINDING_COOKIE_NAME'],
      });
    }
  })
  .transform((value) => ({
    ...value,
    SESSION_COOKIE_SECURE: value.NODE_ENV === 'production',
  }));

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
