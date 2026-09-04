import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { parseApiEnvironment } from '@glorychips/config';
import { AuthService, createDatabaseClient } from '@glorychips/database';
import { AccessController } from './access/access.controller.js';
import { SystemAdminGuard } from './access/system-admin.guard.js';
import { ApiExceptionFilter } from './auth/api-exception.filter.js';
import { AuthApplicationService } from './auth/auth-application.service.js';
import { AuthController } from './auth/auth.controller.js';
import { HttpFeishuIdentityProvider } from './auth/feishu-identity.provider.js';
import { SessionGuard } from './auth/session.guard.js';
import {
  API_ENVIRONMENT,
  AUTH_SERVICE,
  DATABASE_CLIENT,
  FEISHU_IDENTITY_PROVIDER,
} from './auth/tokens.js';
import { DatabaseLifecycle } from './database/database-lifecycle.js';
import { HealthController } from './health/health.controller.js';

@Module({
  controllers: [HealthController, AuthController, AccessController],
  providers: [
    { provide: API_ENVIRONMENT, useFactory: () => parseApiEnvironment(process.env) },
    {
      provide: DATABASE_CLIENT,
      useFactory: () => createDatabaseClient(process.env),
    },
    {
      provide: AUTH_SERVICE,
      useFactory: (database: ReturnType<typeof createDatabaseClient>) => new AuthService(database),
      inject: [DATABASE_CLIENT],
    },
    {
      provide: FEISHU_IDENTITY_PROVIDER,
      useFactory: (environment: ReturnType<typeof parseApiEnvironment>) =>
        new HttpFeishuIdentityProvider({
          appId: environment.FEISHU_APP_ID,
          appSecret: environment.FEISHU_APP_SECRET,
          redirectUri: environment.FEISHU_REDIRECT_URI,
        }),
      inject: [API_ENVIRONMENT],
    },
    AuthApplicationService,
    SessionGuard,
    SystemAdminGuard,
    DatabaseLifecycle,
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
