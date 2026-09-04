import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { AuthDomainError } from '@glorychips/database';
import type { ApiRequest } from '../auth/http-types.js';
import { assertRole } from './authorization.js';

@Injectable()
export class SystemAdminGuard implements CanActivate {
  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<ApiRequest>();
    if (request.auth === undefined) {
      throw new AuthDomainError('AUTH_REQUIRED', 'A valid session is required.');
    }
    assertRole(request.auth, 'SYSTEM_ADMIN');
    return true;
  }
}
