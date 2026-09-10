import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import {
  createDatabaseClient,
  ExportService,
  ExportStorage,
  hashAuthSecret,
  Prisma,
} from '@glorychips/database';
import type { DatabaseClient, SessionPrincipal } from '@glorychips/database';
import { parseExportEnvironment } from '@glorychips/config';
import { generateWorkbook } from './workbook.js';
import { ExportRunner } from './export-runner.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('actual XLSX export pipeline', () => {
  let database: DatabaseClient;
  let admin: DatabaseClient;
  let name: string;
  let directory: string;
  let actor: SessionPrincipal;
  let exports: ExportService;
  let storage: ExportStorage;
  let warehouseId: string;
  let requestId: string;
  let variantIds: string[];
  let databaseUrl: string;
  beforeAll(async () => {
    const source = new URL(process.env['DATABASE_URL']!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(source.hostname))
      throw new Error('Local database required');
    admin = createDatabaseClient({ DATABASE_URL: source.toString() });
    name = `warehouse_export_test_${randomUUID().replaceAll('-', '')}`;
    await admin.$executeRaw(Prisma.sql`CREATE DATABASE ${Prisma.raw(`"${name}"`)}`);
    source.pathname = `/${name}`;
    databaseUrl = source.toString();
    database = createDatabaseClient({ DATABASE_URL: databaseUrl });
    const packagePath = fileURLToPath(
      new URL('../../../../packages/database/package.json', import.meta.url),
    );
    execFileSync(
      process.execPath,
      [
        createRequire(packagePath).resolve('prisma/build/index.js'),
        'migrate',
        'deploy',
        '--config',
        'prisma.config.ts',
      ],
      {
        cwd: fileURLToPath(new URL('../../../../packages/database', import.meta.url)),
        env: { ...process.env, DATABASE_URL: source.toString() },
        stdio: 'pipe',
        timeout: 60_000,
      },
    );
    directory = await mkdtemp(join(tmpdir(), 'warehouse-export-integration-'));
    storage = new ExportStorage(directory);
    await storage.initialize();
    exports = new ExportService(database);
    const user = await database.user.create({
      data: {
        tenantKey: 'xlsx-test',
        name: '=SUM(1,2)',
        userRoles: { create: { role: { create: { code: 'SYSTEM_ADMIN', name: '系统管理员' } } } },
      },
    });
    actor = {
      userId: user.id,
      sessionId: randomUUID(),
      feishuUserId: 'xlsx',
      name: user.name,
      avatarUrl: null,
      roles: ['SYSTEM_ADMIN'],
      warehouses: [],
      expiresAt: new Date(Date.now() + 3600_000),
    };
    const warehouse = await database.warehouse.create({
      data: { code: 'YUHANG', name: '余杭仓', publicSlug: 'xlsx-yuhang' },
    });
    warehouseId = warehouse.id;
    await database.productCategory.createMany({
      data: [
        { code: 'SMART_RING', name: '指环' },
        { code: 'SMART_WATCH', name: '腕表' },
      ],
    });
    variantIds = [];
    for (const [index, category] of (['SMART_RING', 'SMART_WATCH'] as const).entries()) {
      const p = await database.product.create({
        data: {
          code: `XLSX-${index}`,
          officialName: index ? '腕表' : '指环',
          specificationMode: index ? 'NONE' : 'RING_SIZE',
          baseTarget: index ? 'WATCH' : 'RING',
          category: { connect: { code: category } },
          variants: {
            create: {
              code: 'ONE',
              variantKey: `xlsx-${index}`,
              displayName: 'test',
              specificationMode: index ? 'NONE' : 'RING_SIZE',
              size: index ? null : '8#',
            },
          },
        },
        include: { variants: true },
      });
      variantIds.push(p.variants[0]!.id);
    }
    const variants = await database.productVariant.findMany({
      where: { id: { in: variantIds } },
      include: { product: true },
    });
    const r = await database.request.create({
      data: {
        requestNumber: `XLSX-${randomUUID()}`,
        warehouseId,
        claimantId: actor.userId,
        origin: 'EXPRESS',
        status: 'PENDING_PAPERWORK',
        submittedAt: new Date('2026-09-01T01:00:00Z'),
        fulfillment: {
          create: { executorId: actor.userId, fulfilledAt: new Date('2026-09-01T01:00:00Z') },
        },
        items: {
          create: variants.map((v) => ({
            productId: v.productId,
            variantId: v.id,
            productNameSnapshot: v.product.officialName,
            sizeSnapshot: v.size,
            quantity: v.size ? 3 : 2,
          })),
        },
      },
    });
    requestId = r.id;
  }, 60_000);
  afterAll(async () => {
    await database?.$disconnect();
    if (name && /^warehouse_export_test_[a-f0-9]{32}$/.test(name))
      await admin.$executeRaw(Prisma.sql`DROP DATABASE ${Prisma.raw(`"${name}"`)}`);
    await admin?.$disconnect();
    if (directory && directory.startsWith(join(tmpdir(), 'warehouse-export-integration-')))
      await rm(directory, { recursive: true, force: true });
  });
  it('writes two matching sheets, typed quantities and safe text', async () => {
    await exports.create({ category: 'SMART_RING' }, randomUUID(), actor);
    const job = (await exports.claim())!;
    const artifact = await generateWorkbook(
      database,
      job,
      storage,
      parseExportEnvironment({ EXPORT_STORAGE_DIR: directory }),
    );
    await exports.complete(job, artifact);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(join(directory, artifact.key));
    expect(workbook.worksheets.map((s) => s.name)).toEqual(['领用单汇总', '商品明细']);
    expect(workbook.worksheets[0]!.rowCount).toBe(4);
    expect(workbook.worksheets[1]!.rowCount).toBe(4);
    expect(workbook.worksheets[0]!.getRow(4).getCell(14).value).toBe(3);
    expect(workbook.worksheets[1]!.getRow(4).getCell(9).value).toBe(3);
    expect(workbook.worksheets[0]!.getRow(4).getCell(4).type).toBe(ExcelJS.ValueType.String);
    expect(workbook.worksheets[0]!.getRow(4).getCell(4).value).toBe('=SUM(1,2)');
    expect(artifact.detailCount).toBe(1);
  }, 60_000);
  it('creates empty sheets and rejects oversized output without publishing', async () => {
    await exports.create({ from: '2030-01-01' }, randomUUID(), actor);
    const emptyJob = (await exports.claim())!;
    const empty = await generateWorkbook(
      database,
      emptyJob,
      storage,
      parseExportEnvironment({ EXPORT_STORAGE_DIR: directory }),
    );
    await exports.complete(emptyJob, empty);
    expect(empty.detailCount).toBe(0);
    await exports.create({}, randomUUID(), actor);
    const job = (await exports.claim())!;
    await expect(
      generateWorkbook(
        database,
        job,
        storage,
        parseExportEnvironment({ EXPORT_STORAGE_DIR: directory, EXPORT_MAX_BYTES: '1024' }),
      ),
    ).rejects.toMatchObject({ code: 'EXPORT_TOO_LARGE' });
    await exports.fail(job, 'EXPORT_TOO_LARGE', false);
    expect((await storage.files()).filter((f) => f.jobId === job.id)).toEqual([]);
  }, 60_000);
  it('rechecks revoked permissions and cleans expired files while retaining audit', async () => {
    const job = await database.requestExport.findFirstOrThrow({ where: { status: 'SUCCEEDED' } });
    await database.user.update({ where: { id: actor.userId }, data: { status: 'INACTIVE' } });
    await expect(exports.download(job.id, actor)).rejects.toMatchObject({ code: 'USER_INACTIVE' });
    await database.user.update({ where: { id: actor.userId }, data: { status: 'ACTIVE' } });
    await database.requestExport.update({
      where: { id: job.id },
      data: { expiresAt: new Date(0) },
    });
    await new ExportRunner(
      database,
      parseExportEnvironment({ EXPORT_STORAGE_DIR: directory }),
    ).cleanup();
    expect((await storage.files()).some((f) => f.jobId === job.id)).toBe(false);
    expect(await database.auditLog.count({ where: { entityId: job.id } })).toBeGreaterThan(0);
  });
  it('rejects row overflow and a blocked query timeout without publishing partial files', async () => {
    await exports.create({}, randomUUID(), actor);
    const oversized = (await exports.claim())!;
    await expect(
      generateWorkbook(
        database,
        oversized,
        storage,
        parseExportEnvironment({
          EXPORT_STORAGE_DIR: directory,
          EXPORT_MAX_ROWS: '1',
        }),
      ),
    ).rejects.toMatchObject({ code: 'EXPORT_TOO_LARGE' });
    await exports.fail(oversized, 'EXPORT_TOO_LARGE', false);
    expect((await storage.files()).some((file) => file.jobId === oversized.id)).toBe(false);
    await exports.create({}, randomUUID(), actor);
    const timed = (await exports.claim())!;
    const locked = deferred();
    const release = deferred();
    const lock = database.$transaction(
      async (tx) => {
        await tx.$executeRaw`LOCK TABLE request_items IN ACCESS EXCLUSIVE MODE`;
        locked.resolve();
        await release.promise;
      },
      { timeout: 10_000 },
    );
    await locked.promise;
    try {
      await expect(
        generateWorkbook(
          database,
          timed,
          storage,
          parseExportEnvironment({
            EXPORT_STORAGE_DIR: directory,
            EXPORT_TIMEOUT_MS: '1000',
          }),
        ),
      ).rejects.toMatchObject({ code: 'EXPORT_TIMEOUT' });
    } finally {
      release.resolve();
      await lock;
    }
    await exports.fail(timed, 'EXPORT_TIMEOUT', false);
    expect((await storage.files()).some((file) => file.jobId === timed.id)).toBe(false);
  }, 15_000);
  it('keeps both sheets in the same snapshot while another transaction changes quantities', async () => {
    const item = await database.requestItem.findFirstOrThrow({
      where: { requestId, sizeSnapshot: '8#' },
    });
    await exports.create({ category: 'SMART_RING' }, randomUUID(), actor);
    const job = (await exports.claim())!;
    const locked = deferred();
    const release = deferred();
    const mutation = database.$transaction(
      async (tx) => {
        await tx.$executeRaw`LOCK TABLE request_items IN ACCESS EXCLUSIVE MODE`;
        locked.resolve();
        await release.promise;
        await tx.requestItem.update({ where: { id: item.id }, data: { quantity: 7 } });
      },
      { timeout: 20_000 },
    );
    await locked.promise;
    const generated = generateWorkbook(
      database,
      job,
      storage,
      parseExportEnvironment({ EXPORT_STORAGE_DIR: directory }),
    );
    void generated.catch(() => undefined);
    try {
      let waiting = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const blocked = await database.$queryRaw<
          { count: bigint }[]
        >`SELECT count(*) AS count FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%SELECT count(*) AS count%request_items%'`;
        if (Number(blocked[0]!.count) > 0) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      release.resolve();
      await mutation;
      const artifact = await generated;
      await exports.complete(job, artifact);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(join(directory, artifact.key));
      expect(workbook.worksheets[0]!.getRow(4).getCell(14).value).toBe(3);
      expect(workbook.worksheets[1]!.getRow(4).getCell(9).value).toBe(3);
      expect(
        (await database.requestItem.findUniqueOrThrow({ where: { id: item.id } })).quantity,
      ).toBe(7);
    } finally {
      release.resolve();
      await mutation;
      await generated.catch(() => undefined);
      await database.requestItem.update({ where: { id: item.id }, data: { quantity: 3 } });
    }
  }, 30_000);
  it.skipIf(process.env['RUN_EXPORT_CAPACITY'] !== 'true')(
    'exports 100000 lines while regular queries remain responsive',
    async () => {
      const template = await database.request.findUniqueOrThrow({
        where: { id: requestId },
        include: { items: true },
      });
      const item = template.items.find((item) => item.sizeSnapshot === '8#')!;
      await database.$executeRaw`
      INSERT INTO requests (id,request_number,warehouse_id,claimant_id,origin,status,submitted_at,created_at,updated_at)
      SELECT gen_random_uuid(), 'CAP-' || n::text, ${warehouseId}::uuid, ${actor.userId}::uuid,
        'ONLINE'::"RequestOrigin", 'PENDING_APPROVAL'::"RequestStatus", now(), now(), now()
      FROM generate_series(1,100000) n`;
      await database.$executeRaw`
      INSERT INTO request_items (id,request_id,product_id,variant_id,product_name_snapshot,quantity,created_at)
      SELECT gen_random_uuid(),id,${item.productId}::uuid,${item.variantId}::uuid,'Capacity item',1,now()
      FROM requests WHERE request_number LIKE 'CAP-%'`;
      await database.request.updateMany({
        where: { requestNumber: { startsWith: 'CAP-' } },
        data: { finalDestination: 'CAPACITY' },
      });
      // Fresh bulk fixtures need statistics before measuring the query planner.
      await database.$executeRaw`ANALYZE`;
      const server = createServer();
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing QA port');
      const port = address.port;
      server.close();
      await once(server, 'close');
      const root = fileURLToPath(new URL('../../../../', import.meta.url));
      const token = randomUUID();
      await database.user.update({
        where: { id: actor.userId },
        data: { feishuUserId: 'xlsx-user' },
      });
      await database.authSession.create({
        data: {
          userId: actor.userId,
          tokenDigest: hashAuthSecret(token),
          expiresAt: new Date(Date.now() + 3600_000),
        },
      });
      const env = {
        ...process.env,
        DATABASE_URL: databaseUrl,
        NODE_ENV: 'test',
        API_PORT: String(port),
        WEB_PUBLIC_URL: `http://localhost:${port}`,
        FEISHU_APP_ID: 'cli_0123456789abcdef',
        FEISHU_APP_SECRET: 'test-only',
        FEISHU_ALLOWED_TENANT_KEY: 'xlsx-test',
        INITIAL_ADMIN_FEISHU_USER_ID: 'xlsx-user',
        FEISHU_REDIRECT_URI: `http://localhost:${port}/auth/feishu/oauth/callback`,
        EXPORT_STORAGE_DIR: directory,
        EXPORT_RUN_ONCE: 'true',
        FEISHU_SYNC_ENABLED: 'false',
      };
      const api = spawn(process.execPath, [join(root, 'apps/api/dist/main.js')], {
        env,
        cwd: root,
        windowsHide: true,
        stdio: 'pipe',
      });
      let apiLog = '';
      api.stdout.on('data', (chunk) => {
        apiLog += String(chunk);
      });
      api.stderr.on('data', (chunk) => {
        apiLog += String(chunk);
      });
      const apiClosed = once(api, 'close');
      const url = `http://127.0.0.1:${port}`;
      const headers = { cookie: `glorychips_session=${token}` };
      const timings: number[] = [];
      let done = false;
      let probe: Promise<void> | undefined;
      let worker: ReturnType<typeof spawn> | undefined;
      let workerClosed: Promise<unknown> | undefined;
      const batch = async () =>
        Promise.all(
          Array.from({ length: 20 }, async () => {
            const start = performance.now();
            const response = await fetch(
              `${url}/admin/reports/requests?limit=20&category=SMART_RING`,
              { headers },
            );
            expect(response.status).toBe(200);
            await response.json();
            timings.push(performance.now() - start);
          }),
        );
      const load = async () => {
        while (!done) {
          await batch();
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      };
      try {
        for (let attempt = 0; ; attempt++) {
          if (api.exitCode !== null || attempt >= 100)
            throw new Error(`QA API did not start: ${apiLog}`);
          try {
            if ((await fetch(`${url}/health`)).ok) break;
          } catch {
            /* Server is still starting. */
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        await batch();
        await batch();
        const baselineP95Ms = [...timings].sort((a, b) => a - b)[
          Math.floor(timings.length * 0.95)
        ]!;
        timings.length = 0;
        const created = await fetch(`${url}/admin/exports`, {
          method: 'POST',
          headers: {
            ...headers,
            'content-type': 'application/json',
            'idempotency-key': randomUUID(),
          },
          body: JSON.stringify({ finalDestination: 'CAPACITY' }),
        });
        expect(created.status).toBe(201);
        const createdBody = (await created.json()) as { job: { id: string } };
        worker = spawn(
          process.execPath,
          ['--max-old-space-size=256', join(root, 'apps/worker/dist/export-main.js')],
          {
            env,
            cwd: root,
            windowsHide: true,
            stdio: 'pipe',
          },
        );
        let workerLog = '';
        worker.stdout!.on('data', (chunk) => {
          workerLog += String(chunk);
        });
        worker.stderr!.on('data', (chunk) => {
          workerLog += String(chunk);
        });
        workerClosed = once(worker, 'close');
        probe = load();
        void probe.catch(() => undefined);
        await workerClosed;
        done = true;
        await probe;
        const artifact = await database.requestExport.findUniqueOrThrow({
          where: { id: createdBody.job.id },
        });
        expect(artifact.status, workerLog).toBe('SUCCEEDED');
        expect(artifact.detailCount).toBe(100000);
        expect(artifact.summaryCount).toBe(100000);
        expect(artifact.fileSize).toBeLessThanOrEqual(67_108_864);
        const metricsLine = workerLog
          .split('\n')
          .find((line) => line.includes('"event":"export_succeeded"'));
        expect(metricsLine).toBeDefined();
        const metrics = JSON.parse(metricsLine!) as { elapsedMs: number; peakRss: number };
        const p95 = [...timings].sort((a, b) => a - b)[Math.floor(timings.length * 0.95)]!;
        console.info(
          JSON.stringify({
            ...metrics,
            event: 'export_capacity',
            baselineP95Ms,
            queryCount: timings.length,
            queryP95Ms: p95,
            fileSize: artifact.fileSize,
          }),
        );
        expect(metrics.elapsedMs).toBeLessThan(300000);
        expect(metrics.peakRss).toBeLessThan(512 * 1024 * 1024);
        expect(baselineP95Ms).toBeLessThan(1000);
        expect(p95).toBeLessThan(1000);
        const download = await fetch(`${url}/admin/exports/${artifact.id}/download`, { headers });
        expect(download.status).toBe(200);
        expect(download.headers.get('cache-control')).toContain('no-store');
        const downloadedPath = join(directory, 'capacity-http-readback.xlsx');
        const { writeFile } = await import('node:fs/promises');
        await writeFile(downloadedPath, Buffer.from(await download.arrayBuffer()));
        const reader = new ExcelJS.stream.xlsx.WorkbookReader(downloadedPath, {
          worksheets: 'emit',
          sharedStrings: 'cache',
        });
        const counts: number[] = [];
        for await (const sheet of reader) {
          let rows = 0;
          let quantity = 0;
          for await (const row of sheet) {
            expect(row.number).toBeGreaterThan(0);
            if (row.number > 3) {
              const value = row.getCell(counts.length === 0 ? 14 : 9).value;
              expect(value).toBe(1);
              quantity += Number(value);
            }
            rows++;
          }
          expect(quantity).toBe(100000);
          counts.push(rows);
        }
        expect(counts).toEqual([100003, 100003]);
      } finally {
        done = true;
        if (worker && worker.exitCode === null) worker.kill();
        await workerClosed;
        await probe?.catch(() => undefined);
        api.kill();
        await apiClosed;
      }
    },
    360_000,
  );
});
