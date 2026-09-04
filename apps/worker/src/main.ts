import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { parseWorkerEnvironment } from '@glorychips/config';
import { createDatabaseClient } from '@glorychips/database';
import { AppModule } from './app.module.js';
import { ReturnReminderRunner } from './return-reminder.runner.js';

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
  const application = await NestFactory.createApplicationContext(AppModule);
  application.enableShutdownHooks();
  const runner = application.get(ReturnReminderRunner);
  if (environment.WORKER_RUN_ONCE) {
    try {
      await runner.runOnce();
    } finally {
      await application.close();
    }
    return;
  }
  await runner.runOnceSafely();
  runner.start(environment.WORKER_POLL_INTERVAL_MS);
};

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
