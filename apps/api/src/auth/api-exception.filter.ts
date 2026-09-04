import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { authErrorResponseSchema } from '@glorychips/contracts';
import type { AuthErrorCode } from '@glorychips/contracts';
import { AuthDomainError } from '@glorychips/database';
import type { ApiResponse } from './http-types.js';

const statusByCode: Readonly<Partial<Record<AuthErrorCode, number>>> = {
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
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  public catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ApiResponse>();
    const traceId = randomUUID();
    if (exception instanceof AuthDomainError) {
      console.info(JSON.stringify({ event: 'auth_failure', code: exception.code, traceId }));
      response.status(statusByCode[exception.code] ?? 400).json(
        authErrorResponseSchema.parse({
          code: exception.code,
          message: exception.message,
          traceId,
        }),
      );
      return;
    }
    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json({
        code: 'VALIDATION_ERROR',
        message: 'The request could not be processed.',
        traceId,
      });
      return;
    }
    console.error(JSON.stringify({ event: 'api_failure', traceId }));
    response.status(500).json({
      code: 'AUTH_UPSTREAM_UNAVAILABLE',
      message: 'The request could not be processed.',
      traceId,
    });
  }
}
