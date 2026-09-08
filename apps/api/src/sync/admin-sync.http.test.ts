import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { parseApiEnvironment } from '@glorychips/config';
import { FeishuSyncError } from '@glorychips/database';
import type { SessionPrincipal } from '@glorychips/database';
import { SystemAdminGuard } from '../access/system-admin.guard.js';
import { ApiExceptionFilter } from '../auth/api-exception.filter.js';
import { SessionGuard } from '../auth/session.guard.js';
import { API_ENVIRONMENT, AUTH_SERVICE } from '../auth/tokens.js';
import {
  AdminMigrationsController,
  AdminSyncController,
  FEISHU_SYNC_ADMIN_SERVICE,
} from './admin-sync.controller.js';

const environment = parseApiEnvironment({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://warehouse:warehouse@localhost:5432/warehouse',
  WEB_PUBLIC_URL: 'http://localhost:5173',
  FEISHU_APP_ID: 'cli_0123456789abcdef',
  FEISHU_APP_SECRET: 'fake-secret',
  FEISHU_ALLOWED_TENANT_KEY: 'tenant',
  FEISHU_REDIRECT_URI: 'http://localhost:3000/auth/feishu/oauth/callback',
  INITIAL_ADMIN_FEISHU_USER_ID: 'initial-admin',
});
const id = '11111111-1111-4111-8111-111111111111';
const auth = {
  loadSession: async (token: string): Promise<SessionPrincipal> => ({
    sessionId: 'session',
    userId: id,
    feishuUserId: 'employee',
    name: 'Employee',
    avatarUrl: null,
    roles:
      token === 'system'
        ? ['SYSTEM_ADMIN']
        : token === 'warehouse'
          ? ['WAREHOUSE_ADMIN']
          : ['CLAIMANT'],
    warehouses: ['YUHANG'],
    expiresAt: new Date('2030-01-01'),
  }),
};
const service = {
  jobs: vi.fn().mockResolvedValue({ items: [] }),
  job: vi.fn().mockResolvedValue({ job: { id } }),
  retry: vi.fn().mockResolvedValue({ job: { id } }),
  reconciliations: vi.fn().mockResolvedValue({ items: [] }),
  runReconciliation: vi.fn().mockResolvedValue({ jobId: id }),
  bindings: vi.fn().mockResolvedValue({ items: [] }),
  migrations: vi.fn().mockResolvedValue({ items: [] }),
};
const reads = [
  '/admin/sync/jobs',
  `/admin/sync/jobs/${id}`,
  '/admin/sync/reconciliations',
  '/admin/sync/bindings',
  '/admin/migrations',
];
describe('synchronization HTTP pipeline', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AdminSyncController, AdminMigrationsController],
      providers: [
        { provide: API_ENVIRONMENT, useValue: environment },
        { provide: AUTH_SERVICE, useValue: auth },
        { provide: FEISHU_SYNC_ADMIN_SERVICE, useValue: service },
        SessionGuard,
        SystemAdminGuard,
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => app.close());
  it('protects every read from unauthenticated, claimant and warehouse administrator access', async () => {
    for (const path of reads) {
      await request(app.getHttpServer()).get(path).expect(401);
      for (const token of ['claimant', 'warehouse']) {
        await request(app.getHttpServer())
          .get(path)
          .set('Cookie', `glorychips_session=${token}`)
          .expect(403);
      }
      await request(app.getHttpServer())
        .get(path)
        .set('Cookie', 'glorychips_session=system')
        .expect(200);
    }
  });
  it('protects both writes and requires idempotency keys', async () => {
    for (const [path, body] of [
      [`/admin/sync/jobs/${id}/retry`, { reason: 'Retry' }],
      ['/admin/sync/reconciliations/run', {}],
    ] as const) {
      await request(app.getHttpServer()).post(path).send(body).expect(401);
      for (const token of ['claimant', 'warehouse']) {
        await request(app.getHttpServer())
          .post(path)
          .set('Cookie', `glorychips_session=${token}`)
          .set('Idempotency-Key', 'http-sync-key')
          .send(body)
          .expect(403);
      }
      await request(app.getHttpServer())
        .post(path)
        .set('Cookie', 'glorychips_session=system')
        .send(body)
        .expect(400);
      await request(app.getHttpServer())
        .post(path)
        .set('Cookie', 'glorychips_session=system')
        .set('Idempotency-Key', 'http-sync-key')
        .send(body)
        .expect(201);
    }
    expect(service.retry.mock.calls.at(-1)?.slice(0, 3)).toEqual([
      id,
      { reason: 'Retry' },
      'http-sync-key',
    ]);
  });
  it('validates IDs, query bounds, targets and reasons before invoking the service', async () => {
    for (const path of [
      '/admin/sync/jobs/not-id',
      '/admin/sync/jobs?limit=201',
      '/admin/sync/jobs?target=raw',
      '/admin/sync/reconciliations?warehouse=raw',
    ]) {
      await request(app.getHttpServer())
        .get(path)
        .set('Cookie', 'glorychips_session=system')
        .expect(400)
        .expect(({ body }) => expect(body.code).toBe('VALIDATION_ERROR'));
    }
    await request(app.getHttpServer())
      .post(`/admin/sync/jobs/${id}/retry`)
      .set('Cookie', 'glorychips_session=system')
      .set('Idempotency-Key', 'http-invalid-key')
      .send({ reason: ' ' })
      .expect(400);
  });
  it('maps stable domain failures without exposing internal error details', async () => {
    for (const [code, status] of [
      ['SYNC_JOB_NOT_FOUND', 404],
      ['SYNC_STATE_CONFLICT', 409],
      ['SYNC_REMOTE_UNCERTAIN', 503],
    ] as const) {
      service.job.mockRejectedValueOnce(new FeishuSyncError(code));
      await request(app.getHttpServer())
        .get(`/admin/sync/jobs/${id}`)
        .set('Cookie', 'glorychips_session=system')
        .expect(status)
        .expect(({ body }) => expect(body.code).toBe(code));
    }
  });
});
