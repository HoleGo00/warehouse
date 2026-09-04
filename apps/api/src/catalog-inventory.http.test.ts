import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { parseApiEnvironment } from '@glorychips/config';
import type {
  CatalogProductResponse,
  CreateCatalogProductRequest,
  InventoryQuery,
  UpdateCatalogProductRequest,
} from '@glorychips/contracts';
import type { SessionPrincipal } from '@glorychips/database';
import { SystemAdminGuard } from './access/system-admin.guard.js';
import { ApiExceptionFilter } from './auth/api-exception.filter.js';
import { SessionGuard } from './auth/session.guard.js';
import {
  API_ENVIRONMENT,
  AUTH_SERVICE,
  CATALOG_SERVICE,
  INVENTORY_QUERY_SERVICE,
  PRODUCT_IMAGE_CONTENT_PROVIDER,
  WAREHOUSE_DIRECTORY_SERVICE,
} from './auth/tokens.js';
import { CatalogController } from './catalog/catalog.controller.js';
import { UnavailableProductImageContentProvider } from './catalog/product-image.provider.js';
import { InventoryController } from './inventory/inventory.controller.js';
import { WarehousesController } from './warehouses/warehouses.controller.js';

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

const productId = '11111111-1111-4111-8111-111111111111';
const variantId = '22222222-2222-4222-8222-222222222222';
const imageId = '33333333-3333-4333-8333-333333333333';

const baseProduct: CatalogProductResponse = {
  id: productId,
  code: 'WATCH_HTTP_TEST',
  name: 'HTTP 测试腕表',
  category: 'SMART_WATCH',
  specificationMode: 'NONE',
  status: 'INACTIVE',
  baseTarget: 'WATCH',
  imageReady: false,
  mainImage: null,
  detailImages: [],
  variants: [
    {
      id: variantId,
      code: 'DEFAULT',
      displayName: 'HTTP 测试腕表',
      size: null,
      isActive: false,
    },
  ],
};

const principal = (roles: SessionPrincipal['roles']): SessionPrincipal => ({
  sessionId: 'session-id',
  userId: '44444444-4444-4444-8444-444444444444',
  feishuUserId: 'employee',
  name: 'Employee',
  avatarUrl: null,
  roles,
  warehouses: roles.includes('SYSTEM_ADMIN') ? ['XIHU', 'YUHANG'] : [],
  expiresAt: new Date('2026-09-05T00:00:00.000Z'),
});

class HttpSessionService {
  public async loadSession(token: string): Promise<SessionPrincipal> {
    return token === 'system-token'
      ? principal(['CLAIMANT', 'SYSTEM_ADMIN'])
      : principal(['CLAIMANT']);
  }
}

class HttpCatalogService {
  public async listCatalog() {
    return { items: [baseProduct] };
  }

  public async listSelectableCatalog() {
    return { items: [] };
  }

  public async createProduct(command: CreateCatalogProductRequest) {
    return {
      product: {
        ...baseProduct,
        code: command.code,
        name: command.name,
        category: command.category,
        specificationMode: command.category === 'SMART_RING' ? 'RING_SIZE' : 'NONE',
        baseTarget: command.category === 'SMART_RING' ? 'RING' : 'WATCH',
        status: command.status,
      },
    };
  }

  public async updateProduct(_productId: string, command: UpdateCatalogProductRequest) {
    return { product: { ...baseProduct, ...command } };
  }

  public async getImageReference() {
    return { attachmentToken: 'private-attachment-token', fileName: 'main.png' };
  }
}

class HttpInventoryQueryService {
  public async query(query: InventoryQuery) {
    const quantity = {
      confirmedFeishuQuantity: 7,
      pendingMovementDelta: -2,
      effectiveOnHandQuantity: 5,
      reservedQuantity: 1,
      availableQuantity: 4,
      syncIndicator: 'PENDING_LOCAL_CHANGES' as const,
    };
    return {
      warehouse: query.warehouse,
      category: query.category ?? null,
      warehouses: [
        { code: 'XIHU' as const, name: '西湖仓' },
        { code: 'YUHANG' as const, name: '余杭仓' },
      ],
      products: [
        {
          id: productId,
          code: 'WATCH_HEALTH',
          name: '健康腕表',
          category: 'SMART_WATCH' as const,
          status: 'ACTIVE' as const,
          imageReady: false,
          mainImage: null,
          variants: [
            {
              id: variantId,
              code: 'DEFAULT',
              displayName: '健康腕表',
              size: null,
              isActive: true,
              warehouses: [{ warehouse: 'XIHU' as const, ...quantity }],
              total: quantity,
            },
          ],
        },
      ],
    };
  }
}

