import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { parseApiEnvironment } from '@glorychips/config';
import { InventoryDomainError } from '@glorychips/database';
import type { SessionPrincipal } from '@glorychips/database';
import { SystemAdminGuard } from '../access/system-admin.guard.js';
import { ApiExceptionFilter } from '../auth/api-exception.filter.js';
import { SessionGuard } from '../auth/session.guard.js';
import {
  ADMIN_TASK_SERVICE,
  API_ENVIRONMENT,
  AUTH_SERVICE,
  INVENTORY_OPERATIONS_SERVICE,
  RETURN_REMINDER_SERVICE,
  RETURN_SERVICE,
  WORK_CALENDAR_ADMIN_SERVICE,
} from '../auth/tokens.js';
import { AdminInventoryOperationsController } from './admin-inventory-operations.controller.js';
import { AdminReturnsController } from './admin-returns.controller.js';
import { AdminTasksController } from './admin-tasks.controller.js';
import { AdminWorkCalendarController } from './admin-work-calendar.controller.js';

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
const userId = '11111111-1111-4111-8111-111111111111';
const variantId = '22222222-2222-4222-8222-222222222222';

const principal = (
  roles: SessionPrincipal['roles'],
  warehouses: SessionPrincipal['warehouses'] = [],
): SessionPrincipal => ({
  sessionId: 'session',
  userId,
  feishuUserId: 'employee',
  name: 'Employee',
  avatarUrl: null,
  roles,
  warehouses,
  expiresAt: new Date('2026-09-05T00:00:00.000Z'),
});

class HttpSessionService {
  public async loadSession(token: string): Promise<SessionPrincipal> {
    if (token === 'system-token') {
      return principal(['CLAIMANT', 'SYSTEM_ADMIN'], ['XIHU', 'YUHANG']);
    }
    return principal(['CLAIMANT', 'WAREHOUSE_ADMIN'], ['YUHANG']);
  }
}

class HttpInventoryOperationsService {
  public key: string | null = null;

  public async createInbound(command: { warehouse: string }, key: string) {
    this.key = key;
    if (command.warehouse === 'XIHU') {
      throw new InventoryDomainError('FORBIDDEN_WAREHOUSE', 'Outside warehouse scope.');
    }
    return { ok: true };
  }

  public async createTransfer() {
    return { ok: true };
  }

  public async createStocktake() {
    return { ok: true };
  }
}

class HttpReturnService {
  public async list() {
    return { items: [] };
  }

  public async confirm() {
    return { ok: true };
  }
}

class HttpReminderService {
  public async triggerDeparture() {
    return { created: 1 };
  }
}

class HttpTaskService {
  public async list() {
    return { items: [] };
  }
}

class HttpCalendarService {
  public async list() {
    return { items: [] };
  }

  public async upsert() {
    return { date: '2026-09-04', isWorkingDay: true, description: null };
  }

  public async remove() {
    return { deleted: true };
  }
}

