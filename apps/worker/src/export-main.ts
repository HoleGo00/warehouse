import { setTimeout as delay } from 'node:timers/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient } from '@glorychips/database';
import { parseExportEnvironment } from '@glorychips/config';
import { ExportRunner } from './exports/export-runner.js';

const localEnvironmentPath = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(localEnvironmentPath)) process.loadEnvFile(localEnvironmentPath);
const options = parseExportEnvironment(process.env);
const database = createDatabaseClient(process.env, { max: 2, connectionTimeoutMillis: 5000 });
const runner = new ExportRunner(database, options);
let stopping = false;
process.on('SIGTERM', () => {
  stopping = true;
});
process.on('SIGINT', () => {
  stopping = true;
});
try {
  await runner.storage.initialize();
  let cleanupAt = 0;
  do {
    if (Date.now() >= cleanupAt) {
      await runner.cleanup();
      cleanupAt = Date.now() + 300_000;
    }
    await runner.runOnce();
    if (!options.EXPORT_RUN_ONCE && !stopping) await delay(options.EXPORT_POLL_MS);
  } while (!options.EXPORT_RUN_ONCE && !stopping);
} catch {
  console.error(
    JSON.stringify({
      event: 'export_worker_unavailable',
      code: 'EXPORT_STORAGE_OR_DATABASE_UNAVAILABLE',
    }),
  );
  process.exitCode = 1;
} finally {
  await database.$disconnect();
}
