import { describe, expect, it } from 'vitest';
import { ApiClientError } from './shared/api-client.js';
import { createCatalogApi } from './catalog/catalog-api.js';
import { createInventoryApi } from './inventory/inventory-api.js';
import { createWarehousesApi } from './warehouse-entry/warehouses-api.js';

describe('warehouse feature API adapters', () => {
  it('sends inventory filters with credentials and decodes the shared response', async () => {
    let requestedUrl = '';
    let credentials: RequestCredentials | undefined;
    const api = createInventoryApi({
      baseUrl: 'http://localhost:3000',
      fetchFunction: async (input, init) => {
        requestedUrl = input.toString();
        credentials = init?.credentials;
        return new Response(
          JSON.stringify({
            warehouse: 'YUHANG',
            category: 'SMART_RING',
            warehouses: [{ code: 'YUHANG', name: '余杭仓' }],
            products: [],
          }),
          { status: 200 },
        );
      },
    });

    await expect(api.query({ warehouse: 'YUHANG', category: 'SMART_RING' })).resolves.toMatchObject(
      { warehouse: 'YUHANG', products: [] },
    );
    expect(requestedUrl).toBe(
      'http://localhost:3000/inventory?warehouse=YUHANG&category=SMART_RING',
    );
    expect(credentials).toBe('include');
  });

  it('uses the shared catalog error payload for mutation failures', async () => {
    const api = createCatalogApi({
      baseUrl: 'http://localhost:3000',
      fetchFunction: async () =>
        new Response(
          JSON.stringify({
            code: 'PRODUCT_IMAGE_REQUIRED',
            message: 'A main image is required before activation.',
            traceId: '11111111-1111-4111-8111-111111111111',
          }),
          { status: 409 },
        ),
    });

    await expect(
      api.update('22222222-2222-4222-8222-222222222222', { status: 'ACTIVE' }),
    ).rejects.toBeInstanceOf(ApiClientError);
    await expect(
      api.update('22222222-2222-4222-8222-222222222222', { status: 'ACTIVE' }),
    ).rejects.toMatchObject({ code: 'PRODUCT_IMAGE_REQUIRED' });
  });

  it('builds authenticated warehouse entry and QR endpoints from shared paths', async () => {
    const api = createWarehousesApi({
      baseUrl: 'http://localhost:3000',
      fetchFunction: async () =>
        new Response(
          JSON.stringify({
            productionReady: false,
            items: [
              {
                code: 'XIHU',
                name: '西湖仓',
                applyPath: '/w/XIHU/apply',
                publicUrl: 'http://localhost:5173/w/XIHU/apply',
                qrCodeUrl: '/warehouses/XIHU/qr.svg',
              },
            ],
          }),
          { status: 200 },
        ),
    });

    await expect(api.listEntries()).resolves.toMatchObject({ productionReady: false });
    expect(api.qrDownloadUrl('/warehouses/XIHU/qr.svg')).toBe(
      'http://localhost:3000/warehouses/XIHU/qr.svg',
    );
  });
});
