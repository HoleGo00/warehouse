import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CreateOfflineRequest } from '@glorychips/contracts';
import {
  createDatabaseClient,
  RequestQueryService,
  TemporaryOfflineRequestService,
} from '../src/index.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import type { SessionPrincipal } from '../src/auth/types.js';

const databaseUrl = process.env['DATABASE_URL'];
const integrationEnabled = databaseUrl !== undefined && databaseUrl.length > 0;
const runId = `temporary-offline-it-${Date.now()}`;

describe.skipIf(!integrationEnabled)('Temporary/offline requests PostgreSQL integration', () => {
  let database: PrismaClient;
  let service: TemporaryOfflineRequestService;
  let queries: RequestQueryService;
  let claimant: SessionPrincipal;
  let offlineClaimant: SessionPrincipal;
  let admin: SessionPrincipal;
  let warehouseId: string;
  let ringVariantId: string;
  let watchVariantId: string;

  const principal = (
    user: { id: string; name: string; feishuUserId: string | null },
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

  const paperwork = {
    type: 'INTERNAL' as const,
    purposeObject: '集成测试现场健康活动',
    finalDestination: '集成测试市场部',
    returnMode: 'ON_DEPARTURE' as const,
  };

  const cleanupRequests = async (): Promise<void> => {
    const userIds = [claimant.userId, offlineClaimant.userId];
    const requests = await database.request.findMany({
      where: { claimantId: { in: userIds } },
      select: { id: true, requestNumber: true },
    });
    const requestIds = requests.map((request) => request.id);
    const requestNumbers = requests.map((request) => request.requestNumber);
    await database.$transaction(async (transaction) => {
      await transaction.adminTask.deleteMany({ where: { requestId: { in: requestIds } } });
      await transaction.returnObligation.deleteMany({ where: { requestId: { in: requestIds } } });
      await transaction.fulfillment.deleteMany({ where: { requestId: { in: requestIds } } });
      await transaction.approvalRecord.deleteMany({ where: { requestId: { in: requestIds } } });
      await transaction.inventoryMovement.deleteMany({ where: { requestId: { in: requestIds } } });
      await transaction.inventoryReservation.deleteMany({
        where: { requestId: { in: requestIds } },
      });
      await transaction.requestItem.deleteMany({ where: { requestId: { in: requestIds } } });
      await transaction.request.deleteMany({ where: { id: { in: requestIds } } });
      await transaction.auditLog.deleteMany({
        where: { actorUserId: { in: [claimant.userId, offlineClaimant.userId, admin.userId] } },
      });
      const jobs = await transaction.outboxJob.findMany({
        where: { aggregateId: { in: requestNumbers } },
        select: { id: true },
      });
      await transaction.outboxJobStep.deleteMany({
        where: { jobId: { in: jobs.map((job) => job.id) } },
      });
      await transaction.outboxJob.deleteMany({ where: { id: { in: jobs.map((job) => job.id) } } });
      await transaction.idempotencyKey.deleteMany({ where: { key: { startsWith: runId } } });
    });
  };

  beforeAll(async () => {
    database = createDatabaseClient();
    service = new TemporaryOfflineRequestService(database);
    queries = new RequestQueryService(database);
    const [warehouse, ring, watch, claimantRole, adminRole] = await Promise.all([
      database.warehouse.findUniqueOrThrow({ where: { code: 'YUHANG' } }),
      database.productVariant.findFirstOrThrow({
        where: { product: { code: 'RING_YEARS_TRIBUTE_ROSE_GOLD' }, size: '6#' },
      }),
      database.productVariant.findFirstOrThrow({
        where: { product: { code: 'WATCH_HEALTH' }, code: 'DEFAULT' },
      }),
      database.role.findUniqueOrThrow({ where: { code: 'CLAIMANT' } }),
      database.role.findUniqueOrThrow({ where: { code: 'WAREHOUSE_ADMIN' } }),
    ]);
    const [claimantUser, offlineClaimantUser, adminUser] = await Promise.all([
      database.user.create({
        data: {
          tenantKey: runId,
          feishuUserId: `${runId}-claimant`,
          name: '临时领用测试员工',
          userRoles: { create: { roleId: claimantRole.id } },
        },
      }),
      database.user.create({
        data: {
          tenantKey: runId,
          feishuUserId: `${runId}-offline-claimant`,
          name: '线下登记测试员工',
          userRoles: { create: { roleId: claimantRole.id } },
        },
      }),
      database.user.create({
        data: {
          tenantKey: runId,
          feishuUserId: `${runId}-admin`,
          name: '临时领用测试管理员',
          userRoles: {
            create: [{ roleId: claimantRole.id }, { roleId: adminRole.id }],
          },
        },
      }),
    ]);
    warehouseId = warehouse.id;
    ringVariantId = ring.id;
    watchVariantId = watch.id;
    claimant = principal(claimantUser, ['CLAIMANT']);
    offlineClaimant = principal(offlineClaimantUser, ['CLAIMANT']);
    admin = principal(adminUser, ['CLAIMANT', 'WAREHOUSE_ADMIN'], ['YUHANG']);
  });

  beforeEach(async () => {
    await cleanupRequests();
    await database.inventoryBalance.updateMany({
      where: { warehouseId, variantId: { in: [ringVariantId, watchVariantId] } },
      data: {
        confirmedFeishuQuantity: 30,
        pendingMovementDelta: 0,
        reservedQuantity: 0,
        lastMovementId: null,
      },
    });
  });

  afterAll(async () => {
    if (database === undefined) return;
    await cleanupRequests();
    await database.inventoryBalance.updateMany({
      where: { warehouseId, variantId: { in: [ringVariantId, watchVariantId] } },
      data: {
        confirmedFeishuQuantity: 0,
        pendingMovementDelta: 0,
        reservedQuantity: 0,
        lastMovementId: null,
      },
    });
    await database.user.deleteMany({
      where: { id: { in: [claimant.userId, offlineClaimant.userId, admin.userId] } },
    });
    await database.$disconnect();
  });

  it('issues the entire temporary request immediately and reuses the idempotent result', async () => {
    const key = `${runId}-temporary-create`;
    const command = {
      warehouse: 'YUHANG' as const,
      items: [
        { variantId: ringVariantId, quantity: 2 },
        { variantId: watchVariantId, quantity: 1 },
      ],
    };
    const first = await service.createTemporary(command, key, claimant);
    const second = await service.createTemporary(command, key, claimant);
    await expect(
      service.createTemporary(
        { warehouse: 'YUHANG', items: [{ variantId: ringVariantId, quantity: 3 }] },
        key,
        claimant,
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });

    expect(second).toEqual(first);
    expect(first.request).toMatchObject({
      origin: 'EXPRESS',
      type: null,
      status: 'PENDING_PAPERWORK',
      syncStatus: 'PENDING',
    });
    expect(first.request.paperworkDueAt).not.toBeNull();
    expect(await database.inventoryMovement.count({ where: { requestId: first.request.id } })).toBe(
      2,
    );
    expect(await database.fulfillment.count({ where: { requestId: first.request.id } })).toBe(1);
    expect(await database.adminTask.count({ where: { requestId: first.request.id } })).toBe(1);
    expect(
      await database.outboxJob.count({ where: { aggregateId: first.request.requestNumber } }),
    ).toBe(1);
    const balances = await database.inventoryBalance.findMany({
      where: { warehouseId, variantId: { in: [ringVariantId, watchVariantId] } },
    });
    expect(balances.map((balance) => balance.pendingMovementDelta).sort((a, b) => a - b)).toEqual([
      -2, -1,
    ]);
  });

  it('completes, rejects and corrects paperwork without a second inventory mutation', async () => {
    const created = await service.createTemporary(
      { warehouse: 'YUHANG', items: [{ variantId: ringVariantId, quantity: 2 }] },
      `${runId}-paperwork-create`,
      claimant,
    );
    const taskBefore = await database.adminTask.findFirstOrThrow({
      where: { requestId: created.request.id },
    });
    const duplicateTask = await database.adminTask.create({
      data: {
        type: 'PAPERWORK_REQUIRED',
        severity: 'WARNING',
        warehouseId,
        requestId: created.request.id,
        title: `重复待补手续 ${created.request.requestNumber}`,
        dueAt: taskBefore.dueAt,
      },
    });
    await expect(
      service.completePaperwork(
        created.request.id,
        paperwork,
        `${runId}-paperwork-duplicate-task`,
        claimant,
      ),
    ).rejects.toMatchObject({ code: 'REQUEST_STATE_CONFLICT' });
    await database.adminTask.delete({ where: { id: duplicateTask.id } });
    await expect(
      service.completePaperwork(
        created.request.id,
        paperwork,
        `${runId}-paperwork-forbidden`,
        offlineClaimant,
      ),
    ).rejects.toMatchObject({ code: 'REQUEST_FORBIDDEN' });
    await service.completePaperwork(
      created.request.id,
      paperwork,
      `${runId}-paperwork-submit`,
      claimant,
    );
    await expect(
      service.reviewTemporary(
        created.request.id,
        { decision: 'APPROVED', comment: '跨仓审核' },
        `${runId}-paperwork-cross-warehouse`,
        { ...admin, warehouses: ['XIHU'] },
      ),
    ).rejects.toMatchObject({ code: 'REQUEST_FORBIDDEN' });
    const rejected = await service.reviewTemporary(
      created.request.id,
      { decision: 'REJECTED', comment: '请补充对象范围' },
      `${runId}-paperwork-reject`,
      admin,
    );
    expect(rejected.request.status).toBe('REJECTED');
    expect(rejected.request.allowedActions.completePaperwork).toBe(false);
    expect(
      (await queries.getVisibleDetail(created.request.id, claimant)).request.allowedActions
        .completePaperwork,
    ).toBe(true);
    const reopened = await database.adminTask.findFirstOrThrow({
      where: { requestId: created.request.id },
    });
    expect(reopened.id).toBe(taskBefore.id);
    expect(reopened.dueAt).toEqual(taskBefore.dueAt);

    await service.completePaperwork(
      created.request.id,
      { ...paperwork, purposeObject: '补正后的对象范围' },
      `${runId}-paperwork-correct`,
      claimant,
    );
    const approved = await service.reviewTemporary(
      created.request.id,
      { decision: 'APPROVED', comment: '手续完整' },
      `${runId}-paperwork-approve`,
      admin,
    );
    expect(approved.request.status).toBe('COMPLETED');
    expect(approved.request.returnObligations).toHaveLength(1);
    expect(
      await database.inventoryMovement.count({ where: { requestId: created.request.id } }),
    ).toBe(1);
    expect(
      await database.outboxJob.count({ where: { aggregateId: created.request.requestNumber } }),
    ).toBe(1);
    expect(
      await database.inventoryReservation.count({ where: { requestId: created.request.id } }),
    ).toBe(0);
    expect(await database.fulfillment.count({ where: { requestId: created.request.id } })).toBe(1);
    const approvalAudit = await database.auditLog.findFirstOrThrow({
      where: {
        entityId: created.request.id,
        action: 'TEMPORARY_REQUEST_PAPERWORK_APPROVED',
      },
    });
    expect(approvalAudit.after).toMatchObject({
      claimantId: claimant.userId,
      dueAt: taskBefore.dueAt?.toISOString(),
    });
  });

  it('upgrades the original paperwork task to overdue and exposes it only to the warehouse queue', async () => {
    const created = await service.createTemporary(
      { warehouse: 'YUHANG', items: [{ variantId: ringVariantId, quantity: 1 }] },
      `${runId}-overdue-create`,
      claimant,
    );
    const dueAt = new Date('2026-09-01T15:59:59.999Z');
    const originalTask = await database.adminTask.findFirstOrThrow({
      where: { requestId: created.request.id },
    });
    const task = await database.adminTask.update({
      where: { id: originalTask.id },
      data: { dueAt },
    });

    const queue = await queries.listPaperworkQueue(
      { warehouse: 'YUHANG', state: 'OVERDUE' },
      admin,
    );
    expect(queue.items).toMatchObject([
      { id: created.request.id, paperworkOverdue: true, paperworkDueAt: dueAt.toISOString() },
    ]);
    const upgraded = await database.adminTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(upgraded).toMatchObject({ type: 'PAPERWORK_OVERDUE', severity: 'CRITICAL' });
    const overdueAudit = await database.auditLog.findFirstOrThrow({
      where: { entityId: created.request.id, action: 'TEMPORARY_REQUEST_PAPERWORK_OVERDUE' },
    });
    expect(overdueAudit.after).toMatchObject({
      claimantId: claimant.userId,
      dueAt: dueAt.toISOString(),
    });
    await expect(
      queries.listPaperworkQueue(
        { warehouse: 'YUHANG', state: 'OVERDUE' },
        { ...admin, warehouses: ['XIHU'] },
      ),
    ).rejects.toMatchObject({ code: 'REQUEST_FORBIDDEN' });
  });

  it('records a complete offline request with claimant and administrator identities', async () => {
    const command: CreateOfflineRequest = {
      warehouse: 'YUHANG',
      claimantId: offlineClaimant.userId,
      ...paperwork,
      items: [{ variantId: watchVariantId, quantity: 3 }],
    };
    const result = await service.createOffline(command, `${runId}-offline-create`, admin);
    expect(result.request).toMatchObject({
      origin: 'OFFLINE',
      status: 'COMPLETED',
      claimantId: offlineClaimant.userId,
    });
    expect(result.request.fulfillment?.executorId).toBe(admin.userId);
    expect(result.request.approvals).toHaveLength(0);
    expect(result.request.returnObligations).toHaveLength(1);
    expect(await queries.listMine(offlineClaimant)).toMatchObject({
      items: [{ id: result.request.id, origin: 'OFFLINE' }],
    });
  });

  it('rolls back the whole command for insufficient inventory and rejects cross-warehouse admins', async () => {
    await database.inventoryBalance.update({
      where: { warehouseId_variantId: { warehouseId, variantId: watchVariantId } },
      data: { confirmedFeishuQuantity: 0 },
    });
    const key = `${runId}-temporary-insufficient`;
    await expect(
      service.createTemporary(
        {
          warehouse: 'YUHANG',
          items: [
            { variantId: ringVariantId, quantity: 1 },
            { variantId: watchVariantId, quantity: 1 },
          ],
        },
        key,
        claimant,
      ),
    ).rejects.toMatchObject({ code: 'INVENTORY_INSUFFICIENT' });
    expect(await database.request.count({ where: { claimantId: claimant.userId } })).toBe(0);
    expect(
      await database.inventoryMovement.count({ where: { deduplicationKey: { startsWith: key } } }),
    ).toBe(0);

    await expect(
      service.createOffline(
        {
          warehouse: 'YUHANG',
          claimantId: offlineClaimant.userId,
          ...paperwork,
          items: [{ variantId: ringVariantId, quantity: 1 }],
        },
        `${runId}-offline-forbidden`,
        { ...admin, warehouses: ['XIHU'] },
      ),
    ).rejects.toMatchObject({ code: 'REQUEST_FORBIDDEN' });

    await expect(
      service.createOffline(
        {
          warehouse: 'YUHANG',
          claimantId: '00000000-0000-4000-8000-000000000000',
          ...paperwork,
          items: [{ variantId: ringVariantId, quantity: 1 }],
        },
        `${runId}-offline-claimant-missing`,
        admin,
      ),
    ).rejects.toMatchObject({ code: 'CLAIMANT_NOT_FOUND' });
  });

  it('allows only one concurrent temporary issue when stock is insufficient for both', async () => {
    await database.inventoryBalance.update({
      where: { warehouseId_variantId: { warehouseId, variantId: ringVariantId } },
      data: { confirmedFeishuQuantity: 10 },
    });
    const results = await Promise.allSettled([
      service.createTemporary(
        { warehouse: 'YUHANG', items: [{ variantId: ringVariantId, quantity: 7 }] },
        `${runId}-temporary-concurrent-a`,
        claimant,
      ),
      service.createTemporary(
        { warehouse: 'YUHANG', items: [{ variantId: ringVariantId, quantity: 7 }] },
        `${runId}-temporary-concurrent-b`,
        claimant,
      ),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const balance = await database.inventoryBalance.findUniqueOrThrow({
      where: { warehouseId_variantId: { warehouseId, variantId: ringVariantId } },
    });
    expect(balance.pendingMovementDelta).toBe(-7);
  });
});
