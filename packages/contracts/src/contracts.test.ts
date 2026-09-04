import { describe, expect, it } from 'vitest';
import {
  apiErrorResponseSchema,
  calculateAvailability,
  createCatalogProductRequestSchema,
  feishuAppIdSchema,
  inventoryQueryResponseSchema,
  inventoryQuerySchema,
  isFeishuAppId,
  normalizeAuthReturnPath,
  productCatalog,
  productStatusSchema,
  ringSizeSchema,
  ringSizes,
  updateAccessRequestSchema,
} from './index.js';

describe('shared contracts', () => {
  it('accepts real Feishu App ID shapes and rejects preview placeholders', () => {
    expect(feishuAppIdSchema.parse('cli_0123456789abcdef')).toBe('cli_0123456789abcdef');
    expect(isFeishuAppId('cli_local_visual_check')).toBe(false);
    expect(isFeishuAppId('replace_with_feishu_app_id')).toBe(false);
  });

  it('defines the exact supported ring sizes', () => {
    expect(ringSizes).toEqual(['6#', '7#', '8#', '9#', '10#', '11#', '12#', '13#']);
    expect(ringSizeSchema.safeParse('14#').success).toBe(false);
  });

  it('keeps the approved product catalog in one shared contract', () => {
    expect(productCatalog).toHaveLength(14);
    expect(
      productCatalog.filter((product) => product.status === 'INACTIVE_HISTORICAL'),
    ).toHaveLength(3);
    expect(productStatusSchema.parse('INACTIVE_HISTORICAL')).toBe('INACTIVE_HISTORICAL');
  });

  it('computes effective and available quantities', () => {
    expect(
      calculateAvailability({
        confirmedFeishuQuantity: 10,
        pendingMovementDelta: -2,
        reservedQuantity: 3,
      }),
    ).toEqual({ effectiveOnHandQuantity: 8, availableQuantity: 5 });
  });

  it('normalizes only known internal authentication return paths', () => {
    expect(normalizeAuthReturnPath('/w/XIHU/apply?source=qr')).toBe('/w/XIHU/apply?source=qr');
    expect(normalizeAuthReturnPath('/inventory?warehouse=YUHANG')).toBe(
      '/inventory?warehouse=YUHANG',
    );
    expect(normalizeAuthReturnPath('/admin/catalog')).toBe('/admin/catalog');
    expect(normalizeAuthReturnPath('/admin/requests/offline')).toBe('/admin/requests/offline');
    expect(normalizeAuthReturnPath('/w/YUHANG/apply/temporary')).toBe('/w/YUHANG/apply/temporary');
    expect(normalizeAuthReturnPath('/w/UNKNOWN/apply')).toBe('/');
    expect(normalizeAuthReturnPath('//evil.example/path')).toBe('/');
    expect(normalizeAuthReturnPath('https://evil.example/path')).toBe('/');
  });

  it('validates catalog mutations and inventory filters at the shared boundary', () => {
    expect(
      createCatalogProductRequestSchema.parse({
        code: 'WATCH_NEW_SERIES',
        name: '新款腕表',
        category: 'SMART_WATCH',
      }),
    ).toMatchObject({ status: 'INACTIVE' });
    expect(
      createCatalogProductRequestSchema.safeParse({ code: 'watch-new', name: 'x' }).success,
    ).toBe(false);
    expect(inventoryQuerySchema.parse({})).toEqual({ warehouse: 'ALL' });
    expect(inventoryQuerySchema.safeParse({ warehouse: 'UNKNOWN' }).success).toBe(false);
  });

  it('decodes inventory projections and shared API errors', () => {
    const quantity = {
      confirmedFeishuQuantity: 5,
      pendingMovementDelta: -1,
      effectiveOnHandQuantity: 4,
      reservedQuantity: 2,
      availableQuantity: 2,
      syncIndicator: 'PENDING_LOCAL_CHANGES',
    } as const;
    expect(
      inventoryQueryResponseSchema.parse({
        warehouse: 'ALL',
        category: 'SMART_WATCH',
        warehouses: [{ code: 'YUHANG', name: '余杭仓' }],
        products: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            code: 'WATCH_HEALTH',
            name: '健康腕表',
            category: 'SMART_WATCH',
            status: 'ACTIVE',
            imageReady: false,
            mainImage: null,
            variants: [
              {
                id: '22222222-2222-4222-8222-222222222222',
                code: 'DEFAULT',
                displayName: '健康腕表',
                size: null,
                isActive: true,
                warehouses: [{ warehouse: 'YUHANG', ...quantity }],
                total: quantity,
              },
            ],
          },
        ],
      }).products[0]?.variants[0]?.total.availableQuantity,
    ).toBe(2);
    expect(
      apiErrorResponseSchema.parse({
        code: 'IMAGE_UNAVAILABLE',
        message: 'Image is unavailable.',
        traceId: '33333333-3333-4333-8333-333333333333',
      }).code,
    ).toBe('IMAGE_UNAVAILABLE');
  });

  it('rejects invalid warehouse administrator access profiles', () => {
    expect(
      updateAccessRequestSchema.safeParse({
        roles: ['CLAIMANT', 'WAREHOUSE_ADMIN'],
        warehouses: [],
      }).success,
    ).toBe(false);
    expect(
      updateAccessRequestSchema.safeParse({
        roles: ['CLAIMANT', 'WAREHOUSE_ADMIN'],
        warehouses: ['XIHU'],
      }).success,
    ).toBe(true);
  });
});
