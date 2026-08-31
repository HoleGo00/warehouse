import { describe, expect, it } from 'vitest';
import { parseApiEnvironment } from '@glorychips/config';
import { AuthDomainError } from '@glorychips/database';
import type { AccessProfile, AuthLoginKind, AuthMeResponse } from '@glorychips/contracts';
import type {
  AuthServicePort,
  ConsumedLoginState,
  CreatedLoginState,
  CreatedSession,
  FeishuIdentity,
  SessionPrincipal,
} from '@glorychips/database';
import { AccessController } from '../access/access.controller.js';
import { assertWarehouseAccess } from '../access/authorization.js';
import { AuthApplicationService } from './auth-application.service.js';
import {
  constantTimeSecretEqual,
  readCookie,
  serializeExpiredOAuthBindingCookie,
  serializeExpiredSessionCookie,
  serializeOAuthBindingCookie,
  serializeSessionCookie,
} from './cookies.js';
import {
  HttpFeishuIdentityProvider,
  type FeishuIdentityProvider,
} from './feishu-identity.provider.js';

const me: AuthMeResponse = {
  authenticated: true,
  user: {
    id: '11111111-1111-4111-8111-111111111111',
    feishuUserId: 'employee',
    name: 'Employee',
    avatarUrl: null,
  },
  access: { roles: ['CLAIMANT'], warehouses: [] },
  expiresAt: '2026-09-01T00:00:00.000Z',
};

class FakeAuthService implements AuthServicePort {
  public createdReturnTo = '';
  public consumedKind: AuthLoginKind | undefined;

  public async createLoginState(
    _kind: AuthLoginKind,
    returnTo: string,
  ): Promise<CreatedLoginState> {
    this.createdReturnTo = returnTo;
    return { value: 'x'.repeat(43), expiresAt: new Date('2026-09-01T00:00:00.000Z') };
  }

  public async consumeLoginState(kind: AuthLoginKind): Promise<ConsumedLoginState> {
    this.consumedKind = kind;
    return { returnTo: '/w/XIHU/apply' };
  }

  public async authenticate(): Promise<CreatedSession> {
    return { token: 'session-token', me };
  }

  public async loadSession(): Promise<SessionPrincipal> {
    throw new Error('Not used by this test.');
  }

  public async logout(): Promise<void> {}

  public async updateAccess(): Promise<AccessProfile> {
    throw new Error('Not used by this test.');
  }
}

const fakeIdentity: FeishuIdentity = {
  tenantKey: 'tenant',
  userId: 'employee',
  openId: 'open-employee',
  name: 'Employee',
  isInAppScope: true,
  isActive: true,
};

const environment = parseApiEnvironment({
  DATABASE_URL: 'postgresql://warehouse:warehouse@localhost:5432/warehouse',
  WEB_PUBLIC_URL: 'http://localhost:5173',
  FEISHU_APP_ID: 'cli_0123456789abcdef',
  FEISHU_APP_SECRET: 'not-a-real-secret',
  FEISHU_ALLOWED_TENANT_KEY: 'tenant',
  FEISHU_REDIRECT_URI: 'http://localhost:3000/auth/feishu/oauth/callback',
  INITIAL_ADMIN_FEISHU_USER_ID: 'initial-admin',
});

