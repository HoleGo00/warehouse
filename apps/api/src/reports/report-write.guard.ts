import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { ApiEnvironment } from '@glorychips/config';
import { AuthDomainError } from '@glorychips/database';
import type { ApiRequest } from '../auth/http-types.js';
import { API_ENVIRONMENT } from '../auth/tokens.js';
@Injectable()
export class ReportWriteGuard implements CanActivate {
  public constructor(@Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment) {}
  public canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<ApiRequest>();
    const origin = request.headers['origin'];
    const contentType = request.headers['content-type'];
    if (
      (origin !== undefined && origin !== this.environment.WEB_PUBLIC_URL) ||
      request.headers['sec-fetch-site'] === 'cross-site' ||
      typeof contentType !== 'string' ||
      contentType.split(';')[0]?.trim() !== 'application/json'
    ) {
      throw new AuthDomainError('VALIDATION_ERROR', '请求来源或内容类型无效。');
    }
    return true;
  }
}
