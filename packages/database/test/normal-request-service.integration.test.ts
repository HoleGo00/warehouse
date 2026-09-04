import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabaseClient, NormalRequestService } from '../src/index.js';
import type { RequestDomainError } from '../src/index.js';
import type { CreateNormalRequest } from '@glorychips/contracts';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import type { SessionPrincipal } from '../src/auth/types.js';

const databaseUrl = process.env['DATABASE_URL'];
const integrationEnabled = databaseUrl !== undefined && databaseUrl.length > 0;
const runId = `normal-request-it-${Date.now()}`;

describe.skipIf(!integrationEnabled)('NormalRequestService PostgreSQL integration', () => {
  let database: PrismaClient;
  let service: NormalRequestService;
  let claimant: SessionPrincipal;
  let admin: SessionPrincipal;
  let warehouseId: string;
  let ringVariantId: string;
  let watchVariantId: string;

  const command = (quantity = 2): CreateNormalRequest => ({
    warehouse: 'YUHANG',
    type: 'INTERNAL',
    purposeObject: '集成测试健康管理',
    finalDestination: '集成测试部门',
    returnMode: 'ON_DEPARTURE',
    items: [
      { variantId: ringVariantId, quantity },
      { variantId: watchVariantId, quantity: 1 },
    ],
  });

  beforeAll(async () => {
    database = createDatabaseClient();
    service = new NormalRequestService(database);
    const [warehouse, ring, watch, claimantUser, adminUser] = await Promise.all([
      database.warehouse.findUniqueOrThrow({ where: { code: 'YUHANG' } }),
      database.productVariant.findFirstOrThrow({
        where: { product: { code: 'RING_YEARS_TRIBUTE_ROSE_GOLD' }, size: '6#' },
      }),
      database.productVariant.findFirstOrThrow({
        where: { product: { code: 'WATCH_HEALTH' }, code: 'DEFAULT' },
      }),
      database.user.create({
        data: {
          tenantKey: runId,
          feishuUserId: `${runId}-claimant`,
          name: '正常领用测试员工',
        },
      }),
      database.user.create({
        data: {
          tenantKey: runId,
          feishuUserId: `${runId}-admin`,
          name: '正常领用测试管理员',
        },
      }),
    ]);
    warehouseId = warehouse.id;
    ringVariantId = ring.id;
    watchVariantId = watch.id;
    claimant = {
      sessionId: `${runId}-claimant-session`,
      userId: claimantUser.id,
      feishuUserId: claimantUser.feishuUserId ?? `${runId}-claimant`,
      name: claimantUser.name,
      avatarUrl: null,
      roles: ['CLAIMANT'],
      warehouses: [],
      expiresAt: new Date(Date.now() + 60_000),
    };
    admin = {
      sessionId: `${runId}-admin-session`,
      userId: adminUser.id,
      feishuUserId: adminUser.feishuUserId ?? `${runId}-admin`,
      name: adminUser.name,
      avatarUrl: null,
      roles: ['CLAIMANT', 'WAREHOUSE_ADMIN'],
      warehouses: ['YUHANG'],
      expiresAt: new Date(Date.now() + 60_000),
    };
    await database.inventoryBalance.updateMany({
      where: { warehouseId, variantId: { in: [ringVariantId, watchVariantId] } },
      data: {
        confirmedFeishuQuantity: 20,
        pendingMovementDelta: 0,
        reservedQuantity: 0,
        lastMovementId: null,
      },
    });
  });

  afterAll(async () => {
    if (database === undefined) return;
    const users = [claimant.userId, admin.userId];
    const requests = await database.request.findMany({
      where: { claimantId: claimant.userId },
      select: { id: true, requestNumber: true },
    });
    const requestIds = requests.map((request) => request.id);
    const requestNumbers = requests.map((request) => request.requestNumber);
    await database.$transaction(async (transaction) => {
      await transaction.returnObligation.deleteMany({ where: { requestId: { in: requestIds } } });
      await transaction.fulfillment.deleteMany({ where: { requestId: { in: requestIds } } });
      await transaction.approvalRecord.deleteMany({ where: { requestId: { in: requestIds } } });
      await transaction.inventoryMovement.deleteMany({ where: { requestId: { in: requestIds } } });
      await transaction.inventoryReservation.deleteMany({
        where: { requestId: { in: requestIds } },
      });
      await transaction.requestItem.deleteMany({ where: { requestId: { in: requestIds } } });
      await transaction.request.deleteMany({ where: { id: { in: requestIds } } });
      await transaction.auditLog.deleteMany({ where: { actorUserId: { in: users } } });
      const jobs = await transaction.outboxJob.findMany({
        where: { aggregateId: { in: requestNumbers } },
        select: { id: true },
      });
      await transaction.outboxJobStep.deleteMany({
        where: { jobId: { in: jobs.map((job) => job.id) } },
      });
      await transaction.outboxJob.deleteMany({ where: { id: { in: jobs.map((job) => job.id) } } });
      await transaction.idempotencyKey.deleteMany({ where: { key: { startsWith: runId } } });
      await transaction.user.deleteMany({ where: { id: { in: users } } });
      await transaction.inventoryBalance.updateMany({
        where: { warehouseId, variantId: { in: [ringVariantId, watchVariantId] } },
        data: {
          confirmedFeishuQuantity: 0,
          pendingMovementDelta: 0,
          reservedQuantity: 0,
          lastMovementId: null,
        },
      });
    });
    await database.$disconnect();
  });

  it('submits without inventory mutation and returns the same result on retry', async () => {
    const key = `${runId}-submit`;
    const before = await database.inventoryBalance.findMany({
      where: { warehouseId, variantId: { in: [ringVariantId, watchVariantId] } },
    });
    const first = await service.createAndSubmit(command(), key, claimant);
    const second = await service.createAndSubmit(command(), key, claimant);
    const after = await database.inventoryBalance.findMany({
      where: { warehouseId, variantId: { in: [ringVariantId, watchVariantId] } },
    });

    expect(second).toEqual(first);
    expect(first.request.status).toBe('PENDING_APPROVAL');
    expect(after).toEqual(before);
    expect(
      await database.inventoryReservation.count({ where: { requestId: first.request.id } }),
    ).toBe(0);
    expect(await database.inventoryMovement.count({ where: { requestId: first.request.id } })).toBe(
      0,
    );
  });

  it('approves an entire request and claimant cancellation releases every reservation', async () => {
    const created = await service.createAndSubmit(
      command(),
      `${runId}-approve-cancel-submit`,
      claimant,
    );
    const approved = await service.review(
      created.request.id,
      { decision: 'APPROVED', comment: '库存充足' },
      `${runId}-approve-cancel-review`,
      admin,
    );
    expect(approved.request.status).toBe('PENDING_RELEASE');
    expect(
      await database.inventoryReservation.count({
        where: { requestId: created.request.id, status: 'ACTIVE' },
      }),
    ).toBe(2);

    const cancelled = await service.cancel(
      created.request.id,
      { reason: '申请人计划变更' },
      `${runId}-approve-cancel-action`,
      claimant,
    );
    expect(cancelled.request.status).toBe('CANCELLED');
    expect(
      await database.inventoryReservation.count({
        where: { requestId: created.request.id, status: 'ACTIVE' },
      }),
    ).toBe(0);
    const balances = await database.inventoryBalance.findMany({
      where: { warehouseId, variantId: { in: [ringVariantId, watchVariantId] } },
    });
    expect(balances.every((balance) => balance.reservedQuantity === 0)).toBe(true);
  });

  it('allows an authorized administrator to cancel a pending release request', async () => {
    const created = await service.createAndSubmit(
      command(),
      `${runId}-admin-cancel-submit`,
      claimant,
    );
    await service.review(
      created.request.id,
      { decision: 'APPROVED' },
      `${runId}-admin-cancel-review`,
      admin,
    );
    const cancelled = await service.cancel(
      created.request.id,
      { reason: '仓库无法按计划发放' },
      `${runId}-admin-cancel-action`,
      admin,
    );
    expect(cancelled.request.status).toBe('CANCELLED');
    expect(
      await database.inventoryReservation.count({
        where: { requestId: created.request.id, status: 'ACTIVE' },
      }),
    ).toBe(0);
  });

  it('preserves approval history when a rejected request is edited and resubmitted', async () => {
    const created = await service.createAndSubmit(command(), `${runId}-reject-submit`, claimant);
    await service.review(
      created.request.id,
      { decision: 'REJECTED', comment: '请补充用途' },
      `${runId}-reject-review`,
      admin,
    );
    const resubmitted = await service.resubmit(
      created.request.id,
      { ...command(), purposeObject: '补充后的具体用途' },
      `${runId}-reject-resubmit`,
      claimant,
    );
    expect(resubmitted.request.status).toBe('PENDING_APPROVAL');
    expect(resubmitted.request.purposeObject).toBe('补充后的具体用途');
    expect(resubmitted.request.approvals).toHaveLength(1);
    expect(resubmitted.request.approvals[0]?.comment).toBe('请补充用途');
  });

  it('fulfills exactly once with issue movements, outbox steps and return obligations', async () => {
    const created = await service.createAndSubmit(command(), `${runId}-fulfill-submit`, claimant);
    await service.review(
      created.request.id,
      { decision: 'APPROVED' },
      `${runId}-fulfill-review`,
      admin,
    );
    const first = await service.fulfill(created.request.id, `${runId}-fulfill-action`, admin);
    const second = await service.fulfill(created.request.id, `${runId}-fulfill-action`, admin);
    expect(second).toEqual(first);
    expect(first.request.status).toBe('COMPLETED');
    expect(first.request.syncStatus).toBe('PENDING');
    expect(first.request.returnObligations).toHaveLength(2);
    expect(
      await database.inventoryMovement.count({
        where: { requestId: created.request.id, type: 'ISSUE' },
      }),
    ).toBe(2);
    expect(await database.fulfillment.count({ where: { requestId: created.request.id } })).toBe(1);
    const job = await database.outboxJob.findFirstOrThrow({
      where: { aggregateId: created.request.requestNumber },
      include: { steps: true },
    });
    expect(new Set(job.steps.map((step) => step.target))).toEqual(
      new Set(['RING_BASE', 'WATCH_BASE']),
    );
  });

  it('allows only one of two concurrent approvals when shared inventory is insufficient', async () => {
    await database.inventoryBalance.update({
      where: { warehouseId_variantId: { warehouseId, variantId: ringVariantId } },
      data: { confirmedFeishuQuantity: 10, pendingMovementDelta: 0, reservedQuantity: 0 },
    });
    const first = await service.createAndSubmit(
      command(7),
      `${runId}-concurrent-submit-a`,
      claimant,
    );
    const second = await service.createAndSubmit(
      command(7),
      `${runId}-concurrent-submit-b`,
      claimant,
    );
    const results = await Promise.allSettled([
      service.review(
        first.request.id,
        { decision: 'APPROVED' },
        `${runId}-concurrent-review-a`,
        admin,
      ),
      service.review(
        second.request.id,
        { decision: 'APPROVED' },
        `${runId}-concurrent-review-b`,
        admin,
      ),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const pending = await database.request.count({
      where: { id: { in: [first.request.id, second.request.id] }, status: 'PENDING_APPROVAL' },
    });
    expect(pending).toBe(1);
    const balance = await database.inventoryBalance.findUniqueOrThrow({
      where: { warehouseId_variantId: { warehouseId, variantId: ringVariantId } },
    });
    expect(balance.reservedQuantity).toBe(7);
  });

  it('rejects cross-warehouse administrator actions', async () => {
    const created = await service.createAndSubmit(command(), `${runId}-forbidden-submit`, claimant);
    const xihuAdmin: SessionPrincipal = { ...admin, warehouses: ['XIHU'] };
    await expect(
      service.review(
        created.request.id,
        { decision: 'APPROVED' },
        `${runId}-forbidden-review`,
        xihuAdmin,
      ),
    ).rejects.toMatchObject({ code: 'REQUEST_FORBIDDEN' } satisfies Partial<RequestDomainError>);
  });

  it('rejects changed input that reuses an idempotency key', async () => {
    const key = `${runId}-idempotency-conflict`;
    await service.createAndSubmit(command(), key, claimant);
    await expect(service.createAndSubmit(command(3), key, claimant)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
  });
});
