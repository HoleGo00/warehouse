import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerScheduler } from './worker-scheduler.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('WorkerScheduler', () => {
  it('runs each enabled task serially even after a task fails', async () => {
    const calls: string[] = [];
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const scheduler = new WorkerScheduler([
      {
        name: 'outbox',
        run: async () => {
          calls.push('outbox');
          throw new Error('secret-token');
        },
      },
      {
        name: 'reconciliation',
        run: async () => {
          calls.push('reconciliation');
        },
      },
      {
        name: 'return_reminders',
        run: async () => {
          calls.push('return_reminders');
        },
      },
    ]);
    await expect(scheduler.runOnce()).rejects.toThrow('WORKER_TASK_FAILED');
    expect(calls).toEqual(['outbox', 'reconciliation', 'return_reminders']);
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-token');
  });

  it('coalesces concurrent execution and waits for an active task on shutdown', async () => {
    let finish: () => void = () => undefined;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const next = vi.fn().mockResolvedValue(undefined);
    const scheduler = new WorkerScheduler([
      { name: 'outbox', run },
      { name: 'return_reminders', run: next },
    ]);
    const first = scheduler.runOnce();
    expect(scheduler.runOnce()).toBe(first);
    let stopped = false;
    const stop = scheduler.onModuleDestroy().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish();
    await stop;
    expect(stopped).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });

  it('starts immediately and polls again after a failed startup without overlaps', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const run = vi.fn().mockRejectedValueOnce(new Error('failed')).mockResolvedValue(undefined);
    const scheduler = new WorkerScheduler([{ name: 'outbox', run }]);
    await scheduler.start(250);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(run).toHaveBeenCalledTimes(2);
    await scheduler.stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('throttles periodic reconciliation but retries a failure on the next poll', async () => {
    let now = 0;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const run = vi.fn().mockRejectedValueOnce(new Error('retry')).mockResolvedValue(undefined);
    const scheduler = new WorkerScheduler(
      [{ name: 'reconciliation', run, intervalMs: 5000 }],
      () => now,
    );
    await expect(scheduler.runOnce()).rejects.toThrow();
    await scheduler.runOnce();
    expect(run).toHaveBeenCalledTimes(2);
    now = 4999;
    await scheduler.runOnce();
    expect(run).toHaveBeenCalledTimes(2);
    now = 5000;
    await scheduler.runOnce();
    expect(run).toHaveBeenCalledTimes(3);
  });
});
