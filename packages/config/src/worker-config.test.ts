import { describe, expect, it } from 'vitest';
import { parseWorkerEnvironment } from './index.js';

const database = { DATABASE_URL: 'postgresql://warehouse:local@localhost:54329/warehouse' };
const enabled = {
  ...database,
  FEISHU_SYNC_ENABLED: 'true',
  FEISHU_RING_BASE_TOKEN: 'ringexampletoken',
  FEISHU_WATCH_BASE_TOKEN: 'watchexampletoken',
};

describe('Feishu worker configuration', () => {
  it('keeps sync off unless explicitly enabled', () => {
    expect(parseWorkerEnvironment(database)).toMatchObject({
      FEISHU_SYNC_ENABLED: false,
      LARK_CLI_PROFILE: 'glorychips-warehouse',
      LARK_CLI_EXPECTED_VERSION: '1.0.91',
    });
    expect(parseWorkerEnvironment(enabled).FEISHU_SYNC_ENABLED).toBe(true);
  });

  it('rejects missing or ambiguous targets before startup', () => {
    expect(() =>
      parseWorkerEnvironment({ ...enabled, FEISHU_RING_BASE_TOKEN: undefined }),
    ).toThrow();
    expect(() =>
      parseWorkerEnvironment({
        ...enabled,
        FEISHU_WATCH_BASE_TOKEN: enabled.FEISHU_RING_BASE_TOKEN,
      }),
    ).toThrow();
    expect(() =>
      parseWorkerEnvironment({ ...enabled, FEISHU_WATCH_BASE_TOKEN: '--help' }),
    ).toThrow();
  });

  it('does not allow profile changes, silent upgrades or production test bindings', () => {
    for (const override of [
      { LARK_CLI_PROFILE: 'other-profile' },
      { LARK_CLI_EXPECTED_VERSION: 'latest' },
      { LARK_CLI_IDENTITY: 'guess' },
      { LARK_CLI_EXECUTABLE: 'lark-cli\nother' },
      { NODE_ENV: 'production', FEISHU_SYNC_ENVIRONMENT: 'TEST' },
    ]) {
      expect(() => parseWorkerEnvironment({ ...enabled, ...override })).toThrow();
    }
  });

  it('bounds timeouts, lease windows, retry delays and output sizes', () => {
    for (const override of [
      { OUTBOX_LEASE_MS: '5000' },
      { OUTBOX_MAX_ATTEMPTS: '0' },
      { OUTBOX_RETRY_BASE_MS: '2000', OUTBOX_RETRY_MAX_MS: '1000' },
      { LARK_CLI_MAX_OUTPUT_BYTES: '1000000000' },
      { LARK_CLI_TIMEOUT_MS: '0' },
      { WORKER_RECONCILE_INTERVAL_MS: '0' },
      { FEISHU_SYNC_ENABLED: '1' },
    ]) {
      expect(() => parseWorkerEnvironment({ ...enabled, ...override })).toThrow();
    }
  });
});