describe('auth application boundary', () => {
  it('creates secure cookie headers without exposing token data elsewhere', () => {
    const cookie = serializeSessionCookie('session', 'opaque-token', {
      maxAgeSeconds: 3_600,
      secure: true,
    });
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=3600');
    expect(readCookie(cookie, 'session')).toBe('opaque-token');
    expect(readCookie('session=%', 'session')).toBeUndefined();

    const bindingCookie = serializeOAuthBindingCookie('oauth_binding', 'browser-state', {
      maxAgeSeconds: 600,
      secure: true,
    });
    expect(bindingCookie).toContain('Path=/auth/feishu/oauth/callback');
    expect(bindingCookie).toContain('HttpOnly');
    expect(bindingCookie).toContain('SameSite=Lax');
    expect(bindingCookie).toContain('Secure');
    expect(bindingCookie).toContain('Max-Age=600');
    expect(serializeExpiredSessionCookie('session', true)).toContain('Path=/; HttpOnly');
    expect(serializeExpiredOAuthBindingCookie('oauth_binding', true)).toContain(
      'Path=/auth/feishu/oauth/callback; HttpOnly',
    );
    expect(serializeExpiredOAuthBindingCookie('oauth_binding', true)).toContain('Max-Age=0');
    expect(serializeExpiredOAuthBindingCookie('oauth_binding', true)).toContain('Secure');
    expect(constantTimeSecretEqual('browser-state', 'browser-state')).toBe(true);
    expect(constantTimeSecretEqual('browser-state', 'different-state')).toBe(false);
  });

  it('uses one completion flow and downgrades unsafe return paths', async () => {
    const auth = new FakeAuthService();
    const provider: FeishuIdentityProvider = {
      createAuthorizationUrl: (state) => `https://accounts.feishu.cn/login?state=${state}`,
      resolveAuthorizationCode: async () => fakeIdentity,
    };
    const application = new AuthApplicationService(auth, provider, environment);

    const start = await application.startOAuth('//evil.example/path');
    expect(auth.createdReturnTo).toBe('/');
    expect(start.authorizationUrl).toContain('state=');
    expect(start.browserBinding).toBe('x'.repeat(43));
    const completed = await application.completeLogin(
      'CLIENT_CHALLENGE',
      'challenge',
      'authorization-code',
    );
    expect(auth.consumedKind).toBe('CLIENT_CHALLENGE');
    expect(completed).toMatchObject({ returnTo: '/w/XIHU/apply', session: me });
  });

  it('enforces the warehouse role and exact scope on server principals', () => {
    const principal: SessionPrincipal = {
      sessionId: 'session',
      userId: me.user.id,
      feishuUserId: me.user.feishuUserId,
      name: me.user.name,
      avatarUrl: null,
      roles: ['CLAIMANT', 'WAREHOUSE_ADMIN'],
      warehouses: ['XIHU'],
      expiresAt: new Date(me.expiresAt),
    };
    expect(() => assertWarehouseAccess(principal, 'XIHU')).not.toThrow();
    expect(() => assertWarehouseAccess(principal, 'YUHANG')).toThrowError(AuthDomainError);

    const controller = new AccessController(new FakeAuthService());
    const request = { headers: {}, auth: principal };
    expect(controller.probeWarehouseFromUrl('XIHU', request)).toEqual({
      allowed: true,
      warehouse: 'XIHU',
    });
    expect(() => controller.probeWarehouseFromBody({ warehouse: 'YUHANG' }, request)).toThrowError(
      AuthDomainError,
    );
  });
});

