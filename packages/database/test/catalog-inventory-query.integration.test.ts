import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CatalogDomainError,
  CatalogService,
  createDatabaseClient,
  InventoryQueryService,
} from '../src/index.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';

const databaseUrl = process.env['DATABASE_URL'];
const integrationEnabled = databaseUrl !== undefined && databaseUrl.length > 0;
const ringCode = 'RING_CATALOG_INTEGRATION_TEST';
const watchCode = 'WATCH_CATALOG_INTEGRATION_TEST';

describe.skipIf(!integrationEnabled)('catalog and inventory query PostgreSQL integration', () => {
  let database: PrismaClient;
  let catalog: CatalogService;
  let inventory: InventoryQueryService;

  const clean = async (): Promise<void> => {
    const productIds = (
      await database.product.findMany({
        where: { code: { in: [ringCode, watchCode] } },
        select: { id: true },
      })
    ).map((product) => product.id);
    if (productIds.length === 0) return;
    await database.productImageRef.deleteMany({ where: { productId: { in: productIds } } });
    await database.inventoryBalance.deleteMany({
      where: { variant: { productId: { in: productIds } } },
    });
    await database.productVariant.deleteMany({ where: { productId: { in: productIds } } });
    await database.product.deleteMany({ where: { id: { in: productIds } } });
  };

  beforeAll(async () => {
    database = createDatabaseClient();
    catalog = new CatalogService(database);
    inventory = new InventoryQueryService(database);
    await clean();
  });

  afterAll(async () => {
    await clean();
    await database.$disconnect();
  });

  it('creates eight ordered ring sizes and one size-free watch variant', async () => {
    const ring = await catalog.createProduct({
      code: ringCode,
      name: '集成测试指环',
      category: 'SMART_RING',
      status: 'INACTIVE',
    });
    const watch = await catalog.createProduct({
      code: watchCode,
      name: '集成测试腕表',
      category: 'SMART_WATCH',
      status: 'INACTIVE',
    });

    expect(ring.product.variants.map((variant) => variant.size)).toEqual([
      '6#',
      '7#',
      '8#',
      '9#',
      '10#',
      '11#',
      '12#',
      '13#',
    ]);
    expect(ring.product.variants.every((variant) => !variant.isActive)).toBe(true);
    expect(watch.product.variants).toHaveLength(1);
    expect(watch.product.variants[0]).toMatchObject({
      code: 'DEFAULT',
      size: null,
      isActive: false,
    });
  });

  it('keeps missing-image products out of selectable catalog until explicit activation', async () => {
    const ring = await database.product.findUniqueOrThrow({ where: { code: ringCode } });
    await expect(catalog.updateProduct(ring.id, { status: 'ACTIVE' })).rejects.toBeInstanceOf(
      CatalogDomainError,
    );

    const watch = await database.product.findUniqueOrThrow({ where: { code: watchCode } });
    await database.productImageRef.create({
      data: {
        productId: watch.id,
        attachmentToken: 'integration-test-attachment-token',
        kind: 'MAIN',
        sortOrder: 0,
        fileName: 'watch-main.png',
      },
    });
    const activated = await catalog.updateProduct(watch.id, { status: 'ACTIVE' });
    expect(activated.product).toMatchObject({ status: 'ACTIVE', imageReady: true });
    expect(activated.product.mainImage?.url).toMatch(/^\/catalog\/images\//);

    const selectable = await catalog.listSelectableCatalog();
    expect(selectable.items.map((product) => product.code)).toContain(watchCode);
    expect(selectable.items.map((product) => product.code)).not.toContain(ringCode);
    expect(selectable.items.find((product) => product.code === watchCode)?.variants).toHaveLength(
      1,
    );
  });

  it('projects both warehouses, totals and pending sync state without hiding history', async () => {
    const watch = await database.product.findUniqueOrThrow({ where: { code: watchCode } });
    const variant = await database.productVariant.findFirstOrThrow({
      where: { productId: watch.id },
    });
    const warehouses = await database.warehouse.findMany({
      where: { code: { in: ['XIHU', 'YUHANG'] } },
      select: { id: true, code: true },
    });
    const warehouseId = new Map(warehouses.map((warehouse) => [warehouse.code, warehouse.id]));
    const xihuId = warehouseId.get('XIHU');
    const yuhangId = warehouseId.get('YUHANG');
    if (xihuId === undefined || yuhangId === undefined) {
      throw new Error('The seeded warehouses are required for this integration test.');
    }
    await database.inventoryBalance.update({
      where: { warehouseId_variantId: { warehouseId: xihuId, variantId: variant.id } },
      data: { confirmedFeishuQuantity: 10, pendingMovementDelta: -1, reservedQuantity: 3 },
    });
    await database.inventoryBalance.update({
      where: { warehouseId_variantId: { warehouseId: yuhangId, variantId: variant.id } },
      data: { confirmedFeishuQuantity: 4, pendingMovementDelta: 1, reservedQuantity: 1 },
    });

    const response = await inventory.query({ warehouse: 'ALL', category: 'SMART_WATCH' });
    const projected = response.products.find((product) => product.code === watchCode);
    expect(projected?.variants[0]?.warehouses).toEqual([
      {
        warehouse: 'XIHU',
        confirmedFeishuQuantity: 10,
        pendingMovementDelta: -1,
        effectiveOnHandQuantity: 9,
        reservedQuantity: 3,
        availableQuantity: 6,
        syncIndicator: 'PENDING_LOCAL_CHANGES',
      },
      {
        warehouse: 'YUHANG',
        confirmedFeishuQuantity: 4,
        pendingMovementDelta: 1,
        effectiveOnHandQuantity: 5,
        reservedQuantity: 1,
        availableQuantity: 4,
        syncIndicator: 'PENDING_LOCAL_CHANGES',
      },
    ]);
    expect(projected?.variants[0]?.total).toEqual({
      confirmedFeishuQuantity: 14,
      pendingMovementDelta: 0,
      effectiveOnHandQuantity: 14,
      reservedQuantity: 4,
      availableQuantity: 10,
      syncIndicator: 'PENDING_LOCAL_CHANGES',
    });
    expect(
      response.products.filter((product) => product.status === 'INACTIVE_HISTORICAL'),
    ).toHaveLength(3);

    const xihuOnly = await inventory.query({ warehouse: 'XIHU', category: 'SMART_WATCH' });
    const xihuProduct = xihuOnly.products.find((product) => product.code === watchCode);
    expect(xihuProduct?.variants[0]?.warehouses).toHaveLength(1);
    expect(xihuProduct?.variants[0]?.total.availableQuantity).toBe(6);
  });
});
