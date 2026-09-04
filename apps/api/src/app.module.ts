import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { parseApiEnvironment } from '@glorychips/config';
import {
  AuthService,
  AdminTaskService,
  CatalogService,
  createDatabaseClient,
  InventoryQueryService,
  InventoryOperationsService,
  NormalRequestService,
  RequestQueryService,
  RequestReviewService,
  ReturnReminderService,
  ReturnService,
  TemporaryOfflineRequestService,
  WarehouseDirectoryService,
  WorkCalendarAdminService,
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
  INVENTORY_OPERATIONS_SERVICE,
  NORMAL_REQUEST_SERVICE,
  ADMIN_TASK_SERVICE,
  REQUEST_QUERY_SERVICE,
  REQUEST_REVIEW_SERVICE,
  RETURN_REMINDER_SERVICE,
  RETURN_SERVICE,
  TEMPORARY_OFFLINE_REQUEST_SERVICE,
  PRODUCT_IMAGE_CONTENT_PROVIDER,
  WAREHOUSE_DIRECTORY_SERVICE,
  WORK_CALENDAR_ADMIN_SERVICE,
} from './auth/tokens.js';
import { CatalogController } from './catalog/catalog.controller.js';
import { UnavailableProductImageContentProvider } from './catalog/product-image.provider.js';
import { DatabaseLifecycle } from './database/database-lifecycle.js';
import { HealthController } from './health/health.controller.js';
import { InventoryController } from './inventory/inventory.controller.js';
import { AdminInventoryOperationsController } from './inventory/admin-inventory-operations.controller.js';
import { AdminReturnsController } from './inventory/admin-returns.controller.js';
import { AdminTasksController } from './inventory/admin-tasks.controller.js';
import { AdminWorkCalendarController } from './inventory/admin-work-calendar.controller.js';
import { AdminRequestsController } from './requests/admin-requests.controller.js';
import { AdminClaimantsController } from './requests/admin-claimants.controller.js';
import { RequestsController } from './requests/requests.controller.js';
import { WarehousesController } from './warehouses/warehouses.controller.js';

@Module({
  controllers: [
    HealthController,
    AuthController,
    AccessController,
    CatalogController,
    InventoryController,
    AdminInventoryOperationsController,
    AdminReturnsController,
    AdminTasksController,
    AdminWorkCalendarController,
    RequestsController,
    AdminRequestsController,
    AdminClaimantsController,
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
      provide: INVENTORY_OPERATIONS_SERVICE,
      useFactory: (database: ReturnType<typeof createDatabaseClient>) =>
        new InventoryOperationsService(database),
      inject: [DATABASE_CLIENT],
    },
    {
      provide: RETURN_SERVICE,
      useFactory: (database: ReturnType<typeof createDatabaseClient>) =>
        new ReturnService(database),
      inject: [DATABASE_CLIENT],
    },
    {
      provide: RETURN_REMINDER_SERVICE,
      useFactory: (database: ReturnType<typeof createDatabaseClient>) =>
        new ReturnReminderService(database),
      inject: [DATABASE_CLIENT],
    },
    {
      provide: ADMIN_TASK_SERVICE,
      useFactory: (database: ReturnType<typeof createDatabaseClient>) =>
        new AdminTaskService(database),
      inject: [DATABASE_CLIENT],
    },
    {
      provide: WORK_CALENDAR_ADMIN_SERVICE,
      useFactory: (database: ReturnType<typeof createDatabaseClient>) =>
        new WorkCalendarAdminService(database),
      inject: [DATABASE_CLIENT],
    },
    {
      provide: NORMAL_REQUEST_SERVICE,
      useFactory: (database: ReturnType<typeof createDatabaseClient>) =>
        new NormalRequestService(database),
      inject: [DATABASE_CLIENT],
    },
    {
      provide: REQUEST_QUERY_SERVICE,
      useFactory: (database: ReturnType<typeof createDatabaseClient>) =>
        new RequestQueryService(database),
      inject: [DATABASE_CLIENT],
    },
    {
      provide: TEMPORARY_OFFLINE_REQUEST_SERVICE,
      useFactory: (database: ReturnType<typeof createDatabaseClient>) =>
        new TemporaryOfflineRequestService(database),
      inject: [DATABASE_CLIENT],
    },
    {
      provide: REQUEST_REVIEW_SERVICE,
      useFactory: (
        database: ReturnType<typeof createDatabaseClient>,
        normalRequests: NormalRequestService,
        temporaryRequests: TemporaryOfflineRequestService,
      ) => new RequestReviewService(database, normalRequests, temporaryRequests),
      inject: [DATABASE_CLIENT, NORMAL_REQUEST_SERVICE, TEMPORARY_OFFLINE_REQUEST_SERVICE],
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
