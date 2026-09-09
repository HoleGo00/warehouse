import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reportFiltersSchema } from '@glorychips/contracts';
import { createIsolatedSyncDatabase } from './helpers/isolated-sync-database.js';
import { ReportService } from '../src/reports/report-service.js';
import { ExportService } from '../src/reports/export-service.js';
import type { SessionPrincipal } from '../src/auth/types.js';

describe('request reports and persistent export jobs', () => {
  let fixture: Awaited<ReturnType<typeof createIsolatedSyncDatabase>>;
  let reports: ReportService;
  let exports: ExportService;
  let actor: SessionPrincipal;
  let other: SessionPrincipal;
  let requestId: string;
  let ringId: string;
  beforeAll(async () => {
    fixture = await createIsolatedSyncDatabase();
    const db = fixture.database;
    await db.role.createMany({
      data: [
        { code: 'SYSTEM_ADMIN', name: 'System' },
        { code: 'WAREHOUSE_ADMIN', name: 'Warehouse' },
        { code: 'CLAIMANT', name: 'Claimant' },
      ],
    });
    const user = await db.user.create({
      data: {
        tenantKey: 'report-test',
        name: 'Report Admin',
        status: 'ACTIVE',
        userRoles: { create: { role: { connect: { code: 'SYSTEM_ADMIN' } } } },
      },
    });
    const employee = await db.user.create({
      data: { tenantKey: 'report-test', name: 'Former User', status: 'INACTIVE' },
    });
    actor = {
      sessionId: randomUUID(),
      userId: user.id,
      feishuUserId: 'report-user',
      name: user.name,
      avatarUrl: null,
      roles: ['CLAIMANT', 'SYSTEM_ADMIN'],
      warehouses: [],
      expiresAt: new Date(Date.now() + 60_000),
    };
    other = { ...actor, roles: ['CLAIMANT', 'WAREHOUSE_ADMIN'], warehouses: ['XIHU'] };
    const warehouse = await db.warehouse.findUniqueOrThrow({ where: { code: 'YUHANG' } });
    const ring = await db.product.create({
      data: {
        code: randomUUID(),
        officialName: 'Test ring',
        status: 'INACTIVE_HISTORICAL',
        specificationMode: 'RING_SIZE',
        baseTarget: 'RING',
        category: { connect: { code: 'SMART_RING' } },
        variants: {
          create: {
            size: '8#',
            code: '8',
            variantKey: randomUUID(),
            displayName: 'Ring 8',
            specificationMode: 'RING_SIZE',
          },
        },
      },
      include: { variants: true },
    });
    ringId = ring.id;
    const watch = await db.product.create({
      data: {
        code: randomUUID(),
        officialName: 'Test watch',
        status: 'ACTIVE',
        specificationMode: 'NONE',
        baseTarget: 'WATCH',
        category: { connect: { code: 'SMART_WATCH' } },
        variants: {
          create: {
            code: 'ONE',
            variantKey: randomUUID(),
            displayName: 'Watch',
            specificationMode: 'NONE',
          },
        },
      },
      include: { variants: true },
    });
    const req = await db.request.create({
      data: {
        requestNumber: `REPORT-${randomUUID()}`,
        warehouseId: warehouse.id,
        claimantId: employee.id,
        origin: 'ONLINE',
        type: 'INTERNAL',
        purposeObject: '=1+1',
        finalDestination: 'Office %',
        status: 'COMPLETED',
        submittedAt: new Date('2026-09-01T01:00:00Z'),
        fulfillment: {
          create: { executorId: user.id, fulfilledAt: new Date('2026-09-03T01:00:00Z') },
        },
        items: {
          create: [
            {
              productId: ring.id,
              variantId: ring.variants[0]!.id,
              productNameSnapshot: 'Test ring',
              sizeSnapshot: '8#',
              quantity: 3,
            },
            {
              productId: watch.id,
              variantId: watch.variants[0]!.id,
              productNameSnapshot: 'Test watch',
              quantity: 2,
            },
          ],
        },
      },
    });
    requestId = req.id;
    reports = new ReportService(db);
    exports = new ExportService(db);
  }, 60_000);
  afterAll(async () => {
    await fixture?.dispose();
  });
  it('selects only matching lines and keeps one summary', async () => {
    const result = await reports.query(
      { category: 'SMART_RING', from: '2026-09-01', to: '2026-09-01' },
      actor,
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: requestId,
      matchedQuantity: 3,
      matchedItemCount: 1,
    });
    expect((await reports.query({ category: 'SMART_WATCH', size: '8#' }, actor)).items).toEqual([]);
    expect(
      (await reports.query({ productId: ringId, finalDestination: '%' }, actor)).items,
    ).toHaveLength(1);
  });
  it('switches dates without treating submission as fulfillment', async () => {
    expect(
      (await reports.query({ dateMode: 'FULFILLED', from: '2026-09-01', to: '2026-09-01' }, actor))
        .items,
    ).toHaveLength(0);
    expect(
      (await reports.query({ dateMode: 'FULFILLED', from: '2026-09-03', to: '2026-09-03' }, actor))
        .items,
    ).toHaveLength(1);
  });
  it('uses Shanghai midnight and does not confuse later completion with fulfillment', async () => {
    const original = await fixture.database.request.findUniqueOrThrow({ where: { id: requestId } });
    try {
      await fixture.database.request.update({
        where: { id: requestId },
        data: {
          submittedAt: new Date('2026-09-01T15:59:59.999Z'),
          completedAt: new Date('2026-09-08T02:00:00Z'),
        },
      });
      expect(
        (await reports.query({ from: '2026-09-01', to: '2026-09-01' }, actor)).items,
      ).toHaveLength(1);
      await fixture.database.request.update({
        where: { id: requestId },
        data: { submittedAt: new Date('2026-09-01T16:00:00.000Z') },
      });
      expect(
        (await reports.query({ from: '2026-09-01', to: '2026-09-01' }, actor)).items,
      ).toHaveLength(0);
      expect(
        (await reports.query({ from: '2026-09-02', to: '2026-09-02' }, actor)).items,
      ).toHaveLength(1);
      expect(
        (
          await reports.query(
            { dateMode: 'FULFILLED', from: '2026-09-03', to: '2026-09-03' },
            actor,
          )
        ).items,
      ).toHaveLength(1);
      expect(
        (
          await reports.query(
            { dateMode: 'FULFILLED', from: '2026-09-08', to: '2026-09-08' },
            actor,
          )
        ).items,
      ).toHaveLength(0);
    } finally {
      await fixture.database.request.update({
        where: { id: requestId },
        data: { submittedAt: original.submittedAt, completedAt: original.completedAt },
      });
    }
  });
  it('denies warehouse escalation and retains historic claimants', async () => {
    await expect(reports.query({ warehouse: 'YUHANG' }, other)).rejects.toMatchObject({
      code: 'FORBIDDEN_WAREHOUSE',
    });
    expect((await reports.query({}, other)).items).toEqual([]);
    expect((await reports.claimants({}, actor)).items[0]?.status).toBe('INACTIVE');
  });
  it('creates idempotently, fences claims and enforces two unfinished jobs', async () => {
    const key = randomUUID();
    const a = await exports.create(reportFiltersSchema.parse({}), key, actor);
    expect((await exports.create({}, key, actor)).job.id).toBe(a.job.id);
    await expect(exports.create({ category: 'SMART_RING' }, key, actor)).rejects.toThrow();
    await exports.create({}, randomUUID(), actor);
    await expect(exports.create({}, randomUUID(), actor)).rejects.toMatchObject({
      code: 'EXPORT_LIMIT',
    });
    const claims = await Promise.all([exports.claim(), exports.claim()]);
    expect(new Set(claims.map((j) => j?.id)).size).toBe(2);
    const job = claims[0]!;
    await expect(exports.heartbeat({ ...job, leaseToken: randomUUID() })).rejects.toMatchObject({
      code: 'EXPORT_LEASE_LOST',
    });
    await exports.fail(job, 'EXPORT_TOO_LARGE', false);
    await exports.fail(claims[1]!, 'EXPORT_TOO_LARGE', false);
  });
  it('denies other owners and expires files while retaining audit', async () => {
    const { job } = await exports.create({}, randomUUID(), actor);
    const claimed = await exports.claim();
    expect(claimed?.id).toBe(job.id);
    await exports.complete(claimed!, {
      key: `${job.id}.${claimed!.leaseToken}.xlsx`,
      size: 100,
      hash: 'test',
      summaryCount: 1,
      detailCount: 2,
      snapshotAt: new Date(),
    });
    await expect(exports.get(job.id, { ...actor, userId: randomUUID() })).rejects.toMatchObject({
      code: 'EXPORT_NOT_FOUND',
    });
    await fixture.database.requestExport.update({
      where: { id: job.id },
      data: { expiresAt: new Date(0) },
    });
    await expect(exports.download(job.id, actor)).rejects.toMatchObject({ code: 'EXPORT_EXPIRED' });
    await exports.expire();
    expect((await exports.get(job.id, actor)).status).toBe('EXPIRED');
    expect(await fixture.database.auditLog.count({ where: { entityId: job.id } })).toBeGreaterThan(
      1,
    );
  });
  it('recovers a lost lease and refuses stale publication after restart', async () => {
    const { job } = await exports.create({}, randomUUID(), actor);
    const oldAttempt = (await exports.claim())!;
    await fixture.database.requestExport.update({
      where: { id: job.id },
      data: { leaseUntil: new Date(0) },
    });
    const recovered = (await exports.claim())!;
    expect(recovered.id).toBe(job.id);
    expect(recovered.leaseToken).not.toBe(oldAttempt.leaseToken);
    await expect(
      exports.complete(oldAttempt, {
        key: 'not-published',
        size: 1,
        hash: 'test',
        summaryCount: 0,
        detailCount: 0,
        snapshotAt: new Date(),
      }),
    ).rejects.toMatchObject({ code: 'EXPORT_LEASE_LOST' });
    await fixture.database.requestExport.update({
      where: { id: job.id },
      data: { attemptCount: 3, leaseUntil: new Date(0) },
    });
    expect(await exports.claim()).toBeNull();
    expect((await exports.get(job.id, actor)).status).toBe('FAILED');
  });
  it('deduplicates simultaneous submissions and paginates newest jobs without overlap', async () => {
    const key = randomUUID();
    const results = await Promise.all([
      exports.create({}, key, actor),
      exports.create({}, key, actor),
    ]);
    expect(results[0]!.job.id).toBe(results[1]!.job.id);
    const first = await exports.list({ limit: 2 }, actor);
    expect(first.items[0]!.id).toBe(results[0]!.job.id);
    const second = await exports.list({ limit: 2, cursor: first.nextCursor }, actor);
    expect(
      second.items.every((job) => !first.items.some((previous) => previous.id === job.id)),
    ).toBe(true);
    await expect(exports.list({ cursor: 'bad' }, actor)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await exports.fail((await exports.claim())!, 'EXPORT_FAILED', false);
  });
  it('filters staff to logged-in users and clears revoked generation/publication access', async () => {
    await fixture.database.user.update({
      where: { id: actor.userId },
      data: { lastLoginAt: new Date() },
    });
    expect((await reports.staff({}, actor)).items.map((user) => user.id)).toEqual([actor.userId]);
    await expect(reports.staff({}, other)).rejects.toMatchObject({ code: 'FORBIDDEN_ROLE' });
    await exports.create({}, randomUUID(), actor);
    const job = (await exports.claim())!;
    await fixture.database.user.update({
      where: { id: actor.userId },
      data: { status: 'INACTIVE' },
    });
    try {
      await expect(
        exports.complete(job, {
          key: 'not-published',
          size: 1,
          hash: 'test',
          summaryCount: 0,
          detailCount: 0,
          snapshotAt: new Date(),
        }),
      ).rejects.toMatchObject({ code: 'USER_INACTIVE' });
    } finally {
      await fixture.database.user.update({
        where: { id: actor.userId },
        data: { status: 'ACTIVE' },
      });
    }
    await exports.fail(job, 'USER_INACTIVE', false);
  });
});
