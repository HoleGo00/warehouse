import { z } from 'zod';
import { feishuAppIdSchema } from '@glorychips/contracts';

const nodeEnvironmentSchema = z.enum(['development', 'test', 'production']).default('development');

const isLoopbackHostname = (hostname: string): boolean =>
  hostname === 'localhost' ||
  hostname === '0.0.0.0' ||
  hostname === '[::1]' ||
  /^127(?:\.\d{1,3}){3}$/.test(hostname);

export const databaseEnvironmentSchema = z.object({
  DATABASE_URL: z.url().startsWith('postgresql://'),
});

export const apiEnvironmentSchema = databaseEnvironmentSchema
  .extend({
    NODE_ENV: nodeEnvironmentSchema,
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    WEB_PUBLIC_URL: z.url(),
    FEISHU_APP_ID: feishuAppIdSchema,
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
    const publicUrl = new URL(value.WEB_PUBLIC_URL);
    if (value.SESSION_COOKIE_NAME === value.OAUTH_BINDING_COOKIE_NAME) {
      context.addIssue({
        code: 'custom',
        message: 'OAuth binding and session cookies must use different names.',
        path: ['OAUTH_BINDING_COOKIE_NAME'],
      });
    }
    if (
      !['http:', 'https:'].includes(publicUrl.protocol) ||
      publicUrl.username !== '' ||
      publicUrl.password !== '' ||
      publicUrl.pathname !== '/' ||
      publicUrl.search !== '' ||
      publicUrl.hash !== ''
    ) {
      context.addIssue({
        code: 'custom',
        message: 'WEB_PUBLIC_URL must be a clean HTTP(S) origin without credentials or parameters.',
        path: ['WEB_PUBLIC_URL'],
      });
    }
    if (
      value.NODE_ENV === 'production' &&
      (publicUrl.protocol !== 'https:' || isLoopbackHostname(publicUrl.hostname))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'WEB_PUBLIC_URL must use a non-loopback HTTPS origin in production.',
        path: ['WEB_PUBLIC_URL'],
      });
    }
  })
  .transform((value) => ({
    ...value,
    WEB_PUBLIC_URL: new URL(value.WEB_PUBLIC_URL).origin,
    SESSION_COOKIE_SECURE: value.NODE_ENV === 'production',
  }));

const environmentBoolean = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');
const baseTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9]+$/)
  .min(10)
  .max(128);

export const workerEnvironmentSchema = databaseEnvironmentSchema
  .extend({
    NODE_ENV: nodeEnvironmentSchema,
    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(3_600_000).default(5000),
    WORKER_RUN_ONCE: environmentBoolean,
    FEISHU_SYNC_ENABLED: environmentBoolean,
    FEISHU_SYNC_ENVIRONMENT: z.enum(['TEST', 'FORMAL']).default('FORMAL'),
    FEISHU_RING_BASE_TOKEN: baseTokenSchema.optional(),
    FEISHU_WATCH_BASE_TOKEN: baseTokenSchema.optional(),
    LARK_CLI_EXECUTABLE: z
      .string()
      .min(1)
      .max(1024)
      .regex(/^[^\r\n\0]+$/)
      .default('lark-cli'),
    LARK_CLI_PROFILE: z.literal('glorychips-warehouse').default('glorychips-warehouse'),
    LARK_CLI_IDENTITY: z.enum(['user', 'bot']).default('user'),
    LARK_CLI_EXPECTED_VERSION: z.literal('1.0.91').default('1.0.91'),
    LARK_CLI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
    LARK_CLI_MAX_OUTPUT_BYTES: z.coerce.number().int().min(1024).max(33_554_432).default(8_388_608),
    OUTBOX_LEASE_MS: z.coerce.number().int().min(5000).max(3_600_000).default(180_000),
    OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(30).default(8),
    OUTBOX_RETRY_BASE_MS: z.coerce.number().int().min(250).max(60_000).default(1000),
    OUTBOX_RETRY_MAX_MS: z.coerce.number().int().min(1000).max(3_600_000).default(300_000),
    WORKER_RECONCILE_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(5000)
      .max(86_400_000)
      .default(300_000),
  })
  .superRefine((value, context) => {
    if (!value.FEISHU_SYNC_ENABLED) return;
    for (const field of ['FEISHU_RING_BASE_TOKEN', 'FEISHU_WATCH_BASE_TOKEN'] as const) {
      if (!value[field]) {
        context.addIssue({ code: 'custom', message: 'Sync target is required.', path: [field] });
      }
    }
    if (value.FEISHU_RING_BASE_TOKEN === value.FEISHU_WATCH_BASE_TOKEN) {
      context.addIssue({
        code: 'custom',
        message: 'Sync targets must use distinct Bases.',
        path: ['FEISHU_WATCH_BASE_TOKEN'],
      });
    }
    if (value.OUTBOX_LEASE_MS < value.LARK_CLI_TIMEOUT_MS * 2) {
      context.addIssue({
        code: 'custom',
        message: 'The lease must cover at least two CLI timeout windows.',
        path: ['OUTBOX_LEASE_MS'],
      });
    }
    if (value.OUTBOX_RETRY_MAX_MS < value.OUTBOX_RETRY_BASE_MS) {
      context.addIssue({
        code: 'custom',
        message: 'Maximum retry delay must cover the base delay.',
        path: ['OUTBOX_RETRY_MAX_MS'],
      });
    }
    if (value.NODE_ENV === 'production' && value.FEISHU_SYNC_ENVIRONMENT !== 'FORMAL') {
      context.addIssue({
        code: 'custom',
        message: 'Production sync requires formal bindings.',
        path: ['FEISHU_SYNC_ENVIRONMENT'],
      });
    }
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
