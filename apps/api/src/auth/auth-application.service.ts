import { Inject, Injectable } from '@nestjs/common';
import {
  authMeResponseSchema,
  clientLoginChallengeResponseSchema,
  clientLoginResponseSchema,
  normalizeAuthReturnPath,
} from '@glorychips/contracts';
import type {
  AuthLoginKind,
  AuthMeResponse,
  ClientLoginChallengeResponse,
  ClientLoginResponse,
} from '@glorychips/contracts';
import type { ApiEnvironment } from '@glorychips/config';
import { createBootstrapConfigDigest } from '@glorychips/database';
import type { AuthServicePort, SessionPrincipal } from '@glorychips/database';
import { API_ENVIRONMENT, AUTH_SERVICE, FEISHU_IDENTITY_PROVIDER } from './tokens.js';
import type { FeishuIdentityProvider } from './feishu-identity.provider.js';

interface OAuthStart {
  readonly authorizationUrl: string;
  readonly browserBinding: string;
}

interface CompletedLogin {
  readonly token: string;
  readonly returnTo: string;
  readonly session: AuthMeResponse;
}

@Injectable()
export class AuthApplicationService {
  public constructor(
    @Inject(AUTH_SERVICE) private readonly auth: AuthServicePort,
    @Inject(FEISHU_IDENTITY_PROVIDER) private readonly feishu: FeishuIdentityProvider,
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
  ) {}

  public async startOAuth(rawReturnTo: unknown): Promise<OAuthStart> {
    const returnTo = normalizeAuthReturnPath(rawReturnTo);
    const state = await this.auth.createLoginState(
      'OAUTH_STATE',
      returnTo,
      this.environment.AUTH_STATE_TTL_SECONDS,
    );
    return {
      authorizationUrl: this.feishu.createAuthorizationUrl(state.value),
      browserBinding: state.value,
    };
  }

  public async createClientChallenge(rawReturnTo: unknown): Promise<ClientLoginChallengeResponse> {
    const state = await this.auth.createLoginState(
      'CLIENT_CHALLENGE',
      normalizeAuthReturnPath(rawReturnTo),
      this.environment.AUTH_STATE_TTL_SECONDS,
    );
    return clientLoginChallengeResponseSchema.parse({
      challenge: state.value,
      expiresAt: state.expiresAt.toISOString(),
    });
  }

  public async completeLogin(
    kind: AuthLoginKind,
    stateValue: string,
    authorizationCode: string,
  ): Promise<CompletedLogin> {
    const state = await this.auth.consumeLoginState(kind, stateValue);
    const identity = await this.feishu.resolveAuthorizationCode(kind, authorizationCode);
    const created = await this.auth.authenticate(
      identity,
      {
        allowedTenantKey: this.environment.FEISHU_ALLOWED_TENANT_KEY,
        initialAdminFeishuUserId: this.environment.INITIAL_ADMIN_FEISHU_USER_ID,
        configVersionDigest: createBootstrapConfigDigest(
          this.environment.FEISHU_ALLOWED_TENANT_KEY,
          this.environment.INITIAL_ADMIN_FEISHU_USER_ID,
        ),
      },
      this.environment.SESSION_TTL_SECONDS,
    );
    return { token: created.token, returnTo: state.returnTo, session: created.me };
  }

  public toMe(principal: SessionPrincipal): AuthMeResponse {
    return authMeResponseSchema.parse({
      authenticated: true,
      user: {
        id: principal.userId,
        feishuUserId: principal.feishuUserId,
        name: principal.name,
        avatarUrl: principal.avatarUrl,
      },
      access: { roles: principal.roles, warehouses: principal.warehouses },
      expiresAt: principal.expiresAt.toISOString(),
    });
  }

  public toClientLoginResponse(completed: CompletedLogin): ClientLoginResponse {
    return clientLoginResponseSchema.parse({
      returnTo: completed.returnTo,
      session: completed.session,
    });
  }

  public async logout(token: string): Promise<void> {
    await this.auth.logout(token);
  }
}
