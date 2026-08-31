import { describe, expect, it } from 'vitest';
import { parseApiEnvironment, parseWorkerEnvironment } from './index.js';

const databaseUrl = 'postgresql://warehouse:warehouse_local@localhost:54329/warehouse';

describe('environment parsing', () => {
  it('coerces API defaults and validates the database scheme', () => {
    expect(parseApiEnvironment({ DATABASE_URL: databaseUrl }).API_PORT).toBe(3000);
    expect(() => parseApiEnvironment({ DATABASE_URL: 'https://example.com' })).toThrow();
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
