import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { parseApiEnvironment } from '@glorychips/config';
import { AppModule } from './app.module.js';

const bootstrap = async (): Promise<void> => {
  const environment = parseApiEnvironment(process.env);
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(environment.API_PORT, '0.0.0.0');
};

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
