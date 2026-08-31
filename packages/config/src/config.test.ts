import { describe, expect, it } from 'vitest';
import { parseApiEnvironment, parseWorkerEnvironment } from './index.js';

const databaseUrl = 'postgresql://warehouse:warehouse_local@localhost:54329/warehouse';
const apiEnvironment = {
  DATABASE_URL: databaseUrl,
  WEB_PUBLIC_URL: 'http://localhost:5173',
  FEISHU_APP_ID: 'cli_example',
  FEISHU_APP_SECRET: 'not-a-real-secret',
  FEISHU_ALLOWED_TENANT_KEY: 'tenant_example',
  FEISHU_REDIRECT_URI: 'http://localhost:3000/auth/feishu/oauth/callback',
  INITIAL_ADMIN_FEISHU_USER_ID: 'user_example',
};

describe('environment parsing', () => {
  it('coerces API defaults and validates the database scheme', () => {
    expect(parseApiEnvironment(apiEnvironment)).toMatchObject({
      API_PORT: 3000,
      OAUTH_BINDING_COOKIE_NAME: 'glorychips_oauth_binding',
      SESSION_COOKIE_SECURE: false,
      SESSION_TTL_SECONDS: 28_800,
    });
    expect(() =>
      parseApiEnvironment({ ...apiEnvironment, DATABASE_URL: 'https://example.com' }),
    ).toThrow();
  });

  it('requires Feishu credentials and enables secure cookies in production', () => {
    expect(() =>
      parseApiEnvironment({ ...apiEnvironment, FEISHU_APP_SECRET: undefined }),
    ).toThrow();
    expect(
      parseApiEnvironment({ ...apiEnvironment, NODE_ENV: 'production' }).SESSION_COOKIE_SECURE,
    ).toBe(true);
  });

  it('keeps the OAuth browser binding separate from the application session', () => {
    expect(() =>
      parseApiEnvironment({
        ...apiEnvironment,
        SESSION_COOKIE_NAME: 'same_cookie',
        OAUTH_BINDING_COOKIE_NAME: 'same_cookie',
      }),
    ).toThrow();
  });

  it('normalizes worker booleans and intervals', () => {
    expect(
      parseWorkerEnvironment({
        DATABASE_URL: databaseUrl,
        WORKER_POLL_INTERVAL_MS: '750',
        WORKER_RUN_ONCE: 'true',
      }),
    ).toMatchObject({ WORKER_POLL_INTERVAL_MS: 750, WORKER_RUN_ONCE: true });
  });
});
