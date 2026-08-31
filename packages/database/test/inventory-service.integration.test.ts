import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  createDatabaseClient,
  InsufficientInventoryError,
  InventoryService,
} from '../src/index.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';

const databaseUrl = process.env['DATABASE_URL'];
const integrationEnabled = databaseUrl !== undefined && databaseUrl.length > 0;

describe.skipIf(!integrationEnabled)('InventoryService PostgreSQL integration', () => {
  let database: PrismaClient;
  let inventory: InventoryService;
  let warehouseId: string;
  let variantId: string;

  beforeAll(async () => {
    database = createDatabaseClient();
    inventory = new InventoryService(database);
    const warehouse = await database.warehouse.findUniqueOrThrow({ where: { code: 'YUHANG' } });
    const variant = await database.productVariant.findFirstOrThrow({
      where: { product: { code: 'RING_YEARS_TRIBUTE_ROSE_GOLD' }, size: '6#' },
    });
    warehouseId = warehouse.id;
    variantId = variant.id;
    await database.inventoryBalance.update({
      where: { warehouseId_variantId: { warehouseId, variantId } },
      data: {
        confirmedFeishuQuantity: 10,
        pendingMovementDelta: 0,
        reservedQuantity: 0,
        version: 0,
      },
    });
  });

  afterAll(async () => {
    await database.inventoryBalance.update({
      where: { warehouseId_variantId: { warehouseId, variantId } },
      data: { confirmedFeishuQuantity: 0, pendingMovementDelta: 0, reservedQuantity: 0 },
    });
    await database.$disconnect();
  });

  it('prevents concurrent overselling with stable row locks', async () => {
    const results = await Promise.allSettled([
      inventory.applyMovementBatch(
        {
          businessNumber: `IT-ISSUE-A-${Date.now()}`,
          source: 'ONLINE',
          lines: [{ warehouseId, variantId, quantityDelta: -7, type: 'ISSUE' }],
        },
        `it-issue-a-${Date.now()}`,
      ),
      inventory.applyMovementBatch(
        {
          businessNumber: `IT-ISSUE-B-${Date.now()}`,
          source: 'ONLINE',
          lines: [{ warehouseId, variantId, quantityDelta: -7, type: 'ISSUE' }],
        },
        `it-issue-b-${Date.now()}`,
      ),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(
      InsufficientInventoryError,
    );
  });

  it('rolls back every line when one line is insufficient', async () => {
    const secondVariant = await database.productVariant.findFirstOrThrow({
      where: { product: { code: 'RING_YEARS_TRIBUTE_ROSE_GOLD' }, size: '7#' },
    });
    await database.inventoryBalance.update({
      where: { warehouseId_variantId: { warehouseId, variantId } },
      data: { confirmedFeishuQuantity: 10, pendingMovementDelta: 0, reservedQuantity: 0 },
    });
    await database.inventoryBalance.update({
      where: { warehouseId_variantId: { warehouseId, variantId: secondVariant.id } },
      data: { confirmedFeishuQuantity: 0, pendingMovementDelta: 0, reservedQuantity: 0 },
    });

    const businessNumber = `IT-ROLLBACK-${Date.now()}`;
    const idempotencyKey = `it-rollback-${Date.now()}`;
    await expect(
      inventory.applyMovementBatch(
        {
          businessNumber,
          source: 'ONLINE',
          lines: [
            { warehouseId, variantId, quantityDelta: -3, type: 'ISSUE' },
            { warehouseId, variantId: secondVariant.id, quantityDelta: -1, type: 'ISSUE' },
          ],
        },
        idempotencyKey,
      ),
    ).rejects.toBeInstanceOf(InsufficientInventoryError);

    expect(await database.inventoryMovement.count({ where: { businessNumber } })).toBe(0);
    const balances = await database.inventoryBalance.findMany({
      where: { warehouseId, variantId: { in: [variantId, secondVariant.id] } },
    });
    expect(
      balances.map((balance) => [
        balance.variantId,
        balance.confirmedFeishuQuantity,
        balance.pendingMovementDelta,
        balance.reservedQuantity,
      ]),
    ).toEqual(
      expect.arrayContaining([
        [variantId, 10, 0, 0],
        [secondVariant.id, 0, 0, 0],
      ]),
    );
  });

  it('allows only one concurrent release of a reservation batch', async () => {
    await database.inventoryBalance.update({
      where: { warehouseId_variantId: { warehouseId, variantId } },
      data: { confirmedFeishuQuantity: 10, pendingMovementDelta: 0, reservedQuantity: 0 },
    });
    const reserveKey = `it-release-reserve-${Date.now()}`;
    const reservation = await inventory.reserveBatch(
      { lines: [{ warehouseId, variantId, quantity: 4 }] },
      reserveKey,
    );
    const results = await Promise.allSettled([
      inventory.releaseReservation({ batchId: reservation.batchId }, `it-release-a-${Date.now()}`),
      inventory.releaseReservation({ batchId: reservation.batchId }, `it-release-b-${Date.now()}`),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const balance = await database.inventoryBalance.findUniqueOrThrow({
      where: { warehouseId_variantId: { warehouseId, variantId } },
    });
    expect(balance.reservedQuantity).toBe(0);
    expect(
      await database.inventoryReservation.count({
        where: { batchId: reservation.batchId, status: 'RELEASED' },
      }),
    ).toBe(1);
  });

  it('returns the same response and creates one movement on idempotent retry', async () => {
    const key = `it-idempotent-${Date.now()}`;
    const command = {
      businessNumber: `IT-IDEMPOTENT-${Date.now()}`,
      source: 'ONLINE' as const,
      lines: [{ warehouseId, variantId, quantityDelta: 1, type: 'INBOUND' as const }],
    };
    const [first, second] = await Promise.all([
      inventory.applyMovementBatch(command, key),
      inventory.applyMovementBatch(command, key),
    ]);

    expect(second).toEqual(first);
    expect(
      await database.inventoryMovement.count({
        where: { deduplicationKey: { startsWith: `${key}:` } },
      }),
    ).toBe(1);
  });

  it('applies transfers atomically and conserves quantity', async () => {
    const xihu = await database.warehouse.findUniqueOrThrow({ where: { code: 'XIHU' } });
    await database.inventoryBalance.update({
      where: { warehouseId_variantId: { warehouseId: xihu.id, variantId } },
      data: { confirmedFeishuQuantity: 0, pendingMovementDelta: 0, reservedQuantity: 0 },
    });
    const before = await database.inventoryBalance.findMany({
      where: { variantId, warehouseId: { in: [warehouseId, xihu.id] } },
      orderBy: { warehouseId: 'asc' },
    });
    const result = await inventory.transferBatch(
      {
        businessNumber: `IT-TRANSFER-${Date.now()}`,
        source: 'OFFLINE',
        fromWarehouseId: warehouseId,
        toWarehouseId: xihu.id,
        lines: [{ variantId, quantity: 3 }],
      },
      `it-transfer-${Date.now()}`,
    );

    expect(result.movementIds).toHaveLength(2);
    const after = await database.inventoryBalance.findMany({
      where: { variantId, warehouseId: { in: [warehouseId, xihu.id] } },
    });
    const beforeTotal = before.reduce(
      (sum, balance) => sum + balance.confirmedFeishuQuantity + balance.pendingMovementDelta,
      0,
    );
    const afterTotal = after.reduce(
      (sum, balance) => sum + balance.confirmedFeishuQuantity + balance.pendingMovementDelta,
      0,
    );
    expect(afterTotal).toBe(beforeTotal);
  });
});
