import { describe, expect, it, vi } from 'vitest';
import type { ReturnReminderService } from '@glorychips/database';
import { ReturnReminderRunner } from './return-reminder.runner.js';

describe('ReturnReminderRunner', () => {
  it('runs the return scan once', async () => {
    const scanDueReturns = vi.fn().mockResolvedValue({ created: 2, upgraded: 1 });
    const runner = new ReturnReminderRunner({ scanDueReturns } as unknown as ReturnReminderService);
    await runner.runOnce();
    expect(scanDueReturns).toHaveBeenCalledTimes(1);
  });

  it('does not overlap scheduled scans', async () => {
    vi.useFakeTimers();
    let resolveScan: (() => void) | undefined;
    const scanDueReturns = vi.fn(
      () =>
        new Promise<{ created: number; upgraded: number }>((resolve) => {
          resolveScan = () => resolve({ created: 0, upgraded: 0 });
        }),
    );
    const runner = new ReturnReminderRunner({ scanDueReturns } as unknown as ReturnReminderService);
    runner.start(250);
    await vi.advanceTimersByTimeAsync(500);
    expect(scanDueReturns).toHaveBeenCalledTimes(1);
    resolveScan?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(249);
    expect(scanDueReturns).toHaveBeenCalledTimes(1);
    runner.stop();
    vi.useRealTimers();
  });

  it('continues scheduling after a failed scan', async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const scanDueReturns = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary database failure'))
      .mockResolvedValue({ created: 0, upgraded: 0 });
    const runner = new ReturnReminderRunner({ scanDueReturns } as unknown as ReturnReminderService);
    runner.start(250);
    await vi.advanceTimersByTimeAsync(250);
    expect(scanDueReturns).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(scanDueReturns).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('return_reminder_scan_failed'));
    runner.stop();
    errorSpy.mockRestore();
    vi.useRealTimers();
  });
});
