import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseWorkerEnvironment } from '@glorychips/config';
import type { DatabaseClient, ReturnReminderService } from '@glorychips/database';
import { createWorkerScheduler } from './create-worker-scheduler.js';

const mocks = vi.hoisted(() => ({
  validate: vi.fn(),
  validateBindings: vi.fn(),
  runOnce: vi.fn(),
  enqueue: vi.fn(),
  gatewayOptions: vi.fn(),
  syncOptions: vi.fn(),
}));
vi.mock('./feishu/lark-cli-gateway.js', () => ({
  LarkCliGateway: class {
    constructor(options: unknown) {
      mocks.gatewayOptions(options);
    }
    validate = mocks.validate;
  },
}));
vi.mock('@glorychips/database', () => ({
  FeishuSyncService: class {
    constructor(_database: unknown, _gateway: unknown, options: unknown) {
      mocks.syncOptions(options);
    }
    validateBindings = mocks.validateBindings;
    runOnce = mocks.runOnce;
  },
  enqueueReconciliation: mocks.enqueue,
}));
afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});
const environment = (enabled: boolean) =>
  parseWorkerEnvironment({
    DATABASE_URL: 'postgresql://warehouse:local@localhost:54329/warehouse',
    FEISHU_SYNC_ENABLED: String(enabled),
    FEISHU_SYNC_ENVIRONMENT: 'TEST',
    FEISHU_RING_BASE_TOKEN: 'ringtesttoken',
    FEISHU_WATCH_BASE_TOKEN: 'watchtesttoken',
  });
const db = {
  $transaction: async (action: (tx: object) => Promise<unknown>) => action({}),
} as unknown as DatabaseClient;
describe('worker startup wiring', () => {
  it('keeps external synchronization completely disabled by default', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const scanDueReturns = vi.fn().mockResolvedValue({});
    const scheduler = await createWorkerScheduler(
      db,
      { scanDueReturns } as unknown as ReturnReminderService,
      environment(false),
    );
    await scheduler.runOnce();
    expect(scanDueReturns).toHaveBeenCalledOnce();
    expect(mocks.gatewayOptions).not.toHaveBeenCalled();
    expect(mocks.runOnce).not.toHaveBeenCalled();
    await scheduler.stop();
  });
  it('validates CLI and bindings before scheduling serial enabled runners', async () => {
    const events: string[] = [];
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    mocks.validate.mockImplementation(async () => {
      events.push('cli');
    });
    mocks.validateBindings.mockImplementation(async () => {
      events.push('bindings');
    });
    mocks.runOnce.mockImplementation(async (id?: string) => {
      events.push(id ? 'reconcile' : 'outbox');
      return {};
    });
    mocks.enqueue.mockResolvedValue({ jobId: 'reconcile-id' });
    const scanDueReturns = vi.fn(async () => {
      events.push('reminders');
      return {};
    });
    const scheduler = await createWorkerScheduler(
      db,
      { scanDueReturns } as unknown as ReturnReminderService,
      environment(true),
    );
    expect(events).toEqual(['cli', 'bindings']);
    await scheduler.runOnce();
    expect(events).toEqual(['cli', 'bindings', 'outbox', 'reconcile', 'reminders']);
    expect(mocks.gatewayOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedVersion: '1.0.91',
        profile: 'glorychips-warehouse',
        allowedBases: ['ringtesttoken', 'watchtesttoken'],
      }),
    );
    expect(mocks.syncOptions).toHaveBeenCalledWith(
      expect.objectContaining({ environment: 'TEST', mode: 'TEST' }),
    );
    await scheduler.stop();
  });
  it('refuses startup when CLI identity or binding validation fails', async () => {
    const reminders = { scanDueReturns: vi.fn() } as unknown as ReturnReminderService;
    mocks.validate.mockRejectedValueOnce(new Error('CLI_INVALID'));
    await expect(createWorkerScheduler(db, reminders, environment(true))).rejects.toThrow(
      'CLI_INVALID',
    );
    expect(mocks.validateBindings).not.toHaveBeenCalled();
    mocks.validateBindings.mockRejectedValueOnce(new Error('BINDING_INVALID'));
    await expect(createWorkerScheduler(db, reminders, environment(true))).rejects.toThrow(
      'BINDING_INVALID',
    );
    expect(mocks.runOnce).not.toHaveBeenCalled();
  });
});
