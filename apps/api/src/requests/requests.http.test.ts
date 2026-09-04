import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { parseApiEnvironment } from '@glorychips/config';
import type {
  CreateNormalRequest,
  NormalRequestAdminQueueQuery,
  ReviewNormalRequest,
} from '@glorychips/contracts';
import { RequestDomainError } from '@glorychips/database';
import type { SessionPrincipal } from '@glorychips/database';
import { ApiExceptionFilter } from '../auth/api-exception.filter.js';
import { SessionGuard } from '../auth/session.guard.js';
import {
  API_ENVIRONMENT,
  AUTH_SERVICE,
  NORMAL_REQUEST_SERVICE,
  REQUEST_QUERY_SERVICE,
  REQUEST_REVIEW_SERVICE,
  TEMPORARY_OFFLINE_REQUEST_SERVICE,
} from '../auth/tokens.js';
import { AdminClaimantsController } from './admin-claimants.controller.js';
import { AdminRequestsController } from './admin-requests.controller.js';
import { RequestsController } from './requests.controller.js';

const environment = parseApiEnvironment({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://warehouse:warehouse@localhost:5432/warehouse',
  WEB_PUBLIC_URL: 'http://localhost:5173',
  FEISHU_APP_ID: 'cli_0123456789abcdef',
  FEISHU_APP_SECRET: 'not-a-real-secret',
  FEISHU_ALLOWED_TENANT_KEY: 'tenant',
  FEISHU_REDIRECT_URI: 'http://localhost:3000/auth/feishu/oauth/callback',
  INITIAL_ADMIN_FEISHU_USER_ID: 'initial-admin',
});

const requestId = '11111111-1111-4111-8111-111111111111';
const variantId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';

const principal = (
  roles: SessionPrincipal['roles'],
  warehouses: SessionPrincipal['warehouses'] = [],
): SessionPrincipal => ({
  sessionId: 'session-id',
  userId,
  feishuUserId: 'employee',
  name: 'Employee',
  avatarUrl: null,
  roles,
  warehouses,
  expiresAt: new Date('2026-09-05T00:00:00.000Z'),
});

const detail = {
  id: requestId,
  requestNumber: 'NR-20260904-HTTPTEST',
  warehouse: 'YUHANG' as const,
  warehouseName: '余杭仓',
  claimantId: userId,
  claimantName: 'Employee',
  origin: 'ONLINE' as const,
  type: 'INTERNAL' as const,
  purposeObject: 'HTTP 测试',
  finalDestination: '测试部门',
  notes: null,
  returnMode: 'NOT_REQUIRED' as const,
  expectedReturnDate: null,
  status: 'PENDING_APPROVAL' as const,
  syncStatus: 'NOT_REQUIRED' as const,
  itemCount: 1,
  totalQuantity: 1,
  submittedAt: '2026-09-04T00:00:00.000Z',
  createdAt: '2026-09-04T00:00:00.000Z',
  updatedAt: '2026-09-04T00:00:00.000Z',
  latestReviewComment: null,
  paperworkDueAt: null,
  paperworkOverdue: false,
  allowedActions: {
    resubmit: false,
    completePaperwork: false,
    cancel: true,
    review: false,
    fulfill: false,
    adminCancel: false,
    confirmReturn: false,
  },
  items: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      productId: '55555555-5555-4555-8555-555555555555',
      variantId,
      productName: '健康腕表',
      variantName: '健康腕表',
      size: null,
      quantity: 1,
    },
  ],
  approvals: [],
  fulfillment: null,
  returnObligations: [],
};

class HttpSessionService {
  public async loadSession(token: string): Promise<SessionPrincipal> {
    if (token === 'admin-token') {
      return principal(['CLAIMANT', 'WAREHOUSE_ADMIN'], ['YUHANG']);
    }
    return principal(['CLAIMANT']);
  }
}

class HttpNormalRequestService {
  public lastIdempotencyKey: string | null = null;

  public async createAndSubmit(_command: CreateNormalRequest, idempotencyKey: string) {
    this.lastIdempotencyKey = idempotencyKey;
    return { request: detail };
  }

  public async resubmit() {
    return { request: detail };
  }

  public async listMine() {
    return {
      items: [
        {
          id: detail.id,
          requestNumber: detail.requestNumber,
          warehouse: detail.warehouse,
          warehouseName: detail.warehouseName,
          claimantId: detail.claimantId,
          claimantName: detail.claimantName,
          type: detail.type,
          purposeObject: detail.purposeObject,
          finalDestination: detail.finalDestination,
          returnMode: detail.returnMode,
          expectedReturnDate: detail.expectedReturnDate,
          status: detail.status,
          syncStatus: detail.syncStatus,
          itemCount: detail.itemCount,
          totalQuantity: detail.totalQuantity,
          submittedAt: detail.submittedAt,
          createdAt: detail.createdAt,
          updatedAt: detail.updatedAt,
          latestReviewComment: detail.latestReviewComment,
          allowedActions: detail.allowedActions,
        },
      ],
    };
  }