describe('inventory operations HTTP pipeline', () => {
  let application: INestApplication;
  let inventory: HttpInventoryOperationsService;

  beforeAll(async () => {
    inventory = new HttpInventoryOperationsService();
    const module = await Test.createTestingModule({
      controllers: [
        AdminInventoryOperationsController,
        AdminReturnsController,
        AdminTasksController,
        AdminWorkCalendarController,
      ],
      providers: [
        { provide: API_ENVIRONMENT, useValue: environment },
        { provide: AUTH_SERVICE, useClass: HttpSessionService },
        { provide: INVENTORY_OPERATIONS_SERVICE, useValue: inventory },
        { provide: RETURN_SERVICE, useClass: HttpReturnService },
        { provide: RETURN_REMINDER_SERVICE, useClass: HttpReminderService },
        { provide: ADMIN_TASK_SERVICE, useClass: HttpTaskService },
        { provide: WORK_CALENDAR_ADMIN_SERVICE, useClass: HttpCalendarService },
        SessionGuard,
        SystemAdminGuard,
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
      ],
    }).compile();
    application = module.createNestApplication();
    await application.init();
  });

  afterAll(async () => application.close());

  it('requires a session and idempotency key for inventory writes', async () => {
    const command = {
      warehouse: 'YUHANG',
      inboundType: 'PURCHASE',
      occurredAt: '2026-09-04T08:00:00.000Z',
      reason: '采购到货',
      lines: [{ variantId, quantity: 1 }],
    };
    await request(application.getHttpServer())
      .post('/admin/inventory/inbound')
      .send(command)
      .expect(401);
    await request(application.getHttpServer())
      .post('/admin/inventory/inbound')
      .set('Cookie', 'glorychips_session=admin-token')
      .send(command)
      .expect(400);
    await request(application.getHttpServer())
      .post('/admin/inventory/inbound')
      .set('Cookie', 'glorychips_session=admin-token')
      .set('Idempotency-Key', 'http-inbound-key')
      .send(command)
      .expect(201);
    expect(inventory.key).toBe('http-inbound-key');
  });

  it('maps warehouse authorization errors to 403', async () => {
    await request(application.getHttpServer())
      .post('/admin/inventory/inbound')
      .set('Cookie', 'glorychips_session=admin-token')
      .set('Idempotency-Key', 'http-forbidden-key')
      .send({
        warehouse: 'XIHU',
        inboundType: 'OTHER',
        occurredAt: '2026-09-04T08:00:00.000Z',
        reason: '其他入库',
        lines: [{ variantId, quantity: 1 }],
      })
      .expect(403);
  });

  it('restricts departure triggers and calendar writes to system administrators', async () => {
    const departure = { claimantId: userId, reason: '飞书同步异常，人工确认离职' };
    await request(application.getHttpServer())
      .post('/admin/returns/departure-trigger')
      .set('Cookie', 'glorychips_session=admin-token')
      .set('Idempotency-Key', 'http-departure-admin')
      .send(departure)
      .expect(403);
    await request(application.getHttpServer())
      .post('/admin/returns/departure-trigger')
      .set('Cookie', 'glorychips_session=system-token')
      .set('Idempotency-Key', 'http-departure-system')
      .send(departure)
      .expect(201);
    await request(application.getHttpServer())
      .put('/admin/work-calendar/2026-09-04')
      .set('Cookie', 'glorychips_session=admin-token')
      .set('Idempotency-Key', 'http-calendar-admin')
      .send({ isWorkingDay: true })
      .expect(403);
    await request(application.getHttpServer())
      .put('/admin/work-calendar/2026-09-04')
      .set('Cookie', 'glorychips_session=system-token')
      .set('Idempotency-Key', 'http-calendar-system')
      .send({ isWorkingDay: true })
      .expect(200);
  });

  it('returns stable validation errors for invalid calendar mutations', async () => {
    await request(application.getHttpServer())
      .put('/admin/work-calendar/not-a-date')
      .set('Cookie', 'glorychips_session=system-token')
      .set('Idempotency-Key', 'http-calendar-invalid-date')
      .send({ isWorkingDay: true })
      .expect(400)
      .expect(({ body }) => expect(body).toMatchObject({ code: 'VALIDATION_ERROR' }));
    await request(application.getHttpServer())
      .put('/admin/work-calendar/2026-09-04')
      .set('Cookie', 'glorychips_session=system-token')
      .set('Idempotency-Key', 'http-calendar-invalid-body')
      .send({ isWorkingDay: 'yes' })
      .expect(400)
      .expect(({ body }) => expect(body).toMatchObject({ code: 'VALIDATION_ERROR' }));
    await request(application.getHttpServer())
      .delete('/admin/work-calendar/not-a-date')
      .set('Cookie', 'glorychips_session=system-token')
      .set('Idempotency-Key', 'http-calendar-invalid-delete')
      .expect(400)
      .expect(({ body }) => expect(body).toMatchObject({ code: 'VALIDATION_ERROR' }));
  });
});
