import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { ApiEnvironment } from '@glorychips/config';
import { AuthDomainError } from '@glorychips/database';
import type { AuthServicePort } from '@glorychips/database';
import { readCookie } from './cookies.js';
import type { ApiRequest } from './http-types.js';
import { API_ENVIRONMENT, AUTH_SERVICE } from './tokens.js';

@Injectable()
export class SessionGuard implements CanActivate {
  public constructor(
    @Inject(AUTH_SERVICE) private readonly auth: AuthServicePort,
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ApiRequest>();
    const cookieHeader = request.headers['cookie'];
    const token = readCookie(
      typeof cookieHeader === 'string' ? cookieHeader : undefined,
      this.environment.SESSION_COOKIE_NAME,
    );
    if (token === undefined) {
      throw new AuthDomainError('AUTH_REQUIRED', 'A valid session is required.');
    }
    request.auth = await this.auth.loadSession(token);
    return true;
  }
}
