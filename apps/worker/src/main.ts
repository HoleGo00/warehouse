import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { parseWorkerEnvironment } from '@glorychips/config';
import { createDatabaseClient } from '@glorychips/database';
import { AppModule } from './app.module.js';

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
  await NestFactory.createApplicationContext(AppModule);
  const environment = parseWorkerEnvironment(process.env);
  await checkDatabase();
  if (!environment.WORKER_RUN_ONCE) {
    setInterval(() => {
      void checkDatabase().catch((error: unknown) => console.error(error));
    }, environment.WORKER_POLL_INTERVAL_MS).unref();
  }
};

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
