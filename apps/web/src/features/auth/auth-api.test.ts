import { describe, expect, it } from 'vitest';
import { AuthApiError, createAuthApi } from './auth-api.js';

describe('web auth API', () => {
  it('builds OAuth URLs with a normalized internal return path', () => {
    const api = createAuthApi({
      baseUrl: 'http://localhost:3000',
      fetchFunction: async () => new Response(),
    });
    expect(api.oauthStartUrl('/w/YUHANG/apply?source=qr')).toBe(
      'http://localhost:3000/auth/feishu/oauth/start?returnTo=%2Fw%2FYUHANG%2Fapply%3Fsource%3Dqr',
    );
    expect(api.oauthStartUrl('https://evil.example/path')).toBe(
      'http://localhost:3000/auth/feishu/oauth/start?returnTo=%2F',
    );
  });

  it('decodes the shared session response and sends cookies', async () => {
    let credentials: RequestCredentials | undefined;
    const api = createAuthApi({
      baseUrl: 'http://localhost:3000',
      fetchFunction: async (_input, init) => {
        credentials = init?.credentials;
        return new Response(
          JSON.stringify({
            authenticated: true,
            user: {
              id: '11111111-1111-4111-8111-111111111111',
              feishuUserId: 'employee',
              name: 'Employee',
              avatarUrl: null,
            },
            access: { roles: ['CLAIMANT'], warehouses: [] },
            expiresAt: '2026-09-01T00:00:00.000Z',
          }),
          { status: 200 },
        );
      },
    });

    await expect(api.getMe()).resolves.toMatchObject({ authenticated: true });
    expect(credentials).toBe('include');
  });

  it('surfaces stable API error codes without accepting unknown payloads', async () => {
    const api = createAuthApi({
      baseUrl: 'http://localhost:3000',
      fetchFunction: async () =>
        new Response(
          JSON.stringify({
            code: 'AUTH_REQUIRED',
            message: 'A valid session is required.',
            traceId: '22222222-2222-4222-8222-222222222222',
          }),
          { status: 401 },
        ),
    });

    await expect(api.getMe()).rejects.toBeInstanceOf(AuthApiError);
    await expect(api.getMe()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });
});
