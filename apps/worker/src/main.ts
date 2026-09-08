import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { parseWorkerEnvironment } from '@glorychips/config';
import { createDatabaseClient } from '@glorychips/database';
import { AppModule } from './app.module.js';
import { WorkerScheduler } from './worker-scheduler.js';

const checkDatabase = async (): Promise<void> => {
  const database = createDatabaseClient();
  try {
    await database.$queryRaw`SELECT 1`;
    console.info(
      JSON.stringify({ service: 'worker', status: 'ok', checkedAt: new Date().toISOString() }),
    );
  } finally {
    await database.$disconnect();
  }
};

const bootstrap = async (): Promise<void> => {
  const environment = parseWorkerEnvironment(process.env);
  await checkDatabase();
  const application = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  application.enableShutdownHooks();
  const runner = application.get(WorkerScheduler);
  if (environment.WORKER_RUN_ONCE) {
    try {
      await runner.runOnce();
    } finally {
      await application.close();
    }
    return;
  }
  await runner.start(environment.WORKER_POLL_INTERVAL_MS);
};

bootstrap().catch(() => {
  console.error(JSON.stringify({ service: 'worker', event: 'startup_or_run_failed' }));
  process.exitCode = 1;
});
