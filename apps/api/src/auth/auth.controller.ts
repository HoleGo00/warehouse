import { Body, Controller, Get, Inject, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { clientLoginChallengeRequestSchema, clientLoginRequestSchema } from '@glorychips/contracts';
import type { ApiEnvironment } from '@glorychips/config';
import { AuthDomainError } from '@glorychips/database';
import { AuthApplicationService } from './auth-application.service.js';
import {
  constantTimeSecretEqual,
  readCookie,
  serializeExpiredOAuthBindingCookie,
  serializeExpiredSessionCookie,
  serializeOAuthBindingCookie,
  serializeSessionCookie,
} from './cookies.js';
import type { ApiRequest, ApiResponse } from './http-types.js';
import { SessionGuard } from './session.guard.js';
import { API_ENVIRONMENT } from './tokens.js';

const oauthCallbackSchema = z.object({
  code: z.string().min(1).max(4096),
  state: z.string().min(32).max(4096),
});

const parseBoundary = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AuthDomainError('VALIDATION_ERROR', 'The request payload is invalid.');
  }
  return result.data;
};

@Controller('auth')
export class AuthController {
  public constructor(
    @Inject(AuthApplicationService) private readonly application: AuthApplicationService,
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
  ) {}

  @Get('feishu/oauth/start')
  public async startOAuth(
    @Query('returnTo') returnTo: unknown,
    @Res() response: ApiResponse,
  ): Promise<void> {
    const started = await this.application.startOAuth(returnTo);
    response.setHeader(
      'Set-Cookie',
      serializeOAuthBindingCookie(
        this.environment.OAUTH_BINDING_COOKIE_NAME,
        started.browserBinding,
        {
          maxAgeSeconds: this.environment.AUTH_STATE_TTL_SECONDS,
          secure: this.environment.SESSION_COOKIE_SECURE,
        },
      ),
    );
    response.redirect(302, started.authorizationUrl);
  }

  @Get('feishu/oauth/callback')
  public async completeOAuth(
    @Query() rawQuery: unknown,
    @Req() request: ApiRequest,
    @Res() response: ApiResponse,
  ): Promise<void> {
    const expiredBindingCookie = serializeExpiredOAuthBindingCookie(
      this.environment.OAUTH_BINDING_COOKIE_NAME,
      this.environment.SESSION_COOKIE_SECURE,
    );
    response.setHeader('Set-Cookie', expiredBindingCookie);
    const queryResult = oauthCallbackSchema.safeParse(rawQuery);
    const cookieHeader = request.headers['cookie'];
    const browserBinding = readCookie(
      typeof cookieHeader === 'string' ? cookieHeader : undefined,
      this.environment.OAUTH_BINDING_COOKIE_NAME,
    );
    if (
      !queryResult.success ||
      browserBinding === undefined ||
      !constantTimeSecretEqual(queryResult.data.state, browserBinding)
    ) {
      throw new AuthDomainError(
        'AUTH_STATE_INVALID',
        'The OAuth state is not bound to this browser.',
      );
    }
    const query = queryResult.data;
    const completed = await this.application.completeLogin('OAUTH_STATE', query.state, query.code);
    response.setHeader('Set-Cookie', [expiredBindingCookie, this.sessionCookie(completed.token)]);
    response.redirect(302, new URL(completed.returnTo, this.environment.WEB_PUBLIC_URL).toString());
  }

  @Post('feishu/client/challenge')
  public async createClientChallenge(@Body() rawBody: unknown) {
    const body = parseBoundary(clientLoginChallengeRequestSchema, rawBody);
    return this.application.createClientChallenge(body.returnTo);
  }

  @Post('feishu/client/login')
  public async completeClientLogin(
    @Body() rawBody: unknown,
    @Res({ passthrough: true }) response: ApiResponse,
  ) {
    const body = parseBoundary(clientLoginRequestSchema, rawBody);
    const completed = await this.application.completeLogin(
      'CLIENT_CHALLENGE',
      body.challenge,
      body.code,
    );
    response.setHeader('Set-Cookie', this.sessionCookie(completed.token));
    return this.application.toClientLoginResponse(completed);
  }

  @Get('me')
  @UseGuards(SessionGuard)
  public me(@Req() request: ApiRequest) {
    if (request.auth === undefined) {
      throw new AuthDomainError('AUTH_REQUIRED', 'A valid session is required.');
    }
    return this.application.toMe(request.auth);
  }

  @Post('logout')
  public async logout(
    @Req() request: ApiRequest,
    @Res({ passthrough: true }) response: ApiResponse,
  ): Promise<{ readonly success: true }> {
    const cookieHeader = request.headers['cookie'];
    const token = readCookie(
      typeof cookieHeader === 'string' ? cookieHeader : undefined,
      this.environment.SESSION_COOKIE_NAME,
    );
    if (token !== undefined) await this.application.logout(token);
    response.setHeader(
      'Set-Cookie',
      serializeExpiredSessionCookie(
        this.environment.SESSION_COOKIE_NAME,
        this.environment.SESSION_COOKIE_SECURE,
      ),
    );
    return { success: true };
  }

  private sessionCookie(token: string): string {
    return serializeSessionCookie(this.environment.SESSION_COOKIE_NAME, token, {
      maxAgeSeconds: this.environment.SESSION_TTL_SECONDS,
      secure: this.environment.SESSION_COOKIE_SECURE,
    });
  }
}
