import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { apiErrorCodeSchema, apiErrorResponseSchema } from '@glorychips/contracts';
import type { ApiErrorCode } from '@glorychips/contracts';
import {
  AuthDomainError,
  CatalogDomainError,
  InventoryDomainError,
  RequestDomainError,
  FeishuSyncError,
} from '@glorychips/database';
import type { ApiResponse } from './http-types.js';

const statusByCode: Readonly<Partial<Record<ApiErrorCode, number>>> = {
  AUTH_REQUIRED: 401,
  AUTH_STATE_INVALID: 400,
  AUTH_IDENTITY_CONFLICT: 409,
  AUTH_UPSTREAM_UNAVAILABLE: 502,
  FEISHU_TENANT_FORBIDDEN: 403,
  FEISHU_APP_SCOPE_FORBIDDEN: 403,
  USER_INACTIVE: 403,
  USER_NOT_FOUND: 404,
  FORBIDDEN_ROLE: 403,
  FORBIDDEN_WAREHOUSE: 403,
  INVALID_ACCESS_PROFILE: 400,
  LAST_SYSTEM_ADMIN: 409,
  VALIDATION_ERROR: 400,
  CATALOG_CONFLICT: 409,
  CATALOG_NOT_FOUND: 404,
  PRODUCT_IMAGE_REQUIRED: 409,
  CATALOG_CATEGORY_LOCKED: 409,
  IMAGE_UNAVAILABLE: 503,
  PUBLIC_URL_NOT_READY: 503,
  REQUEST_NOT_FOUND: 404,
  REQUEST_STATE_CONFLICT: 409,
  REQUEST_FORBIDDEN: 403,
  REQUEST_ITEM_UNAVAILABLE: 409,
  INVENTORY_INSUFFICIENT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  INVALID_INVENTORY_COMMAND: 400,
  RESERVATION_STATE_CONFLICT: 409,
  CLAIMANT_NOT_FOUND: 404,
  INVENTORY_OPERATION_NOT_FOUND: 404,
  INVENTORY_OPERATION_CONFLICT: 409,
  RETURN_OBLIGATION_NOT_FOUND: 404,
  RETURN_QUANTITY_EXCEEDED: 409,
  RETURN_STATE_CONFLICT: 409,
  STOCKTAKE_RESERVATION_CONFLICT: 409,
  ADMIN_TASK_NOT_FOUND: 404,
  WORK_CALENDAR_CONFLICT: 409,
  SYNC_JOB_NOT_FOUND: 404,
  SYNC_STATE_CONFLICT: 409,
  SYNC_BINDING_INVALID: 409,
  SYNC_REMOTE_CONFLICT: 409,
  SYNC_REMOTE_UNCERTAIN: 503,
  SYNC_ORDER_BLOCKED: 409,
  SYNC_LEASE_LOST: 409,
  SYNC_REMOTE_UNAVAILABLE: 503,
  SYNC_LOCAL_INVARIANT: 409,
  MIGRATION_REVISION_CHANGED: 409,
  MIGRATION_FREEZE_REQUIRED: 409,
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  public catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ApiResponse>();
    const traceId = randomUUID();
    if (
      exception instanceof AuthDomainError ||
      exception instanceof CatalogDomainError ||
      exception instanceof InventoryDomainError ||
      exception instanceof RequestDomainError ||
      exception instanceof FeishuSyncError
    ) {
      const code = apiErrorCodeSchema.parse(exception.code);
      console.info(JSON.stringify({ event: 'api_rejection', code, traceId }));
      response.status(statusByCode[code] ?? 400).json(
        apiErrorResponseSchema.parse({
          code,
          message: exception.message,
          traceId,
        }),
      );
      return;
    }
    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(
        apiErrorResponseSchema.parse({
          code: 'VALIDATION_ERROR',
          message: 'The request could not be processed.',
          traceId,
        }),
      );
      return;
    }
    console.error(JSON.stringify({ event: 'api_failure', traceId }));
    response.status(500).json(
      apiErrorResponseSchema.parse({
        code: 'AUTH_UPSTREAM_UNAVAILABLE',
        message: 'The request could not be processed.',
        traceId,
      }),
    );
  }
}
