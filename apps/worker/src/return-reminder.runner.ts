import { Inject, Injectable } from '@nestjs/common';
import type { ReturnReminderService } from '@glorychips/database';
import { RETURN_REMINDER_SERVICE } from './tokens.js';

@Injectable()
export class ReturnReminderRunner {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  public constructor(
    @Inject(RETURN_REMINDER_SERVICE) private readonly reminders: ReturnReminderService,
  ) {}

  public async runOnce(): Promise<void> {
    const result = await this.reminders.scanDueReturns();
    console.info(
      JSON.stringify({
        service: 'worker',
        event: 'return_reminder_scan_completed',
        ...result,
        checkedAt: new Date().toISOString(),
      }),
    );
  }

  public async runOnceSafely(): Promise<boolean> {
    try {
      await this.runOnce();
      return true;
    } catch (error: unknown) {
      this.logFailure(error);
      return false;
    }
  }

  public start(pollIntervalMs: number): void {
    this.stopped = false;
    const schedule = (): void => {
      if (this.stopped) return;
      this.timer = setTimeout(() => {
        void this.runOnceSafely().finally(schedule);
      }, pollIntervalMs);
    };
    schedule();
  }

  public stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
  }

  private logFailure(error: unknown): void {
    console.error(
      JSON.stringify({
        service: 'worker',
        event: 'return_reminder_scan_failed',
        message: error instanceof Error ? error.message : 'Unknown worker error',
      }),
    );
  }
}
