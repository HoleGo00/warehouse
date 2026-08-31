import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { parseApiEnvironment } from '@glorychips/config';
import type { AccessProfile, AuthLoginKind, UpdateAccessRequest } from '@glorychips/contracts';
import { AuthDomainError } from '@glorychips/database';
import type {
  AuthServicePort,
  ConsumedLoginState,
  CreatedLoginState,
  CreatedSession,
  FeishuIdentity,
  SessionPrincipal,
} from '@glorychips/database';
import { AccessController } from '../access/access.controller.js';
import { SystemAdminGuard } from '../access/system-admin.guard.js';
import { ApiExceptionFilter } from './api-exception.filter.js';
import { AuthApplicationService } from './auth-application.service.js';
import { AuthController } from './auth.controller.js';
import type { FeishuIdentityProvider } from './feishu-identity.provider.js';
import { SessionGuard } from './session.guard.js';
import { API_ENVIRONMENT, AUTH_SERVICE, FEISHU_IDENTITY_PROVIDER } from './tokens.js';

const environment = parseApiEnvironment({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://warehouse:warehouse@localhost:5432/warehouse',
  WEB_PUBLIC_URL: 'http://localhost:5173',
  FEISHU_APP_ID: 'cli_example',
  FEISHU_APP_SECRET: 'not-a-real-secret',
  FEISHU_ALLOWED_TENANT_KEY: 'tenant',
  FEISHU_REDIRECT_URI: 'http://localhost:3000/auth/feishu/oauth/callback',
  INITIAL_ADMIN_FEISHU_USER_ID: 'initial-admin',
});

const userId = '11111111-1111-4111-8111-111111111111';
const targetUserId = '22222222-2222-4222-8222-222222222222';
const expiresAt = new Date('2026-09-01T00:00:00.000Z');

const principal = (
  roles: SessionPrincipal['roles'],
  warehouses: SessionPrincipal['warehouses'],
): SessionPrincipal => ({
  sessionId: 'session-id',
  userId,
  feishuUserId: 'employee',
  name: 'Employee',
  avatarUrl: null,
  roles,
  warehouses,
  expiresAt,
});

class HttpFakeAuthService implements AuthServicePort {
  public consumeCalls = 0;
  public updateCalls = 0;
  private stateCounter = 0;
  private readonly states = new Map<
    string,
    { readonly kind: AuthLoginKind; readonly returnTo: string }
  >();
  private readonly principals = new Map<string, SessionPrincipal>([
    ['claimant-token', principal(['CLAIMANT'], [])],
    ['warehouse-token', principal(['CLAIMANT', 'WAREHOUSE_ADMIN'], ['XIHU'])],
    ['system-token', principal(['CLAIMANT', 'SYSTEM_ADMIN'], ['XIHU', 'YUHANG'])],
  ]);

  public reset(): void {
    this.consumeCalls = 0;
    this.updateCalls = 0;
    this.stateCounter = 0;
    this.states.clear();
  }

  public async createLoginState(kind: AuthLoginKind, returnTo: string): Promise<CreatedLoginState> {
    this.stateCounter += 1;
    const value = `oauth-state-${this.stateCounter}-${'x'.repeat(32)}`;
    this.states.set(value, { kind, returnTo });
    return { value, expiresAt };
  }

  public async consumeLoginState(kind: AuthLoginKind, value: string): Promise<ConsumedLoginState> {
    this.consumeCalls += 1;
    const state = this.states.get(value);
    if (state === undefined || state.kind !== kind) {
      throw new AuthDomainError('AUTH_STATE_INVALID', 'The login state is invalid.');
    }
    this.states.delete(value);
    return { returnTo: state.returnTo };
  }

  public async authenticate(): Promise<CreatedSession> {
    return {
      token: 'new-session-token',
      me: {
        authenticated: true,
        user: {
          id: userId,
          feishuUserId: 'employee',
          name: 'Employee',
          avatarUrl: null,
        },
        access: { roles: ['CLAIMANT'], warehouses: [] },
        expiresAt: expiresAt.toISOString(),
      },
    };
  }

  public async loadSession(token: string): Promise<SessionPrincipal> {
    const session = this.principals.get(token);
    if (session === undefined) {
      throw new AuthDomainError('AUTH_REQUIRED', 'A valid session is required.');
    }
    return session;
  }

  public async logout(): Promise<void> {}

  public async updateAccess(
    _actorUserId: string,
    _targetUserId: string,
    access: UpdateAccessRequest,
  ): Promise<AccessProfile> {
    this.updateCalls += 1;
    return access;
  }
}

class HttpFakeFeishuProvider implements FeishuIdentityProvider {
  public resolveCalls = 0;

  public reset(): void {
    this.resolveCalls = 0;
  }