  public async getVisibleDetail() {
    return { request: detail };
  }

  public async cancel() {
    return { request: { ...detail, status: 'CANCELLED' as const } };
  }

  public async listAdminQueue(query: NormalRequestAdminQueueQuery) {
    if (query.warehouse === 'XIHU') {
      throw new RequestDomainError('REQUEST_FORBIDDEN', 'Outside warehouse scope.');
    }
    return { items: [] };
  }

  public async review(_requestId: string, command: ReviewNormalRequest) {
    return {
      request: {
        ...detail,
        status:
          command.decision === 'APPROVED' ? ('PENDING_RELEASE' as const) : ('REJECTED' as const),
      },
    };
  }

  public async fulfill() {
    throw new RequestDomainError('REQUEST_STATE_CONFLICT', 'Invalid state.');
  }
}

class HttpRequestQueryService {
  public async listMine() {
    return { items: [] };
  }

  public async getVisibleDetail() {
    return { request: detail };
  }

  public async listAdminQueue(query: NormalRequestAdminQueueQuery) {
    if (query.warehouse === 'XIHU') {
      throw new RequestDomainError('REQUEST_FORBIDDEN', 'Outside warehouse scope.');
    }
    return { items: [] };
  }

  public async listPaperworkQueue() {
    return { items: [] };
  }

  public async searchClaimants() {
    return { items: [{ id: userId, name: 'Employee', avatarUrl: null }] };
  }
}

class HttpTemporaryRequestService {
  public async createTemporary() {
    return {
      request: {
        ...detail,
        origin: 'EXPRESS' as const,
        type: null,
        purposeObject: null,
        finalDestination: null,
        status: 'PENDING_PAPERWORK' as const,
        paperworkDueAt: '2026-09-09T15:59:59.999Z',
      },
    };
  }

  public async completePaperwork() {
    return { request: { ...detail, origin: 'EXPRESS' as const } };
  }

  public async createOffline() {
    return { request: { ...detail, origin: 'OFFLINE' as const, status: 'COMPLETED' as const } };
  }
}

class HttpRequestReviewService {
  public async review(_requestId: string, command: ReviewNormalRequest) {
    return {
      request: {
        ...detail,
        status:
          command.decision === 'APPROVED' ? ('PENDING_RELEASE' as const) : ('REJECTED' as const),
      },
    };
  }
}

