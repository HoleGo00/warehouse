import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AdminTaskService,
  createDatabaseClient,
  InventoryOperationsService,
  ReturnReminderService,
  ReturnService,
  WorkCalendarAdminService,
} from '../src/index.js';
import type { PrismaClient, User } from '../src/generated/prisma/client.js';
import type { SessionPrincipal } from '../src/auth/types.js';

const databaseUrl = process.env['DATABASE_URL'];
const integrationEnabled = databaseUrl !== undefined && databaseUrl.length > 0;
const runId = `inventory-operations-it-${Date.now()}`;

describe.skipIf(!integrationEnabled)('Inventory operations PostgreSQL integration', () => {
  let database: PrismaClient;
  let operations: InventoryOperationsService;
  let returns: ReturnService;
  let reminders: ReturnReminderService;
  let tasks: AdminTaskService;
  let calendar: WorkCalendarAdminService;
  let yuhangId: string;
  let xihuId: string;
  let firstVariantId: string;
  let secondVariantId: string;
  let claimantUser: User;
  let adminUser: User;
  let systemUser: User;
  let claimant: SessionPrincipal;
  let admin: SessionPrincipal;
  let xihuAdmin: SessionPrincipal;
  let systemAdmin: SessionPrincipal;

  const principal = (
    user: User,
    roles: SessionPrincipal['roles'],
    warehouses: SessionPrincipal['warehouses'] = [],
  ): SessionPrincipal => ({
    sessionId: `${user.id}-session`,
    userId: user.id,
    feishuUserId: user.feishuUserId ?? user.id,
    name: user.name,
    avatarUrl: null,
    roles,
    warehouses,
    expiresAt: new Date(Date.now() + 60_000),
  });

  const cleanup = async (): Promise<void> => {
    const requests = await database.request.findMany({
      where: { claimantId: claimantUser.id },
      select: { id: true },
    });
    const requestIds = requests.map((request) => request.id);
    const operationRecords = await database.inventoryOperation.findMany({
      where: { actorUserId: { in: [adminUser.id, systemUser.id] } },
      select: { id: true },
    });
    const operationIds = operationRecords.map((operation) => operation.id);
    await database.$transaction(async (transaction) => {
      await transaction.adminTask.deleteMany({ where: { requestId: { in: requestIds } } });
      await transaction.returnRecord.deleteMany({
        where: { obligation: { requestId: { in: requestIds } } },
      });
      await transaction.returnObligation.deleteMany({ where: { requestId: { in: requestIds } } });
      await transaction.inventoryMovement.deleteMany({
        where: {
          OR: [
            { requestId: { in: requestIds } },
            { operationId: { in: operationIds } },
            { actorUserId: { in: [adminUser.id, systemUser.id] } },
          ],
        },
      });
      await transaction.inventoryOperationLine.deleteMany({
        where: { operationId: { in: operationIds } },
      });
      await transaction.inventoryOperation.deleteMany({ where: { id: { in: operationIds } } });
      await transaction.requestItem.deleteMany({ where: { requestId: { in: requestIds } } });
      await transaction.request.deleteMany({ where: { id: { in: requestIds } } });
      const jobs = await transaction.outboxJob.findMany({
        where: { idempotencyKey: { startsWith: runId } },
        select: { id: true },
      });
      await transaction.outboxJobStep.deleteMany({
        where: { jobId: { in: jobs.map((job) => job.id) } },
      });
      await transaction.outboxJob.deleteMany({ where: { id: { in: jobs.map((job) => job.id) } } });
      await transaction.idempotencyKey.deleteMany({ where: { key: { startsWith: runId } } });
      await transaction.auditLog.deleteMany({
        where: { actorUserId: { in: [adminUser.id, systemUser.id] } },
      });
      await transaction.workCalendarDay.deleteMany({
        where: { date: { in: [new Date('2027-01-01T00:00:00.000Z')] } },
      });
    });
  };

  beforeAll(async () => {
    database = createDatabaseClient();
    operations = new InventoryOperationsService(database);
    returns = new ReturnService(database);
    reminders = new ReturnReminderService(database);
    tasks = new AdminTaskService(database);
    calendar = new WorkCalendarAdminService(database);
    const [yuhang, xihu, firstVariant, secondVariant, claimantRole, adminRole, systemRole] =
      await Promise.all([
        database.warehouse.findUniqueOrThrow({ where: { code: 'YUHANG' } }),
        database.warehouse.findUniqueOrThrow({ where: { code: 'XIHU' } }),
        database.productVariant.findFirstOrThrow({
          where: { product: { code: 'RING_YEARS_TRIBUTE_ROSE_GOLD' }, size: '6#' },
        }),
        database.productVariant.findFirstOrThrow({
          where: { product: { code: 'WATCH_HEALTH' }, code: 'DEFAULT' },
        }),
        database.role.findUniqueOrThrow({ where: { code: 'CLAIMANT' } }),
        database.role.findUniqueOrThrow({ where: { code: 'WAREHOUSE_ADMIN' } }),
        database.role.findUniqueOrThrow({ where: { code: 'SYSTEM_ADMIN' } }),
      ]);
    [claimantUser, adminUser, systemUser] = await Promise.all([
      database.user.create({
        data: {
          tenantKey: runId,
          feishuUserId: `${runId}-claimant`,
          name: '库存操作测试领用人',
          userRoles: { create: { roleId: claimantRole.id } },
        },
      }),
      database.user.create({
        data: {
          tenantKey: runId,
          feishuUserId: `${runId}-admin`,
          name: '库存操作测试仓管',
          userRoles: { create: [{ roleId: claimantRole.id }, { roleId: adminRole.id }] },
        },
      }),
      database.user.create({
        data: {
          tenantKey: runId,
          feishuUserId: `${runId}-system`,
          name: '库存操作测试系统管理员',
          userRoles: { create: [{ roleId: claimantRole.id }, { roleId: systemRole.id }] },
        },
      }),
    ]);
    yuhangId = yuhang.id;
    xihuId = xihu.id;
    firstVariantId = firstVariant.id;
    secondVariantId = secondVariant.id;
    claimant = principal(claimantUser, ['CLAIMANT']);
    admin = principal(adminUser, ['CLAIMANT', 'WAREHOUSE_ADMIN'], ['YUHANG']);
    xihuAdmin = principal(adminUser, ['CLAIMANT', 'WAREHOUSE_ADMIN'], ['XIHU']);
    systemAdmin = principal(systemUser, ['CLAIMANT', 'SYSTEM_ADMIN'], ['XIHU', 'YUHANG']);
  });

  beforeEach(async () => {
    await cleanup();
    await database.inventoryBalance.updateMany({
      where: {
        warehouseId: { in: [yuhangId, xihuId] },
        variantId: { in: [firstVariantId, secondVariantId] },
      },
      data: {
        confirmedFeishuQuantity: 10,
        pendingMovementDelta: 0,
        reservedQuantity: 0,
        lastMovementId: null,
      },
    });
  });

  afterAll(async () => {
    await cleanup();
    await database.user.deleteMany({
      where: { id: { in: [claimantUser.id, adminUser.id, systemUser.id] } },
    });
    await database.$disconnect();
  });

  it('records multi-line inbound atomically and reuses the idempotent result', async () => {
    const key = `${runId}-inbound`;
    const command = {
      warehouse: 'YUHANG' as const,
      inboundType: 'PURCHASE' as const,
      occurredAt: '2026-09-04T08:00:00.000Z',
      reason: '供应商采购到货',
      lines: [
        { variantId: firstVariantId, quantity: 3 },
        { variantId: secondVariantId, quantity: 2 },
      ],
    };
    const first = await operations.createInbound(command, key, admin);
    const second = await operations.createInbound(command, key, admin);
    expect(second).toEqual(first);
    expect(first.operation.movementIds).toHaveLength(2);
    expect(await database.inventoryOperation.count({ where: { id: first.operation.id } })).toBe(1);
    expect(await database.outboxJob.count({ where: { idempotencyKey: `${key}:outbox` } })).toBe(1);
    await expect(
      operations.createInbound({ ...command, reason: '不同原因' }, key, admin),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('requires both warehouse scopes and conserves transfer quantity', async () => {
    const command = {
      sourceWarehouse: 'YUHANG' as const,
      destinationWarehouse: 'XIHU' as const,
      occurredAt: '2026-09-04T08:00:00.000Z',
      reason: '西湖仓补货',
      lines: [{ variantId: firstVariantId, quantity: 4 }],
    };
    await expect(
      Promise.resolve().then(() =>
        operations.createTransfer(command, `${runId}-transfer-denied`, admin),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_WAREHOUSE' });
    const before = await database.inventoryBalance.findMany({
      where: { variantId: firstVariantId, warehouseId: { in: [yuhangId, xihuId] } },
    });
    const result = await operations.createTransfer(command, `${runId}-transfer`, systemAdmin);
    const after = await database.inventoryBalance.findMany({
      where: { variantId: firstVariantId, warehouseId: { in: [yuhangId, xihuId] } },
    });
    expect(result.operation.movementIds).toHaveLength(2);
    expect(
      after.reduce(
        (sum, item) => sum + item.confirmedFeishuQuantity + item.pendingMovementDelta,
        0,
      ),
    ).toBe(
      before.reduce(
        (sum, item) => sum + item.confirmedFeishuQuantity + item.pendingMovementDelta,
        0,
      ),
    );
  });

  it('stores zero-difference stocktakes without a zero movement and protects reservations', async () => {
    const zero = await operations.createStocktake(
      {
        warehouse: 'YUHANG',
        occurredAt: '2026-09-04T08:00:00.000Z',
        reason: '月度盘点',
        lines: [{ variantId: firstVariantId, countedQuantity: 10 }],
      },
      `${runId}-stocktake-zero`,
      admin,
    );
    expect(zero.operation.movementIds).toEqual([]);
    expect(zero.operation.outboxJobId).toBeNull();
    const gain = await operations.createStocktake(
      {
        warehouse: 'YUHANG',
        occurredAt: '2026-09-04T08:30:00.000Z',
        reason: '盘盈复核',
        lines: [{ variantId: firstVariantId, countedQuantity: 12 }],
      },
      `${runId}-stocktake-gain`,
      admin,
    );
    expect(gain.operation.lines[0]).toMatchObject({ difference: 2, adjustedQuantity: 12 });
    expect(
      await database.inventoryMovement.findUniqueOrThrow({
        where: { id: gain.operation.movementIds[0] },
      }),
    ).toMatchObject({ type: 'STOCKTAKE_GAIN', quantityDelta: 2 });
    const loss = await operations.createStocktake(
      {
        warehouse: 'YUHANG',
        occurredAt: '2026-09-04T08:45:00.000Z',
        reason: '盘亏复核',
        lines: [{ variantId: firstVariantId, countedQuantity: 10 }],
      },
      `${runId}-stocktake-loss`,
      admin,
    );
    expect(loss.operation.lines[0]).toMatchObject({ difference: -2, adjustedQuantity: 10 });
    expect(
      await database.inventoryMovement.findUniqueOrThrow({
        where: { id: loss.operation.movementIds[0] },
      }),
    ).toMatchObject({ type: 'STOCKTAKE_LOSS', quantityDelta: -2 });
    await database.inventoryBalance.update({
      where: { warehouseId_variantId: { warehouseId: yuhangId, variantId: firstVariantId } },
      data: { reservedQuantity: 8 },
    });
    await expect(
      operations.createStocktake(
        {
          warehouse: 'YUHANG',
          occurredAt: '2026-09-04T08:00:00.000Z',
          reason: '复核盘点',
          lines: [{ variantId: firstVariantId, countedQuantity: 7 }],
        },
        `${runId}-stocktake-reserved`,
        admin,
      ),
    ).rejects.toMatchObject({ code: 'STOCKTAKE_RESERVATION_CONFLICT' });
  });

  it('returns physical stock in partial batches and completes the open task', async () => {
    const request = await database.request.create({
      data: {
        requestNumber: `${runId}-request-return`,
        warehouseId: yuhangId,
        claimantId: claimant.userId,
        origin: 'ONLINE',
        type: 'INTERNAL',
        purposeObject: '展陈测试',
        finalDestination: '测试部门',
        returnMode: 'BY_DATE',
        expectedReturnDate: new Date('2026-09-04T00:00:00.000Z'),
        status: 'COMPLETED',
        submittedAt: new Date('2026-09-01T00:00:00.000Z'),
        completedAt: new Date('2026-09-01T00:00:00.000Z'),
        items: {
          create: {
            productId: (
              await database.productVariant.findUniqueOrThrow({ where: { id: firstVariantId } })
            ).productId,
            variantId: firstVariantId,
            productNameSnapshot: '岁月礼赞·磨砂玫瑰金',
            sizeSnapshot: '6#',
            quantity: 5,
          },
        },
        returnObligations: {
          create: {
            variantId: firstVariantId,
            trigger: 'DATE',
            dueDate: new Date('2026-09-04T00:00:00.000Z'),
            requiredQuantity: 5,
          },
        },
      },
      include: { returnObligations: true },
    });
    const obligation = request.returnObligations[0];
    if (obligation === undefined) throw new Error('Return obligation fixture missing.');
    await database.adminTask.create({
      data: {
        deduplicationKey: `return:${request.id}`,
        type: 'RETURN_DUE',
        severity: 'WARNING',
        requestId: request.id,
        warehouseId: yuhangId,
        title: '到期待归还',
      },
    });
    await expect(
      returns.confirm(
        {
          requestId: request.id,
          warehouse: 'XIHU',
          occurredAt: '2026-09-04T08:30:00.000Z',
          lines: [{ obligationId: obligation.id, quantity: 1 }],
        },
        `${runId}-return-source-denied`,
        xihuAdmin,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_WAREHOUSE' });
    const partial = await returns.confirm(
      {
        requestId: request.id,
        warehouse: 'YUHANG',
        occurredAt: '2026-09-04T09:00:00.000Z',
        lines: [{ obligationId: obligation.id, quantity: 2 }],
      },
      `${runId}-return-partial`,
      admin,
    );
    expect(partial.request.returnObligations[0]).toMatchObject({
      returnedQuantity: 2,
      remainingQuantity: 3,
      status: 'PARTIAL',
    });
    await expect(
      returns.confirm(
        {
          requestId: request.id,
          warehouse: 'YUHANG',
          occurredAt: '2026-09-04T09:30:00.000Z',
          lines: [{ obligationId: obligation.id, quantity: 4 }],
        },
        `${runId}-return-over`,
        admin,
      ),
    ).rejects.toMatchObject({ code: 'RETURN_QUANTITY_EXCEEDED' });
    const concurrent = await Promise.allSettled([
      returns.confirm(
        {
          requestId: request.id,
          warehouse: 'YUHANG',
          occurredAt: '2026-09-04T09:40:00.000Z',
          lines: [{ obligationId: obligation.id, quantity: 2 }],
        },
        `${runId}-return-concurrent-a`,
        admin,
      ),
      returns.confirm(
        {
          requestId: request.id,
          warehouse: 'YUHANG',
          occurredAt: '2026-09-04T09:41:00.000Z',
          lines: [{ obligationId: obligation.id, quantity: 2 }],
        },
        `${runId}-return-concurrent-b`,
        admin,
      ),
    ]);
    expect(concurrent.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === 'rejected')).toHaveLength(1);
    await returns.confirm(
      {
        requestId: request.id,
        warehouse: 'YUHANG',
        occurredAt: '2026-09-04T10:00:00.000Z',
        lines: [{ obligationId: obligation.id, quantity: 1 }],
      },
      `${runId}-return-complete`,
      admin,
    );
    expect(
      await database.adminTask.findUniqueOrThrow({
        where: { deduplicationKey: `return:${request.id}` },
      }),
    ).toMatchObject({ status: 'COMPLETED' });
    const returnMovements = await database.inventoryMovement.findMany({
      where: { requestId: request.id, type: 'RETURN' },
      orderBy: { occurredAt: 'asc' },
    });
    expect(returnMovements).toHaveLength(3);
    expect(new Set(returnMovements.map((movement) => movement.businessNumber)).size).toBe(3);
    await expect(
      returns.confirm(
        {
          requestId: request.id,
          warehouse: 'YUHANG',
          occurredAt: '2026-09-04T11:00:00.000Z',
          lines: [{ obligationId: obligation.id, quantity: 1 }],
        },
        `${runId}-return-closed`,
        admin,
      ),
    ).rejects.toMatchObject({ code: 'RETURN_STATE_CONFLICT' });
  });

  it('creates and upgrades due tasks idempotently without inventory changes', async () => {
    const request = await database.request.create({
      data: {
        requestNumber: `${runId}-request-reminder`,
        warehouseId: yuhangId,
        claimantId: claimant.userId,
        origin: 'ONLINE',
        type: 'INTERNAL',
        purposeObject: '提醒测试',
        finalDestination: '测试部门',
        returnMode: 'BY_DATE',
        expectedReturnDate: new Date('2026-09-04T00:00:00.000Z'),
        status: 'COMPLETED',
        submittedAt: new Date('2026-09-01T00:00:00.000Z'),
        returnObligations: {
          create: {
            variantId: secondVariantId,
            trigger: 'DATE',
            dueDate: new Date('2026-09-04T00:00:00.000Z'),
            requiredQuantity: 1,
          },
        },
      },
    });
    const movementCount = await database.inventoryMovement.count();
    expect(await reminders.scanDueReturns(new Date('2026-09-04T08:00:00.000Z'))).toEqual({
      created: 1,
      upgraded: 0,
    });
    expect(await reminders.scanDueReturns(new Date('2026-09-04T09:00:00.000Z'))).toEqual({
      created: 0,
      upgraded: 0,
    });
    expect(await reminders.scanDueReturns(new Date('2026-09-05T08:00:00.000Z'))).toEqual({
      created: 0,
      upgraded: 1,
    });
    expect(await database.inventoryMovement.count()).toBe(movementCount);
    expect(await tasks.list({ status: 'OPEN' }, admin)).toMatchObject({
      items: [expect.objectContaining({ requestId: request.id, type: 'RETURN_OVERDUE' })],
    });
    await expect(tasks.list({ status: 'OPEN' }, claimant)).rejects.toMatchObject({
      code: 'FORBIDDEN_ROLE',
    });
    await expect(returns.list({}, claimant)).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
  });

  it('does not leave an open due task when scanning races the final physical return', async () => {
    const request = await database.request.create({
      data: {
        requestNumber: `${runId}-request-scan-return-race`,
        warehouseId: yuhangId,
        claimantId: claimant.userId,
        origin: 'ONLINE',
        type: 'INTERNAL',
        purposeObject: '扫描竞争测试',
        finalDestination: '测试部门',
        returnMode: 'BY_DATE',
        status: 'COMPLETED',
        submittedAt: new Date('2026-09-01T00:00:00.000Z'),
        items: {
          create: {
            productId: (
              await database.productVariant.findUniqueOrThrow({ where: { id: firstVariantId } })
            ).productId,
            variantId: firstVariantId,
            productNameSnapshot: '岁月礼赞·磨砂玫瑰金',
            sizeSnapshot: '6#',
            quantity: 1,
          },
        },
        returnObligations: {
          create: {
            variantId: firstVariantId,
            trigger: 'DATE',
            dueDate: new Date('2026-09-04T00:00:00.000Z'),
            requiredQuantity: 1,
          },
        },
      },
      include: { returnObligations: true },
    });
    const obligation = request.returnObligations[0];
    if (obligation === undefined) throw new Error('Return obligation fixture missing.');
    await Promise.all([
      reminders.scanDueReturns(new Date('2026-09-04T08:00:00.000Z')),
      returns.confirm(
        {
          requestId: request.id,
          warehouse: 'YUHANG',
          occurredAt: '2026-09-04T08:00:00.000Z',
          lines: [{ obligationId: obligation.id, quantity: 1 }],
        },
        `${runId}-scan-return-race`,
        admin,
      ),
    ]);
    expect(
      await database.adminTask.count({
        where: {
          requestId: request.id,
          status: 'OPEN',
          type: { in: ['RETURN_DUE', 'RETURN_OVERDUE'] },
        },
      }),
    ).toBe(0);
  });

  it('creates departure return tasks idempotently without returning inventory', async () => {
    const request = await database.request.create({
      data: {
        requestNumber: `${runId}-request-departure`,
        warehouseId: yuhangId,
        claimantId: claimant.userId,
        origin: 'ONLINE',
        type: 'INTERNAL',
        purposeObject: '离职归还测试',
        finalDestination: '测试部门',
        returnMode: 'ON_DEPARTURE',
        status: 'COMPLETED',
        submittedAt: new Date('2026-09-01T00:00:00.000Z'),
        returnObligations: {
          create: {
            variantId: firstVariantId,
            trigger: 'DEPARTURE',
            requiredQuantity: 1,
          },
        },
      },
    });
    const movementCount = await database.inventoryMovement.count();
    const command = { claimantId: claimant.userId, reason: '人工确认员工已离职' };
    const first = await reminders.triggerDeparture(
      command,
      `${runId}-departure-trigger`,
      systemAdmin,
    );
    const retry = await reminders.triggerDeparture(
      command,
      `${runId}-departure-trigger`,
      systemAdmin,
    );
    expect(first).toEqual({ created: 1 });
    expect(retry).toEqual(first);
    expect(
      await database.adminTask.count({
        where: { deduplicationKey: `departure:${claimant.userId}:${request.id}` },
      }),
    ).toBe(1);
    expect(await database.inventoryMovement.count()).toBe(movementCount);
  });

  it('audits work calendar overrides and restores the default when deleted', async () => {
    const record = await calendar.upsert(
      '2027-01-01',
      { isWorkingDay: false, description: '元旦' },
      `${runId}-calendar-upsert`,
      systemAdmin,
    );
    expect(record).toEqual({ date: '2027-01-01', isWorkingDay: false, description: '元旦' });
    expect(await calendar.list({ from: '2027-01-01', to: '2027-01-02' })).toMatchObject({
      items: [record],
    });
    expect(
      await calendar.upsert(
        '2027-01-01',
        { isWorkingDay: true },
        `${runId}-calendar-clear-description`,
        systemAdmin,
      ),
    ).toEqual({ date: '2027-01-01', isWorkingDay: true, description: null });
    expect(await calendar.remove('2027-01-01', `${runId}-calendar-delete`, systemAdmin)).toEqual({
      deleted: true,
    });
  });
});