describe('HttpFeishuIdentityProvider', () => {
  it('decodes Feishu responses through the injectable HTTP boundary', async () => {
    const requests: string[] = [];
    const responses = [
      new Response(JSON.stringify({ access_token: 'user-access-token' }), { status: 200 }),
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            tenant_key: 'tenant',
            open_id: 'open-employee',
            union_id: 'union-employee',
            name: 'Employee',
            avatar_url: 'https://example.com/avatar.png',
          },
        }),
        { status: 200 },
      ),
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            user: {
              user_id: 'employee',
              department_ids: ['department-1'],
              status: {
                is_activated: true,
                is_frozen: false,
                is_resigned: false,
                is_unjoin: false,
              },
            },
          },
        }),
        { status: 200 },
      ),
    ];
    const provider = new HttpFeishuIdentityProvider(
      {
        appId: 'cli_0123456789abcdef',
        appSecret: 'not-a-real-secret',
        redirectUri: environment.FEISHU_REDIRECT_URI,
      },
      async (input) => {
        requests.push(input.toString());
        const response = responses.shift();
        if (response === undefined) throw new Error('Unexpected request.');
        return response;
      },
    );

    await expect(
      provider.resolveAuthorizationCode('OAUTH_STATE', 'one-time-code'),
    ).resolves.toEqual({
      tenantKey: 'tenant',
      userId: 'employee',
      openId: 'open-employee',
      unionId: 'union-employee',
      name: 'Employee',
      avatarUrl: 'https://example.com/avatar.png',
      departments: ['department-1'],
      isInAppScope: true,
      isActive: true,
    });
    expect(requests[2]).toBe(
      'https://open.feishu.cn/open-apis/contact/v3/users/open-employee?user_id_type=open_id&department_id_type=open_department_id',
    );
  });

  it('maps malformed upstream data to a stable error without returning payloads', async () => {
    const provider = new HttpFeishuIdentityProvider(
      {
        appId: 'cli_0123456789abcdef',
        appSecret: 'not-a-real-secret',
        redirectUri: environment.FEISHU_REDIRECT_URI,
      },
      async () => new Response(JSON.stringify({ unexpected: true }), { status: 200 }),
    );
    await expect(
      provider.resolveAuthorizationCode('OAUTH_STATE', 'one-time-code'),
    ).rejects.toMatchObject({
      code: 'AUTH_UPSTREAM_UNAVAILABLE',
      message: 'Feishu identity verification failed.',
    });
  });

  it('maps Feishu app availability rejection without exposing the upstream response', async () => {
    const provider = new HttpFeishuIdentityProvider(
      {
        appId: 'cli_0123456789abcdef',
        appSecret: 'not-a-real-secret',
        redirectUri: environment.FEISHU_REDIRECT_URI,
      },
      async () =>
        new Response(
          JSON.stringify({
            code: 20_010,
            error: 'invalid_request',
            error_description: 'user has no app permission',
          }),
          { status: 400 },
        ),
    );

    await expect(
      provider.resolveAuthorizationCode('OAUTH_STATE', 'one-time-code'),
    ).rejects.toMatchObject({
      code: 'FEISHU_APP_SCOPE_FORBIDDEN',
      message: 'The user is outside the application scope.',
    });
  });

  it('does not misclassify a contact API failure as an app-scope rejection', async () => {
    const responses = [
      new Response(JSON.stringify({ access_token: 'user-access-token' }), { status: 200 }),
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            tenant_key: 'tenant',
            open_id: 'open-employee',
            name: 'Employee',
          },
        }),
        { status: 200 },
      ),
      new Response(JSON.stringify({ code: 999_999 }), { status: 503 }),
    ];
    const provider = new HttpFeishuIdentityProvider(
      {
        appId: 'cli_0123456789abcdef',
        appSecret: 'not-a-real-secret',
        redirectUri: environment.FEISHU_REDIRECT_URI,
      },
      async () => {
        const response = responses.shift();
        if (response === undefined) throw new Error('Unexpected request.');
        return response;
      },
    );

    await expect(
      provider.resolveAuthorizationCode('OAUTH_STATE', 'one-time-code'),
    ).rejects.toMatchObject({
      code: 'AUTH_UPSTREAM_UNAVAILABLE',
    });
  });

  it('fails closed when contact permissions omit employee identity and status', async () => {
    const responses = [
      new Response(JSON.stringify({ access_token: 'user-access-token' }), { status: 200 }),
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            tenant_key: 'tenant',
            open_id: 'open-employee',
            union_id: 'union-employee',
            name: 'Employee',
          },
        }),
        { status: 200 },
      ),
      new Response(
        JSON.stringify({
          code: 0,
          data: { user: { open_id: 'open-employee', union_id: 'union-employee' } },
        }),
        { status: 200 },
      ),
    ];
    const provider = new HttpFeishuIdentityProvider(
      {
        appId: 'cli_0123456789abcdef',
        appSecret: 'not-a-real-secret',
        redirectUri: environment.FEISHU_REDIRECT_URI,
      },
      async () => {
        const response = responses.shift();
        if (response === undefined) throw new Error('Unexpected request.');
        return response;
      },
    );

    await expect(
      provider.resolveAuthorizationCode('OAUTH_STATE', 'one-time-code'),
    ).rejects.toMatchObject({ code: 'AUTH_UPSTREAM_UNAVAILABLE' });
  });

  it('exchanges Feishu client requestAccess codes through the v1 token flow', async () => {
    const requests: Array<{ readonly url: string; readonly authorization?: string }> = [];
    const responses = [
      new Response(JSON.stringify({ code: 0, app_access_token: 'app-access-token' }), {
        status: 200,
      }),
      new Response(JSON.stringify({ code: 0, data: { access_token: 'user-access-token' } }), {
        status: 200,
      }),
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            tenant_key: 'tenant',
            open_id: 'open-employee',
            name: 'Employee',
          },
        }),
        { status: 200 },
      ),
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            user: {
              user_id: 'employee',
              status: {
                is_activated: true,
                is_frozen: false,
                is_resigned: false,
                is_unjoin: false,
              },
            },
          },
        }),
        { status: 200 },
      ),
    ];
    const provider = new HttpFeishuIdentityProvider(
      {
        appId: 'cli_0123456789abcdef',
        appSecret: 'not-a-real-secret',
        redirectUri: environment.FEISHU_REDIRECT_URI,
      },
      async (input, init) => {
        requests.push({
          url: input.toString(),
          authorization: new Headers(init?.headers).get('authorization') ?? undefined,
        });
        const response = responses.shift();
        if (response === undefined) throw new Error('Unexpected request.');
        return response;
      },
    );

    await expect(
      provider.resolveAuthorizationCode('CLIENT_CHALLENGE', 'client-one-time-code'),
    ).resolves.toMatchObject({ userId: 'employee', isActive: true });
    expect(requests.slice(0, 2)).toEqual([
      {
        url: 'https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal',
        authorization: undefined,
      },
      {
        url: 'https://open.feishu.cn/open-apis/authen/v1/access_token',
        authorization: 'Bearer app-access-token',
      },
    ]);
  });
});