describe('normal request HTTP pipeline', () => {
  let application: INestApplication;
  let service: HttpNormalRequestService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [RequestsController, AdminRequestsController, AdminClaimantsController],
      providers: [
        { provide: API_ENVIRONMENT, useValue: environment },
        { provide: AUTH_SERVICE, useClass: HttpSessionService },
        { provide: NORMAL_REQUEST_SERVICE, useClass: HttpNormalRequestService },
        { provide: REQUEST_QUERY_SERVICE, useClass: HttpRequestQueryService },
        { provide: REQUEST_REVIEW_SERVICE, useClass: HttpRequestReviewService },
        {
          provide: TEMPORARY_OFFLINE_REQUEST_SERVICE,
          useClass: HttpTemporaryRequestService,
        },
        SessionGuard,
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
      ],
    }).compile();
    application = module.createNestApplication();
    await application.init();
    service = module.get<HttpNormalRequestService>(NORMAL_REQUEST_SERVICE);
  });

  afterAll(async () => {
    await application.close();
  });

  it('requires a session and an idempotency header for submission', async () => {
    const payload = {
      warehouse: 'YUHANG',
      type: 'INTERNAL',
      purposeObject: 'HTTP 测试',
      finalDestination: '测试部门',
      returnMode: 'NOT_REQUIRED',
      items: [{ variantId, quantity: 1 }],
    };
    await request(application.getHttpServer()).post('/requests/normal').send(payload).expect(401);
    await request(application.getHttpServer())
      .post('/requests/normal')
      .set('Cookie', `${environment.SESSION_COOKIE_NAME}=claimant-token`)
      .send(payload)
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('VALIDATION_ERROR'));
  });

  it('passes the stable idempotency key to the domain service', async () => {
    const key = 'http-submit-key';
    await request(application.getHttpServer())
      .post('/requests/normal')
      .set('Cookie', `${environment.SESSION_COOKIE_NAME}=claimant-token`)
      .set('Idempotency-Key', key)
      .send({
        warehouse: 'YUHANG',
        type: 'INTERNAL',
        purposeObject: 'HTTP 测试',
        finalDestination: '测试部门',
        returnMode: 'NOT_REQUIRED',
        items: [{ variantId, quantity: 1 }],
      })
      .expect(201)
      .expect(({ body }) => expect(body.request.id).toBe(requestId));
    expect(service.lastIdempotencyKey).toBe(key);
  });

  it('enforces queue validation and maps actual warehouse authorization failures', async () => {
    const cookie = `${environment.SESSION_COOKIE_NAME}=admin-token`;
    await request(application.getHttpServer())
      .get('/admin/requests')
      .query({ warehouse: 'UNKNOWN', status: 'PENDING_APPROVAL' })
      .set('Cookie', cookie)
      .expect(400);
    await request(application.getHttpServer())
      .get('/admin/requests')
      .query({ warehouse: 'XIHU', status: 'PENDING_APPROVAL' })
      .set('Cookie', cookie)
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('REQUEST_FORBIDDEN'));
  });

  it('requires rejection comments and returns stable state conflicts', async () => {
    const cookie = `${environment.SESSION_COOKIE_NAME}=admin-token`;
    await request(application.getHttpServer())
      .post(`/admin/requests/${requestId}/review`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', 'reject-without-comment')
      .send({ decision: 'REJECTED' })
      .expect(400);
    await request(application.getHttpServer())
      .post(`/admin/requests/${requestId}/fulfill`)
      .set('Cookie', cookie)
      .set('Idempotency-Key', 'invalid-fulfill-state')
      .send({})
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('REQUEST_STATE_CONFLICT'));
  });

  it('keeps temporary, paperwork and offline static routes reachable', async () => {
    const claimantCookie = `${environment.SESSION_COOKIE_NAME}=claimant-token`;
    const adminCookie = `${environment.SESSION_COOKIE_NAME}=admin-token`;
    await request(application.getHttpServer())
      .post('/requests/temporary')
      .set('Cookie', claimantCookie)
      .set('Idempotency-Key', 'temporary-http-key')
      .send({ warehouse: 'YUHANG', items: [{ variantId, quantity: 1 }] })
      .expect(201)
      .expect(({ body }) => expect(body.request.status).toBe('PENDING_PAPERWORK'));
    await request(application.getHttpServer())
      .put(`/requests/${requestId}/paperwork`)
      .set('Cookie', claimantCookie)
      .set('Idempotency-Key', 'paperwork-http-key')
      .send({
        type: 'INTERNAL',
        purposeObject: '补充用途',
        finalDestination: '测试部门',
        returnMode: 'NOT_REQUIRED',
      })
      .expect(200);
    await request(application.getHttpServer())
      .get('/admin/requests/paperwork')
      .query({ warehouse: 'YUHANG', state: 'REQUIRED' })
      .set('Cookie', adminCookie)
      .expect(200);
    await request(application.getHttpServer())
      .get('/admin/claimants')
      .query({ query: 'Employee' })
      .set('Cookie', adminCookie)
      .expect(200)
      .expect(({ body }) => expect(body.items).toHaveLength(1));
    await request(application.getHttpServer())
      .post('/admin/requests/offline')
      .set('Cookie', adminCookie)
      .set('Idempotency-Key', 'offline-http-key')
      .send({
        warehouse: 'YUHANG',
        claimantId: userId,
        type: 'INTERNAL',
        purposeObject: '线下领取',
        finalDestination: '测试部门',
        returnMode: 'NOT_REQUIRED',
        items: [{ variantId, quantity: 1 }],
      })
      .expect(201)
      .expect(({ body }) => expect(body.request.origin).toBe('OFFLINE'));
  });

  it('requires idempotency keys for every temporary and offline mutation', async () => {
    const claimantCookie = `${environment.SESSION_COOKIE_NAME}=claimant-token`;
    const adminCookie = `${environment.SESSION_COOKIE_NAME}=admin-token`;
    await request(application.getHttpServer())
      .post('/requests/temporary')
      .set('Cookie', claimantCookie)
      .send({ warehouse: 'YUHANG', items: [{ variantId, quantity: 1 }] })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('VALIDATION_ERROR'));
    await request(application.getHttpServer())
      .put(`/requests/${requestId}/paperwork`)
      .set('Cookie', claimantCookie)
      .send({
        type: 'INTERNAL',
        purposeObject: '补充用途',
        finalDestination: '测试部门',
        returnMode: 'NOT_REQUIRED',
      })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('VALIDATION_ERROR'));
    await request(application.getHttpServer())
      .post('/admin/requests/offline')
      .set('Cookie', adminCookie)
      .send({
        warehouse: 'YUHANG',
        claimantId: userId,
        type: 'INTERNAL',
        purposeObject: '线下领取',
        finalDestination: '测试部门',
        returnMode: 'NOT_REQUIRED',
        items: [{ variantId, quantity: 1 }],
      })
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('VALIDATION_ERROR'));
  });
});
