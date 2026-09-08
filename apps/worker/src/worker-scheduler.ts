export interface WorkerTask {
  name: 'outbox' | 'reconciliation' | 'return_reminders';
  run: () => Promise<void>;
  intervalMs?: number;
}

export class WorkerScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private running: Promise<void> | undefined;
  private readonly nextRuns = new Map<WorkerTask['name'], number>();

  public constructor(
    private readonly tasks: readonly WorkerTask[],
    private readonly now: () => number = Date.now,
  ) {}

  public runOnce(): Promise<void> {
    if (this.running) return this.running;
    const run = this.execute();
    this.running = run;
    void run
      .finally(() => {
        this.running = undefined;
      })
      .catch(() => undefined);
    return run;
  }

  private async execute(): Promise<void> {
    let failed = false;
    for (const task of this.tasks) {
      if (this.stopped) break;
      if (this.now() < (this.nextRuns.get(task.name) ?? 0)) continue;
      try {
        await task.run();
        this.nextRuns.set(task.name, this.now() + (task.intervalMs ?? 0));
      } catch {
        failed = true;
        // Raw provider and database errors can contain credentials or personal data.
        console.error(JSON.stringify({ service: 'worker', event: 'task_failed', task: task.name }));
      }
    }
    if (failed) throw new Error('WORKER_TASK_FAILED');
  }

  public async start(intervalMs: number): Promise<void> {
    if (this.timer || this.running) throw new Error('WORKER_ALREADY_RUNNING');
    this.stopped = false;
    const cycle = async (): Promise<void> => {
      try {
        await this.runOnce();
      } catch {
        // Each task logs its safe operation name; later cycles still run.
      }
      if (!this.stopped)
        this.timer = setTimeout(() => {
          void cycle();
        }, intervalMs);
    };
    await cycle();
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.running?.catch(() => undefined);
  }

  public async onModuleDestroy(): Promise<void> {
    await this.stop();
  }
}
