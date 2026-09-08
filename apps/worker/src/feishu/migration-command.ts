import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  FeishuBindingService,
  FeishuGatewayError,
  FeishuSyncError,
  InventoryMigrationService,
  assertSourceFence,
  buildMigrationPlan,
  captureMigrationSnapshot,
  createDatabaseClient,
  hashCommand,
  legacySourceTables,
  migrationCatalogShape,
  snapshotManifest,
  validateSnapshot,
} from '@glorychips/database';
import { LarkCliGateway } from './lark-cli-gateway.js';
import { V1SchemaProvisioner } from './v1-schema.js';

const workspace = fileURLToPath(new URL('../../../../', import.meta.url));
const runtime = resolve(workspace, '.trellis/.runtime/feishu-migration');
const formalBases = {
  RING_BASE: legacySourceTables.find((table) => table.target === 'RING_BASE')!.baseToken,
  WATCH_BASE: legacySourceTables.find((table) => table.target === 'WATCH_BASE')!.baseToken,
};

export function parseMigrationArguments(args: string[]) {
  const parsed = parseArgs({
    args: args.filter((arg) => arg !== '--'),
    allowPositionals: true,
    strict: true,
    options: Object.fromEntries(
      [
        'batch',
        'snapshot',
        'fingerprint',
        'mode',
        'freeze-confirmed-at',
        'operator',
        'test-ring-base',
        'test-watch-base',
        'acceptance-report',
      ].map((name) => [name, { type: 'string' as const }]),
    ),
  });
  const command = parsed.positionals[0];
  if (
    parsed.positionals.length !== 1 ||
    !['snapshot', 'plan', 'provision', 'apply', 'resume', 'reconcile', 'cutover-check'].includes(
      command ?? '',
    )
  ) {
    throw new Error('MIGRATION_COMMAND_INVALID');
  }
  const batchKey = parsed.values['batch'];
  if (typeof batchKey !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(batchKey))
    throw new Error('MIGRATION_BATCH_INVALID');
  const mode = parsed.values['mode'] ?? 'FORMAL_SHADOW';
  if (mode !== 'TEST' && mode !== 'FORMAL_SHADOW' && mode !== 'FINAL_DELTA')
    throw new Error('MIGRATION_MODE_INVALID');
  return { command: command!, batchKey, mode, values: parsed.values } as const;
}

function within(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path !== '' && !path.startsWith('..') && !isAbsolute(path);
}

