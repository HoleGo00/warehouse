import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { parseApiEnvironment } from '@glorychips/config';
import {
  AuthService,
  CatalogService,
  createDatabaseClient,
  InventoryQueryService,
  NormalRequestService,
  WarehouseDirectoryService,
} from '@glorychips/database';
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
  CATALOG_SERVICE,
  DATABASE_CLIENT,
  FEISHU_IDENTITY_PROVIDER,
  INVENTORY_QUERY_SERVICE,
  NORMAL_REQUEST_SERVICE,
  PRODUCT_IMAGE_CONTENT_PROVIDER,
  WAREHOUSE_DIRECTORY_SERVICE,
} from './auth/tokens.js';
import { CatalogController } from './catalog/catalog.controller.js';
import { UnavailableProductImageContentProvider } from './catalog/product-image.provider.js';
import { DatabaseLifecycle } from './database/database-lifecycle.js';
import { HealthController } from './health/health.controller.js';
import { InventoryController } from './inventory/inventory.controller.js';
import { AdminRequestsController } from './requests/admin-requests.controller.js';
import { RequestsController } from './requests/requests.controller.js';
import { WarehousesController } from './warehouses/warehouses.controller.js';

@Module({
  controllers: [
    HealthController,
    AuthController,
    AccessController,
    CatalogController,
    InventoryController,
    RequestsController,
    AdminRequestsController,
    WarehousesController,
  ],
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
      provide: CATALOG_SERVICE,
      useFactory: (database: ReturnType<typeof createDatabaseClient>) =>
        new CatalogService(database),
      inject: [DATABASE_CLIENT],
    },
    {
      provide: INVENTORY_QUERY_SERVICE,
      useFactory: (database: ReturnType<typeof createDatabaseClient>) =>
        new InventoryQueryService(database),
      inject: [DATABASE_CLIENT],
    },
    {
      provide: NORMAL_REQUEST_SERVICE,
      useFactory: (database: ReturnType<typeof createDatabaseClient>) =>
        new NormalRequestService(database),
      inject: [DATABASE_CLIENT],
    },
    {
      provide: WAREHOUSE_DIRECTORY_SERVICE,
      useFactory: (database: ReturnType<typeof createDatabaseClient>) =>
        new WarehouseDirectoryService(database),
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
    {
      provide: PRODUCT_IMAGE_CONTENT_PROVIDER,
      useClass: UnavailableProductImageContentProvider,
    },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
