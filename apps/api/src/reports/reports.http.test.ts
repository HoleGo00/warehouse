import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { parseApiEnvironment } from '@glorychips/config';
import { ExportStorage, ReportError, reportWarehouses } from '@glorychips/database';
import type { SessionPrincipal } from '@glorychips/database';
import { SessionGuard } from '../auth/session.guard.js';
import { ApiExceptionFilter } from '../auth/api-exception.filter.js';
import { API_ENVIRONMENT, AUTH_SERVICE } from '../auth/tokens.js';
import {
  ReportsController,
  ExportsController,
  REPORT_SERVICE,
  EXPORT_SERVICE,
  EXPORT_STORAGE,
} from './reports.controller.js';
import { ReportWriteGuard } from './report-write.guard.js';

const environment = parseApiEnvironment({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  WEB_PUBLIC_URL: 'http://localhost:5173',
  FEISHU_APP_ID: 'cli_0123456789abcdef',
  FEISHU_APP_SECRET: 'test-only',
  FEISHU_ALLOWED_TENANT_KEY: 'test',
  FEISHU_REDIRECT_URI: 'http://localhost:3000/auth/feishu/oauth/callback',
  INITIAL_ADMIN_FEISHU_USER_ID: 'test-admin',
});
describe('report HTTP boundaries and private download streaming', () => {
  let app: INestApplication;
  let directory: string;
  let storage: ExportStorage;
  const id = randomUUID();
  const key = `${id}.${randomUUID()}.xlsx`;
  const job = {
    id,
    status: 'QUEUED',
    createdAt: new Date().toISOString(),
    snapshotAt: null,
    completedAt: null,
    expiresAt: null,
    summaryCount: 0,
    detailCount: 0,
    fileSize: null,
    errorCode: null,
  };
  const create = vi.fn(async () => ({ job }));
  const download = vi.fn(async () => ({ key, size: 4, name: `warehouse-${id}.xlsx` }));
  const query = vi.fn(async (filters, actor: SessionPrincipal) => {
    reportWarehouses(actor, filters.warehouse);
    return { items: [], nextCursor: null };
  });
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'warehouse-report-http-'));
    storage = new ExportStorage(directory);
    await storage.initialize();
    const stream = await storage.writer(key);
    stream.end(Buffer.from('PK\x03\x04'));
    await once(stream, 'finish');
    const module = await Test.createTestingModule({
      controllers: [ReportsController, ExportsController],
      providers: [
        { provide: API_ENVIRONMENT, useValue: environment },
        {
          provide: AUTH_SERVICE,
          useValue: {
            loadSession: async (token: string): Promise<SessionPrincipal> => ({
              userId: id,
              sessionId: id,
              feishuUserId: 'test',
              name: 'Test',
              avatarUrl: null,
              expiresAt: new Date(Date.now() + 60_000),
              roles:
                token === 'admin'
                  ? ['CLAIMANT', 'SYSTEM_ADMIN']
                  : token === 'warehouse'
                    ? ['CLAIMANT', 'WAREHOUSE_ADMIN']
                    : ['CLAIMANT'],
              warehouses: token === 'warehouse' ? ['XIHU'] : [],
            }),
          },
        },
        { provide: REPORT_SERVICE, useValue: { query } },
        { provide: EXPORT_SERVICE, useValue: { create, download } },
        { provide: EXPORT_STORAGE, useValue: storage },
        SessionGuard,
        ReportWriteGuard,
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    if (directory?.startsWith(join(tmpdir(), 'warehouse-report-http-')))
      await rm(directory, { recursive: true, force: true });
  });
  it('requires a session, administrator role and exact warehouse scope', async () => {
    await request(app.getHttpServer()).get('/admin/reports/requests').expect(401);
    await request(app.getHttpServer())
      .get('/admin/reports/requests')
      .set('Cookie', 'glorychips_session=claimant')
      .expect(403);
    await request(app.getHttpServer())
      .get('/admin/reports/requests?warehouse=YUHANG')
      .set('Cookie', 'glorychips_session=warehouse')
      .expect(403);
    await request(app.getHttpServer())
      .get('/admin/reports/requests?warehouse=XIHU')
      .set('Cookie', 'glorychips_session=warehouse')
      .expect(200);
  });
  it('rejects malformed filters before domain calls', async () => {
    const calls = query.mock.calls.length;
    for (const suffix of [
      'from=2026-02-30',
      'dateMode=OTHER',
      'size=INVALID',
      'limit=101',
      'productId=bad',
      'unknown=x',
    ]) {
      await request(app.getHttpServer())
        .get(`/admin/reports/requests?${suffix}`)
        .set('Cookie', 'glorychips_session=admin')
        .expect(400);
    }
    expect(query.mock.calls.length).toBe(calls);
  });
  it('rejects cross-site and non-JSON writes before task creation', async () => {
    const call = () =>
      request(app.getHttpServer())
        .post('/admin/exports')
        .set('Cookie', 'glorychips_session=admin')
        .set('Idempotency-Key', randomUUID());
    await call().set('Origin', 'https://other.invalid').send({}).expect(400);
    await call().set('Sec-Fetch-Site', 'cross-site').send({}).expect(400);
    await call().type('form').send({ dateMode: 'SUBMITTED' }).expect(400);
    expect(create).not.toHaveBeenCalled();
    await call().set('Origin', environment.WEB_PUBLIC_URL).send({}).expect(201);
    expect(create).toHaveBeenCalledOnce();
  });
  it('streams only the owned task filename with private attachment headers', async () => {
    const response = await request(app.getHttpServer())
      .get(`/admin/exports/${id}/download`)
      .set('Cookie', 'glorychips_session=admin')
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(response.headers['content-type']).toContain('spreadsheetml.sheet');
    expect(response.headers['content-disposition']).toContain(`warehouse-${id}.xlsx`);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.body).toEqual(Buffer.from('PK\x03\x04'));
  });
  it('maps expiration and missing storage to stable errors without leaking paths', async () => {
    download.mockRejectedValueOnce(new ReportError('EXPORT_EXPIRED', '文件已过期'));
    await request(app.getHttpServer())
      .get(`/admin/exports/${id}/download`)
      .set('Cookie', 'glorychips_session=admin')
      .expect(410);
    await storage.remove(key);
    const response = await request(app.getHttpServer())
      .get(`/admin/exports/${id}/download`)
      .set('Cookie', 'glorychips_session=admin')
      .expect(503);
    expect(response.body.code).toBe('EXPORT_STORAGE');
    expect(JSON.stringify(response.body)).not.toContain(directory);
  });
});