  public createAuthorizationUrl(state: string): string {
    const url = new URL('https://accounts.feishu.cn/test-authorize');
    url.searchParams.set('state', state);
    return url.toString();
  }

  public async resolveAuthorizationCode(): Promise<FeishuIdentity> {
    this.resolveCalls += 1;
    return {
      tenantKey: 'tenant',
      userId: 'employee',
      openId: 'open-employee',
      name: 'Employee',
      isInAppScope: true,
      isActive: true,
    };
  }
}

const cookieValues = (response: request.Response): readonly string[] => {
  const value = response.headers['set-cookie'];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
};

const cookiePair = (response: request.Response, name: string): string => {
  const cookie = cookieValues(response).find((value) => value.startsWith(`${name}=`));
  if (cookie === undefined) throw new Error(`Cookie ${name} was not set.`);
  return cookie.split(';', 1)[0] ?? '';
};

describe('auth and access HTTP pipeline', () => {
  let application: INestApplication;
  let auth: HttpFakeAuthService;
  let feishu: HttpFakeFeishuProvider;

  beforeAll(async () => {
    auth = new HttpFakeAuthService();
    feishu = new HttpFakeFeishuProvider();
    const module = await Test.createTestingModule({
      controllers: [AuthController, AccessController],
      providers: [
        { provide: API_ENVIRONMENT, useValue: environment },
        { provide: AUTH_SERVICE, useValue: auth },
        { provide: FEISHU_IDENTITY_PROVIDER, useValue: feishu },
        AuthApplicationService,
        SessionGuard,
        SystemAdminGuard,
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
      ],
    }).compile();
    application = module.createNestApplication();
    await application.init();
  });

  beforeEach(() => {
    auth.reset();
    feishu.reset();
  });

  afterAll(async () => {
    await application.close();
  });

  it('starts OAuth with a short-lived browser binding cookie and redirect', async () => {
    const response = await request(application.getHttpServer())
      .get('/auth/feishu/oauth/start')
      .query({ returnTo: '/w/XIHU/apply?source=qr' })
      .expect(302);

    expect(response.headers.location).toContain('https://accounts.feishu.cn/test-authorize');
    const bindingCookie = cookieValues(response).find((value) =>
      value.startsWith(`${environment.OAUTH_BINDING_COOKIE_NAME}=`),
    );
    expect(bindingCookie).toContain('HttpOnly');
    expect(bindingCookie).toContain('SameSite=Lax');
    expect(bindingCookie).toContain('Path=/auth/feishu/oauth/callback');
    expect(bindingCookie).toContain(`Max-Age=${environment.AUTH_STATE_TTL_SECONDS}`);
    expect(bindingCookie).not.toContain(environment.SESSION_COOKIE_NAME);
  });

  it('rejects missing or mismatched binding cookies before consuming state', async () => {
    const start = await request(application.getHttpServer())
      .get('/auth/feishu/oauth/start')
      .expect(302);
    const startLocation = start.headers.location;
    if (typeof startLocation !== 'string') throw new Error('OAuth redirect was not returned.');
    const state = new URL(startLocation).searchParams.get('state');
    if (state === null) throw new Error('OAuth state was not returned.');

    const missing = await request(application.getHttpServer())
      .get('/auth/feishu/oauth/callback')
      .query({ state, code: 'code-one' })
      .expect(400);
    expect(missing.body).toMatchObject({ code: 'AUTH_STATE_INVALID' });
    expect(cookieValues(missing)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`${environment.OAUTH_BINDING_COOKIE_NAME}=;`),
      ]),
    );

    await request(application.getHttpServer())
      .get('/auth/feishu/oauth/callback')
      .set('Cookie', `${environment.OAUTH_BINDING_COOKIE_NAME}=wrong-binding`)
      .query({ state, code: 'code-two' })
      .expect(400);

    expect(auth.consumeCalls).toBe(0);
    expect(feishu.resolveCalls).toBe(0);
  });

  it('rejects malformed callbacks before consuming state or calling Feishu', async () => {
    const response = await request(application.getHttpServer())
      .get('/auth/feishu/oauth/callback')
      .set('Cookie', `${environment.OAUTH_BINDING_COOKIE_NAME}=${'x'.repeat(43)}`)
      .query({ state: 'short', code: 'one-time-code' })
      .expect(400);

    expect(response.body).toMatchObject({ code: 'AUTH_STATE_INVALID' });
    expect(cookieValues(response)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`${environment.OAUTH_BINDING_COOKIE_NAME}=;`),
      ]),
    );
    expect(auth.consumeCalls).toBe(0);
    expect(feishu.resolveCalls).toBe(0);
  });

  it('accepts the matching binding, clears it, creates a session, and redirects safely', async () => {
    const start = await request(application.getHttpServer())
      .get('/auth/feishu/oauth/start')
      .query({ returnTo: '/w/XIHU/apply?source=qr' })
      .expect(302);
    const startLocation = start.headers.location;
    if (typeof startLocation !== 'string') throw new Error('OAuth redirect was not returned.');
    const state = new URL(startLocation).searchParams.get('state');
    if (state === null) throw new Error('OAuth state was not returned.');

    const callback = await request(application.getHttpServer())
      .get('/auth/feishu/oauth/callback')
      .set('Cookie', cookiePair(start, environment.OAUTH_BINDING_COOKIE_NAME))
      .query({ state, code: 'one-time-code' })
      .expect(302);

    expect(callback.headers.location).toBe('http://localhost:5173/w/XIHU/apply?source=qr');
    expect(cookieValues(callback)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`${environment.OAUTH_BINDING_COOKIE_NAME}=;`),
        expect.stringContaining(`${environment.SESSION_COOKIE_NAME}=new-session-token`),
      ]),
    );
    expect(auth.consumeCalls).toBe(1);
    expect(feishu.resolveCalls).toBe(1);

    const replay = await request(application.getHttpServer())
      .get('/auth/feishu/oauth/callback')
      .set('Cookie', cookiePair(start, environment.OAUTH_BINDING_COOKIE_NAME))
      .query({ state, code: 'replayed-code' })
      .expect(400);
    expect(replay.body).toMatchObject({ code: 'AUTH_STATE_INVALID' });
    expect(cookieValues(replay)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`${environment.OAUTH_BINDING_COOKIE_NAME}=;`),
      ]),
    );
    expect(auth.consumeCalls).toBe(2);
    expect(feishu.resolveCalls).toBe(1);
  });

  it('keeps client challenge login independent from the OAuth binding cookie', async () => {
    const challengeResponse = await request(application.getHttpServer())
      .post('/auth/feishu/client/challenge')
      .send({ returnTo: '/w/YUHANG/apply?source=client' })
      .expect(201);

    const challenge = challengeResponse.body.challenge;
    expect(typeof challenge).toBe('string');
    const login = await request(application.getHttpServer())
      .post('/auth/feishu/client/login')
      .send({ challenge, code: 'client-code' })
      .expect(201);

    expect(login.body).toMatchObject({
      returnTo: '/w/YUHANG/apply?source=client',
      session: { authenticated: true },
    });
    const sessionCookie = cookieValues(login).find((value) =>
      value.startsWith(`${environment.SESSION_COOKIE_NAME}=`),
    );
    expect(sessionCookie).toContain('Path=/');
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('SameSite=Lax');
    expect(sessionCookie).toContain(`Max-Age=${environment.SESSION_TTL_SECONDS}`);
    expect(cookieValues(login).some((value) => value.includes('oauth_binding'))).toBe(false);
    expect(auth.consumeCalls).toBe(1);
    expect(feishu.resolveCalls).toBe(1);
  });

  it('returns 401 for /auth/me without a session cookie', async () => {
    const response = await request(application.getHttpServer()).get('/auth/me').expect(401);
    expect(response.body).toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('enforces warehouse and system administrator guards through HTTP', async () => {
    await request(application.getHttpServer())
      .get('/access/warehouses/XIHU/probe')
      .set('Cookie', `${environment.SESSION_COOKIE_NAME}=claimant-token`)
      .expect(403);

    await request(application.getHttpServer())
      .get('/access/warehouses/YUHANG/probe')
      .set('Cookie', `${environment.SESSION_COOKIE_NAME}=warehouse-token`)
      .expect(403);

    const allowedWarehouse = await request(application.getHttpServer())
      .get('/access/warehouses/XIHU/probe')
      .set('Cookie', `${environment.SESSION_COOKIE_NAME}=warehouse-token`)
      .expect(200);
    expect(allowedWarehouse.body).toEqual({ allowed: true, warehouse: 'XIHU' });

    await request(application.getHttpServer())
      .put(`/access/users/${targetUserId}`)
      .set('Cookie', `${environment.SESSION_COOKIE_NAME}=warehouse-token`)
      .send({ roles: ['CLAIMANT'], warehouses: [] })
      .expect(403);

    const updated = await request(application.getHttpServer())
      .put(`/access/users/${targetUserId}`)
      .set('Cookie', `${environment.SESSION_COOKIE_NAME}=system-token`)
      .send({ roles: ['CLAIMANT', 'WAREHOUSE_ADMIN'], warehouses: ['YUHANG'] })
      .expect(200);
    expect(updated.body).toEqual({
      userId: targetUserId,
      access: { roles: ['CLAIMANT', 'WAREHOUSE_ADMIN'], warehouses: ['YUHANG'] },
    });
    expect(auth.updateCalls).toBe(1);
  });
});
