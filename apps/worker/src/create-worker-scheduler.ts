import type { WorkerEnvironment } from '@glorychips/config';
import { enqueueReconciliation, FeishuSyncService } from '@glorychips/database';
import type { DatabaseClient, ReturnReminderService } from '@glorychips/database';
import { LarkCliGateway } from './feishu/lark-cli-gateway.js';
import { WorkerScheduler } from './worker-scheduler.js';
import type { WorkerTask } from './worker-scheduler.js';

export async function createWorkerScheduler(
  database: DatabaseClient,
  reminders: ReturnReminderService,
  environment: WorkerEnvironment,
): Promise<WorkerScheduler> {
  const tasks: WorkerTask[] = [];
  if (environment.FEISHU_SYNC_ENABLED) {
    const gateway = new LarkCliGateway({
      executable: environment.LARK_CLI_EXECUTABLE,
      profile: environment.LARK_CLI_PROFILE,
      identity: environment.LARK_CLI_IDENTITY,
      expectedVersion: environment.LARK_CLI_EXPECTED_VERSION,
      timeoutMs: environment.LARK_CLI_TIMEOUT_MS,
      maxOutputBytes: environment.LARK_CLI_MAX_OUTPUT_BYTES,
      allowedBases: [environment.FEISHU_RING_BASE_TOKEN!, environment.FEISHU_WATCH_BASE_TOKEN!],
    });
    const sync = new FeishuSyncService(database, gateway, {
      environment: environment.FEISHU_SYNC_ENVIRONMENT,
      mode: environment.FEISHU_SYNC_ENVIRONMENT === 'TEST' ? 'TEST' : 'ACTIVE',
      leaseMs: environment.OUTBOX_LEASE_MS,
      maxAttempts: environment.OUTBOX_MAX_ATTEMPTS,
      retryBaseMs: environment.OUTBOX_RETRY_BASE_MS,
      retryMaxMs: environment.OUTBOX_RETRY_MAX_MS,
    });
    await gateway.validate();
    await sync.validateBindings();
    tasks.push(
      {
        name: 'outbox',
        run: async () => {
          const result = await sync.runOnce();
          console.info(JSON.stringify({ service: 'worker', event: 'outbox_cycle', ...result }));
        },
      },
      {
        name: 'reconciliation',
        intervalMs: environment.WORKER_RECONCILE_INTERVAL_MS,
        run: async () => {
          const bucket = Math.floor(Date.now() / environment.WORKER_RECONCILE_INTERVAL_MS);
          const { jobId } = await database.$transaction((tx) =>
            enqueueReconciliation(
              tx,
              `reconcile:periodic:${environment.FEISHU_SYNC_ENVIRONMENT}:${bucket}`,
            ),
          );
          const result = await sync.runOnce(jobId);
          console.info(
            JSON.stringify({ service: 'worker', event: 'reconciliation_cycle', ...result }),
          );
        },
      },
    );
  }
  tasks.push({
    name: 'return_reminders',
    run: async () => {
      const result = await reminders.scanDueReturns();
      console.info(
        JSON.stringify({ service: 'worker', event: 'return_reminder_scan_completed', ...result }),
      );
    },
  });
  return new WorkerScheduler(tasks);
}