class HttpWarehouseDirectoryService {
  public async listActive() {
    return [
      { id: 'xihu', code: 'XIHU', name: '西湖仓', publicSlug: 'xihu' },
      { id: 'yuhang', code: 'YUHANG', name: '余杭仓', publicSlug: 'yuhang' },
    ];
  }
}

describe('catalog, inventory and warehouse HTTP pipeline', () => {
  let application: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CatalogController, InventoryController, WarehousesController],
      providers: [
        { provide: API_ENVIRONMENT, useValue: environment },
        { provide: AUTH_SERVICE, useClass: HttpSessionService },
        { provide: CATALOG_SERVICE, useClass: HttpCatalogService },
        { provide: INVENTORY_QUERY_SERVICE, useClass: HttpInventoryQueryService },
        { provide: WAREHOUSE_DIRECTORY_SERVICE, useClass: HttpWarehouseDirectoryService },
        {
          provide: PRODUCT_IMAGE_CONTENT_PROVIDER,
          useClass: UnavailableProductImageContentProvider,
        },
        SessionGuard,
        SystemAdminGuard,
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
      ],
    }).compile();
    application = module.createNestApplication();
    await application.init();
  });

  afterAll(async () => {
    await application.close();
  });

  it('allows an ordinary employee to read inventory quantities and sync state', async () => {
    const response = await request(application.getHttpServer())
      .get('/inventory')
      .query({ warehouse: 'ALL', category: 'SMART_WATCH' })
      .set('Cookie', `${environment.SESSION_COOKIE_NAME}=claimant-token`)
      .expect(200);

    expect(response.body.products[0].variants[0].total).toMatchObject({
      effectiveOnHandQuantity: 5,
      availableQuantity: 4,
      syncIndicator: 'PENDING_LOCAL_CHANGES',
    });
  });

  it('requires the system administrator role for catalog writes', async () => {
    const payload = { code: 'WATCH_CREATED_BY_HTTP', name: '接口新腕表', category: 'SMART_WATCH' };
    await request(application.getHttpServer())
      .post('/catalog')
      .set('Cookie', `${environment.SESSION_COOKIE_NAME}=claimant-token`)
      .send(payload)
      .expect(403)
      .expect(({ body }) => expect(body.code).toBe('FORBIDDEN_ROLE'));

    await request(application.getHttpServer())
      .post('/catalog')
      .set('Cookie', `${environment.SESSION_COOKIE_NAME}=system-token`)
      .send(payload)
      .expect(201)
      .expect(({ body }) => {
        expect(body.product).toMatchObject({ code: payload.code, status: 'INACTIVE' });
      });
  });

  it('rejects invalid inventory filters before querying the database', async () => {
    await request(application.getHttpServer())
      .get('/inventory')
      .query({ warehouse: 'UNKNOWN' })
      .set('Cookie', `${environment.SESSION_COOKIE_NAME}=claimant-token`)
      .expect(400)
      .expect(({ body }) => expect(body.code).toBe('VALIDATION_ERROR'));
  });

  it('returns a stable image-provider error without leaking the attachment token', async () => {
    const response = await request(application.getHttpServer())
      .get(`/catalog/images/${imageId}`)
      .set('Cookie', `${environment.SESSION_COOKIE_NAME}=claimant-token`)
      .expect(503);

    expect(response.body.code).toBe('IMAGE_UNAVAILABLE');
    expect(JSON.stringify(response.body)).not.toContain('private-attachment-token');
  });

  it('returns stable warehouse entries and a downloadable non-empty QR SVG', async () => {
    const cookie = `${environment.SESSION_COOKIE_NAME}=claimant-token`;
    const entries = await request(application.getHttpServer())
      .get('/warehouses/entries')
      .set('Cookie', cookie)
      .expect(200);
    expect(entries.body).toMatchObject({
      productionReady: false,
      items: [
        {
          code: 'XIHU',
          applyPath: '/w/XIHU/apply',
          publicUrl: 'http://localhost:5173/w/XIHU/apply',
          qrCodeUrl: '/warehouses/XIHU/qr.svg',
        },
        {
          code: 'YUHANG',
          applyPath: '/w/YUHANG/apply',
          publicUrl: 'http://localhost:5173/w/YUHANG/apply',
          qrCodeUrl: '/warehouses/YUHANG/qr.svg',
        },
      ],
    });

    const qr = await request(application.getHttpServer())
      .get('/warehouses/XIHU/qr.svg')
      .set('Cookie', cookie)
      .expect(200);
    expect(qr.headers['content-type']).toContain('image/svg+xml');
    expect(qr.headers['content-disposition']).toContain('warehouse-xihu-apply.svg');
    const svg = Buffer.isBuffer(qr.body) ? qr.body.toString('utf8') : String(qr.body);
    expect(svg).toContain('<svg');
    expect(svg).not.toContain('token=');
  });
});