async function readRuntimeJson(input: string): Promise<unknown> {
  const path = await realpath(resolve(workspace, input));
  const root = await realpath(runtime);
  if (!within(root, path)) throw new Error('MIGRATION_ARTIFACT_PATH_INVALID');
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

async function saveArtifact(batch: string, kind: string, value: unknown) {
  const directory = resolve(runtime, batch);
  await mkdir(directory, { recursive: true });
  if (!within(await realpath(runtime), await realpath(directory)))
    throw new Error('MIGRATION_ARTIFACT_PATH_INVALID');
  const path = resolve(directory, `${kind}-${randomUUID()}.json`);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return path;
}

export async function runMigrationCommand(args: string[]) {
  const { command, batchKey, mode, values } = parseMigrationArguments(args);
  const bases =
    mode === 'TEST'
      ? {
          RING_BASE: values['test-ring-base'],
          WATCH_BASE: values['test-watch-base'],
        }
      : formalBases;
  if (
    mode === 'TEST' &&
    (typeof bases.RING_BASE !== 'string' ||
      typeof bases.WATCH_BASE !== 'string' ||
      bases.RING_BASE === bases.WATCH_BASE ||
      Object.values(bases).some(
        (base) =>
          typeof base !== 'string' ||
          !/^[A-Za-z0-9]{10,128}$/.test(base) ||
          Object.values(formalBases).includes(base),
      ))
  ) {
    throw new Error('MIGRATION_TEST_BASE_INVALID');
  }
  const gateway = new LarkCliGateway({
    executable: process.env['LARK_CLI_EXECUTABLE'] ?? 'lark-cli',
    profile: 'glorychips-warehouse',
    identity: 'user',
    expectedVersion: '1.0.91',
    timeoutMs: 30_000,
    maxOutputBytes: 16_777_216,
    allowedBases: [
      ...new Set([...Object.values(formalBases), ...(Object.values(bases) as string[])]),
    ],
  });
  await gateway.validate();
  const snapshotArg = values['snapshot'];
  const snapshot =
    typeof snapshotArg === 'string'
      ? validateSnapshot(await readRuntimeJson(snapshotArg))
      : await captureMigrationSnapshot(gateway);
  // A saved artifact must still describe the six configured old tables.
  if (
    hashCommand(
      snapshot.tables
        .map((table) => table.source)
        .sort((a, b) => a.tableId.localeCompare(b.tableId)),
    ) !== hashCommand([...legacySourceTables].sort((a, b) => a.tableId.localeCompare(b.tableId)))
  )
    throw new Error('MIGRATION_SOURCE_INVALID');
  await assertSourceFence(gateway, snapshot);
  const snapshotPath =
    typeof snapshotArg === 'string'
      ? resolve(workspace, snapshotArg)
      : await saveArtifact(batchKey, 'snapshot', snapshot);
  if (command === 'snapshot')
    return {
      command,
      snapshotPath,
      fingerprint: snapshot.fingerprint,
      tables: snapshotManifest(snapshot).map(({ source, ...manifest }) => ({
        target: source.target,
        kind: source.kind,
        tableId: source.tableId,
        name: source.name,
        ...manifest,
      })),
    };
  const plan = buildMigrationPlan(snapshot);
  const provisioner = new V1SchemaProvisioner(gateway);
  const schemaPlans = [];
  for (const target of ['RING_BASE', 'WATCH_BASE'] as const) {
    schemaPlans.push({ target, tables: await provisioner.plan(bases[target] as string) });
  }
  const report = {
    kind: 'MIGRATION_PLAN',
    generatedAt: new Date().toISOString(),
    sourceFingerprint: snapshot.fingerprint,
    summary: plan.summary,
    anomalies: plan.anomalies,
    schemaPlans,
    plannedBatches: plan.plannedBatches,
    schema: { ...migrationCatalogShape, movement: plan.summary.movements },
  };
  const planPath = await saveArtifact(batchKey, 'plan', report);
  if (command === 'plan') return { command, snapshotPath, planPath, ...report };
  if (plan.summary.blockingIssues) throw new Error('MIGRATION_PLAN_BLOCKED');
  if (values['fingerprint'] !== snapshot.fingerprint)
    throw new Error('MIGRATION_FINGERPRINT_REQUIRED');
  const operator = values['operator'];
  if (typeof operator !== 'string' || !operator.trim() || operator.length > 80)
    throw new Error('MIGRATION_OPERATOR_REQUIRED');
  if (mode !== 'TEST' && command === 'provision') {
    const path = values['acceptance-report'];
    if (typeof path !== 'string') throw new Error('MIGRATION_TEST_ACCEPTANCE_REQUIRED');
    const acceptance = (await readRuntimeJson(path)) as Record<string, unknown>;
    if (
      acceptance['kind'] !== 'ISOLATED_TEST_ACCEPTANCE' ||
      acceptance['passed'] !== true ||
      typeof acceptance['evidenceHash'] !== 'string' ||
      typeof acceptance['generatedAt'] !== 'string' ||
      !acceptance['evidence'] ||
      acceptance['evidenceHash'] !== hashCommand(acceptance['evidence'])
    ) {
      throw new Error('MIGRATION_TEST_ACCEPTANCE_REQUIRED');
    }
  }
  // Read-only plan/snapshot never connect to or modify PostgreSQL.
  const database = createDatabaseClient();
  try {
    if (command === 'provision') {
      for (const target of ['RING_BASE', 'WATCH_BASE'] as const) {
        await assertSourceFence(gateway, snapshot);
        const bindings = await provisioner.provision(
          bases[target] as string,
          target,
          mode === 'TEST' ? 'TEST' : 'FORMAL',
        );
        await new FeishuBindingService(database).savePrepared(bindings);
      }
      await assertSourceFence(gateway, snapshot);
      const reportPath = await saveArtifact(batchKey, 'provision', {
        status: 'PREPARED',
        mode,
        operator,
        fingerprint: snapshot.fingerprint,
      });
      return { command, reportPath, status: 'PREPARED' };
    }
    if (typeof snapshotArg !== 'string') throw new Error('MIGRATION_APPROVED_SNAPSHOT_REQUIRED');
    const service = new InventoryMigrationService(database, gateway);
    const options = {
      batchKey,
      mode,
      operator,
      expectedFingerprint: snapshot.fingerprint,
      freezeConfirmedAt:
        typeof values['freeze-confirmed-at'] === 'string'
          ? values['freeze-confirmed-at']
          : undefined,
    };
    const result =
      command === 'apply' || command === 'resume'
        ? await service.resume(snapshot, options)
        : await service.reconcile(snapshot, options);
    const reportPath = await saveArtifact(batchKey, command, { mode, operator, ...result });
    await database.inventoryMigrationBatch.update({ where: { batchKey }, data: { reportPath } });
    if (command === 'cutover-check') {
      const pendingJobs = await database.outboxJob.count({
        where: { status: { not: 'SUCCEEDED' } },
      });
      const unresolvedWrites = await database.feishuSyncWrite.count({
        where: { status: { not: 'CONFIRMED' } },
      });
      await assertSourceFence(gateway, snapshot);
      const check = {
        kind: 'CUTOVER_CHECK',
        passed: result.status === 'SUCCEEDED' && pendingJobs === 0 && unresolvedWrites === 0,
        pendingJobs,
        unresolvedWrites,
        sourceFingerprint: snapshot.fingerprint,
      };
      const checkPath = await saveArtifact(batchKey, 'cutover-check', check);
      await database.auditLog.create({
        data: {
          action: 'INVENTORY_MIGRATION_CUTOVER_CHECK',
          entityType: 'INVENTORY_MIGRATION_BATCH',
          entityId: batchKey,
          after: check,
        },
      });
      return { ...check, checkPath };
    }
    return { command, reportPath, ...result };
  } finally {
    await database.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runMigrationCommand(process.argv.slice(2))
    .then((result) => {
      console.info(JSON.stringify(result, null, 2));
      if (
        ('status' in result && result.status === 'FAILED') ||
        ('passed' in result && !result.passed)
      )
        process.exitCode = 1;
    })
    .catch((error: unknown) => {
      const code =
        error instanceof FeishuSyncError || error instanceof FeishuGatewayError
          ? error.code
          : error instanceof Error && /^MIGRATION_[A-Z_]+$/.test(error.message)
            ? error.message
            : 'MIGRATION_COMMAND_FAILED';
      console.error(JSON.stringify({ status: 'FAILED', code }));
      process.exitCode = 1;
    });
}
