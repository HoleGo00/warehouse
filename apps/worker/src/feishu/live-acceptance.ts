import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDatabaseClient,
  FeishuBindingService,
  FeishuGatewayError,
  FeishuSyncService,
  FeishuSyncAdminService,
  InventoryService,
  enqueueReconciliation,
  hashCommand,
} from '@glorychips/database';
import type { FeishuFields, SessionPrincipal } from '@glorychips/database';
import { LarkCliGateway } from './lark-cli-gateway.js';
import { V1SchemaProvisioner } from './v1-schema.js';

const directory = fileURLToPath(
  new URL(
    '../../../../.trellis/.runtime/feishu-migration/isolated-acceptance-20260905/',
    import.meta.url,
  ),
);
const formal = ['PTPhb4v7waNskrskwCTccQpJnXc', 'MfjUbu1MYa9x5dscz6bcs6Yinth'];
const gatewayFor = (bases: string[]) =>
  new LarkCliGateway({
    executable: process.env['LARK_CLI_EXECUTABLE'] ?? 'lark-cli',
    profile: 'glorychips-warehouse',
    identity: 'user',
    expectedVersion: '1.0.91',
    timeoutMs: 30_000,
    maxOutputBytes: 16_777_216,
    allowedBases: bases,
  });
const artifact = async (name: string, data: unknown) => {
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, name);
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return path;
};
function requireCondition(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

async function main() {
  const command = process.argv[2];
  if (command === 'copy') {
    const gateway = gatewayFor(formal);
    await gateway.validate();
    for (const [index, base] of formal.entries()) {
      // A retained intent prevents accidentally creating another copy after a timeout.
      await artifact(`copy-${index}.intent.json`, {
        sourceHash: hashCommand(base),
        startedAt: new Date().toISOString(),
      });
      const copied = await gateway.copyStructure(base, `Warehouse_V1_Test_${index}_20260905`);
      const path = await artifact(`copy-${index}.result.json`, copied);
      console.info(JSON.stringify({ kind: 'COPY_RESULT', index, path }));
    }
    return;
  }
  if (!['run', 'recover', 'manual-retry'].includes(command ?? ''))
    throw new Error('ACCEPTANCE_COMMAND_INVALID');
  const config = JSON.parse(await readFile(resolve(directory, 'coordinates.json'), 'utf8')) as {
    ring: string;
    watch: string;
  };
  requireCondition(
    config.ring !== config.watch &&
      [config.ring, config.watch].every(
        (base) =>
          typeof base === 'string' && /^[A-Za-z0-9]{10,128}$/.test(base) && !formal.includes(base),
      ),
    'ACCEPTANCE_BASE_INVALID',
  );
  const url = new URL(process.env['DATABASE_URL'] ?? '');
  requireCondition(
    ['localhost', '127.0.0.1'].includes(url.hostname) &&
      url.pathname === '/warehouse_feishu_acceptance_20260905',
    'ACCEPTANCE_DATABASE_INVALID',
  );
  const database = createDatabaseClient();
  const gateway = gatewayFor([config.ring, config.watch]);
  try {
    if (command === 'manual-retry') {
      const originalReport = JSON.parse(
        await readFile(resolve(directory, 'acceptance.json'), 'utf8'),
      ) as {
        passed: boolean;
        evidence: Record<string, unknown>;
        evidenceHash: string;
      };
      requireCondition(
        originalReport.passed &&
          originalReport.evidenceHash === hashCommand(originalReport.evidence),
        'ACCEPTANCE_BASELINE_REQUIRED',
      );
      requireCondition(
        (await database.request.count()) === 1 && (await database.inventoryMovement.count()) === 2,
        'ACCEPTANCE_MANUAL_FIXTURE_INVALID',
      );
      await gateway.validate();
      const warehouse = await database.warehouse.findUniqueOrThrow({ where: { code: 'YUHANG' } });
      const user = await database.user.findFirstOrThrow();
      const variants = await database.productVariant.findMany();
      const request = await database.request.create({
        data: {
          requestNumber: `ACCEPTANCE-MANUAL-${randomUUID()}`,
          warehouseId: warehouse.id,
          claimantId: user.id,
          origin: 'ONLINE',
          status: 'COMPLETED',
          syncStatus: 'PENDING',
        },
      });
      const batch = await new InventoryService(database).applyMovementBatch(
        {
          businessNumber: request.requestNumber,
          requestId: request.id,
          source: 'ADMIN_INBOUND',
          lines: variants.map((variant) => ({
            warehouseId: warehouse.id,
            variantId: variant.id,
            quantityDelta: 1,
            type: 'INBOUND' as const,
          })),
        },
        randomUUID(),
      );
      const sync = () =>
        new FeishuSyncService(database, gateway, {
          environment: 'TEST',
          mode: 'TEST',
          transactionTimeoutMs: 600_000,
        });
      const listFields = gateway.listFields.bind(gateway);
      gateway.listFields = async (table) => {
        const fields = await listFields(table);
        return table.baseToken === config.ring
          ? fields.map((field) => ({ ...field, type: 'formula' }))
          : fields;
      };
      try {
        await sync().runOnce(batch.outboxJobId);
      } finally {
        gateway.listFields = listFields;
      }
      requireCondition(
        (
          await database.outboxJobStep.findUniqueOrThrow({
            where: { jobId_target: { jobId: batch.outboxJobId, target: 'RING_BASE' } },
          })
        ).status === 'MANUAL_REVIEW',
        'ACCEPTANCE_MANUAL_REVIEW_FAILED',
      );
      requireCondition(
        (await database.request.findUniqueOrThrow({ where: { id: request.id } })).syncStatus ===
          'FAILED',
        'ACCEPTANCE_FAILED_REQUEST_MISSING',
      );
      const actor: SessionPrincipal = {
        sessionId: 'acceptance',
        userId: user.id,
        feishuUserId: 'synthetic-acceptance',
        name: user.name,
        avatarUrl: null,
        roles: ['SYSTEM_ADMIN'],
        warehouses: ['YUHANG', 'XIHU'],
        expiresAt: new Date(Date.now() + 3600_000),
      };
      const admin = new FeishuSyncAdminService(database);
      const key = randomUUID();
      const retry = {
        target: 'RING_BASE',
        reason: 'Synthetic schema failure removed; remote schema verified',
      };
      const first = await admin.retry(batch.outboxJobId, retry, key, actor);
      requireCondition(
        hashCommand(first) === hashCommand(await admin.retry(batch.outboxJobId, retry, key, actor)),
        'ACCEPTANCE_MANUAL_IDEMPOTENCY_FAILED',
      );
      requireCondition(
        (await sync().runOnce(batch.outboxJobId)).succeeded === 1,
        'ACCEPTANCE_MANUAL_RETRY_FAILED',
      );
      requireCondition(
        (await database.request.findUniqueOrThrow({ where: { id: request.id } })).syncStatus ===
          'SYNCED',
        'ACCEPTANCE_MANUAL_REQUEST_FAILED',
      );
      requireCondition(
        (await database.adminTask.count({
          where: { deduplicationKey: `sync:${batch.outboxJobId}:RING_BASE`, status: 'COMPLETED' },
        })) === 1,
        'ACCEPTANCE_EXCEPTION_TASK_FAILED',
      );
      const bindings = await database.feishuTableBinding.findMany();
      for (const binding of bindings.filter((item) => item.kind === 'MOVEMENT')) {
        const page = await gateway.listRecords(binding);
        requireCondition(!page.hasMore && page.records.length === 2, 'ACCEPTANCE_MANUAL_DUPLICATE');
      }
      const reconciliation = await database.$transaction((tx) =>
        enqueueReconciliation(tx, `acceptance-manual:${randomUUID()}`),
      );
      requireCondition(
        (await sync().runOnce(reconciliation.jobId)).succeeded === 1,
        'ACCEPTANCE_RECONCILIATION_FAILED',
      );
      requireCondition(
        (await database.inventoryReconciliation.count({
          where: { jobId: reconciliation.jobId, status: 'MATCHED' },
        })) === 4,
        'ACCEPTANCE_BALANCE_MISMATCH',
      );
      const evidence = {
        ...originalReport.evidence,
        movementRecords: [2, 2],
        manualRetry: true,
        manualRetryIdempotency: true,
        uniqueExceptionTaskCompleted: true,
        manualRequestStates: ['FAILED', 'SYNCED'],
      };
      const report = {
        kind: 'ISOLATED_TEST_ACCEPTANCE',
        passed: true,
        generatedAt: new Date().toISOString(),
        evidence,
        evidenceHash: hashCommand(evidence),
      };
      const path = await artifact('acceptance-manual.json', report);
      await database.auditLog.create({
        data: {
          action: 'FEISHU_ISOLATED_ACCEPTANCE',
          entityType: 'OUTBOX_JOB',
          entityId: batch.outboxJobId,
          after: report,
        },
      });
      console.info(JSON.stringify({ path, ...report }, null, 2));
      return;
    }
    if (command === 'recover') {
      await gateway.validate();
      const bindings = await database.feishuTableBinding.findMany();
      requireCondition(
        bindings.length === 6 &&
          bindings.every(
            (binding) =>
              binding.environment === 'TEST' &&
              binding.status === 'PREPARED' &&
              [config.ring, config.watch].includes(binding.baseToken),
          ),
        'ACCEPTANCE_BINDING_INVALID',
      );
      const jobs = await database.outboxJob.findMany({
        where: { type: 'SYNC_INVENTORY_MOVEMENTS' },
      });
      const requests = await database.request.findMany();
      requireCondition(
        jobs.length === 1 &&
          requests.length === 1 &&
          requests[0]!.syncStatus === 'PENDING' &&
          (await database.inventoryMovement.count()) === 2,
        'ACCEPTANCE_RECOVERY_STATE_INVALID',
      );
      const uncertainEvidence = await database.auditLog.count({
        where: { action: 'FEISHU_WRITE_FAILED' },
      });
      requireCondition(uncertainEvidence > 0, 'ACCEPTANCE_FAILURE_EVIDENCE_MISSING');
      const retainedJob = jobs[0]!;
      for (let attempt = 0; attempt < 4; attempt++) {
        const sync = new FeishuSyncService(database, gateway, {
          environment: 'TEST',
          mode: 'TEST',
          now: () => new Date(Date.now() + (attempt + 1) * 60_000),
          transactionTimeoutMs: 600_000,
        });
        await sync.validateBindings();
        await sync.runOnce(retainedJob.id);
        if (
          (await database.outboxJob.findUniqueOrThrow({ where: { id: retainedJob.id } })).status ===
          'SUCCEEDED'
        )
          break;
      }
      requireCondition(
        (await database.outboxJob.findUniqueOrThrow({ where: { id: retainedJob.id } })).status ===
          'SUCCEEDED',
        'ACCEPTANCE_RECOVERY_FAILED',
      );
      requireCondition(
        (await database.request.findUniqueOrThrow({ where: { id: requests[0]!.id } }))
          .syncStatus === 'SYNCED',
        'ACCEPTANCE_REQUEST_STATUS_FAILED',
      );
      requireCondition(
        (await database.feishuSyncWrite.count({ where: { status: { not: 'CONFIRMED' } } })) === 0,
        'ACCEPTANCE_UNRESOLVED_WRITE',
      );
      const readRemote = async () => {
        const content = [];
        for (const binding of bindings) {
          const page = await gateway.listRecords(binding);
          requireCondition(
            !page.hasMore && page.records.length === (binding.kind === 'BALANCE' ? 2 : 1),
            'ACCEPTANCE_REMOTE_COUNT_MISMATCH',
          );
          content.push({
            id: binding.id,
            rows: [...page.records].sort((a, b) => a.recordId.localeCompare(b.recordId)),
          });
        }
        return hashCommand(content);
      };
      const beforeRemote = await readRemote();
      const beforeBalances = hashCommand(
        await database.inventoryBalance.findMany({ orderBy: { id: 'asc' } }),
      );
      const sync = new FeishuSyncService(database, gateway, {
        environment: 'TEST',
        mode: 'TEST',
        transactionTimeoutMs: 600_000,
      });
      requireCondition(
        (await sync.runOnce(retainedJob.id)).claimed === 0,
        'ACCEPTANCE_RERUN_CLAIMED',
      );
      requireCondition(
        beforeRemote === (await readRemote()) &&
          beforeBalances ===
            hashCommand(await database.inventoryBalance.findMany({ orderBy: { id: 'asc' } })),
        'ACCEPTANCE_RERUN_CHANGED_DATA',
      );
      const reconciliation = await database.$transaction((tx) =>
        enqueueReconciliation(tx, `acceptance:${randomUUID()}`),
      );
      requireCondition(
        (await sync.runOnce(reconciliation.jobId)).succeeded === 1,
        'ACCEPTANCE_RECONCILIATION_FAILED',
      );
      const results = await database.inventoryReconciliation.findMany({
        where: { jobId: reconciliation.jobId },
      });
      requireCondition(
        results.length === 4 && results.every((item) => item.status === 'MATCHED'),
        'ACCEPTANCE_BALANCE_MISMATCH',
      );
      const evidence = {
        cliVersion: '1.0.91',
        mode: 'TEST',
        targets: 2,
        tables: 6,
        movementRecords: [1, 1],
        retainedFailureEvidence: uncertainEvidence,
        recoveryFromOriginalJob: true,
        mixedRequestStates: ['PENDING', 'SYNCED'],
        repeatedJobCreated: 0,
        repeatedBalanceChanges: 0,
        repeatedRemoteChanges: 0,
        reconciliationMatched: results.length,
        formalBasesUsed: false,
        bindingStatus: 'PREPARED',
        destructiveOperations: 0,
      };
      const report = {
        kind: 'ISOLATED_TEST_ACCEPTANCE',
        passed: true,
        generatedAt: new Date().toISOString(),
        evidence,
        evidenceHash: hashCommand(evidence),
      };
      const path = await artifact('acceptance.json', report);
      await database.auditLog.create({
        data: {
          action: 'FEISHU_ISOLATED_ACCEPTANCE',
          entityType: 'OUTBOX_JOB',
          entityId: retainedJob.id,
          after: report,
        },
      });
      console.info(JSON.stringify({ path, ...report }, null, 2));
      return;
    }
    requireCondition(
      (await database.inventoryMovement.count()) === 0 &&
        (await database.inventoryBalance.count()) === 0,
      'ACCEPTANCE_DATABASE_NOT_EMPTY',
    );
    await gateway.validate();
    const bindingService = new FeishuBindingService(database);
    for (const target of ['RING_BASE', 'WATCH_BASE'] as const) {
      await bindingService.savePrepared(
        await new V1SchemaProvisioner(gateway).provision(
          target === 'RING_BASE' ? config.ring : config.watch,
          target,
          'TEST',
        ),
      );
    }
    const localBindings = await database.feishuTableBinding.findMany();
    const yuhang = await database.warehouse.create({
      data: { code: 'YUHANG', name: 'Acceptance Yuhang', publicSlug: 'acceptance-yuhang' },
    });
    const xihu = await database.warehouse.create({
      data: { code: 'XIHU', name: 'Acceptance Xihu', publicSlug: 'acceptance-xihu' },
    });
    const claimant = await database.user.create({
      data: { tenantKey: 'acceptance', name: 'Synthetic operator' },
    });
    const variants = [];
    for (const [index, baseTarget] of (['RING', 'WATCH'] as const).entries()) {
      const category = await database.productCategory.create({
        data: {
          code: baseTarget === 'RING' ? 'SMART_RING' : 'SMART_WATCH',
          name: `Acceptance ${baseTarget}`,
        },
      });
      variants.push(
        await database.productVariant.create({
          data: {
            code: 'DEFAULT',
            variantKey: `acceptance:${baseTarget}`,
            displayName: `Synthetic ${baseTarget}`,
            specificationMode: 'NONE',
            product: {
              create: {
                code: `ACCEPTANCE_${baseTarget}`,
                officialName: `Synthetic ${baseTarget}`,
                baseTarget,
                categoryId: category.id,
                specificationMode: 'NONE',
              },
            },
            balances: {
              create: [yuhang, xihu].map((warehouse) => ({ warehouseId: warehouse.id })),
            },
          },
        }),
      );
      const binding = localBindings.find(
        (item) => item.target === `${baseTarget}_BASE` && item.kind === 'BALANCE',
      )!;
      const ids = binding.fieldIds as Record<string, string>;
      const variant = variants[index]!;
      for (const warehouse of [yuhang, xihu]) {
        const semantic: FeishuFields = {
          stableKey: `${warehouse.id}:${variant.id}`,
          warehouseId: warehouse.id,
          warehouseName: warehouse.name,
          productId: variant.productId,
          productName: `Synthetic ${baseTarget}`,
          variantId: variant.id,
          size: null,
          quantity: 0,
          sequence: 0,
          lastMovementId: null,
          businessNumber: null,
        };
        await gateway.createRecords(binding, [
          Object.fromEntries(Object.entries(semantic).map(([key, value]) => [ids[key]!, value])),
        ]);
      }
    }
    const request = await database.request.create({
      data: {
        requestNumber: `ACCEPTANCE-${randomUUID()}`,
        warehouseId: yuhang.id,
        claimantId: claimant.id,
        origin: 'ONLINE',
        status: 'COMPLETED',
        syncStatus: 'PENDING',
      },
    });
    const batch = await new InventoryService(database).applyMovementBatch(
      {
        businessNumber: request.requestNumber,
        requestId: request.id,
        source: 'ADMIN_INBOUND',
        lines: variants.map((variant) => ({
          warehouseId: yuhang.id,
          variantId: variant.id,
          type: 'INBOUND' as const,
          quantityDelta: 5,
        })),
      },
      randomUUID(),
    );
    const ringMovement = localBindings.find(
      (item) => item.target === 'RING_BASE' && item.kind === 'MOVEMENT',
    )!;
    const create = gateway.createRecords.bind(gateway);
    let injected = false;
    gateway.createRecords = async (table, rows) => {
      const result = await create(table, rows);
      if (table.tableId === ringMovement.tableId && !injected) {
        injected = true;
        throw new FeishuGatewayError('ACCEPTANCE_ACK_INTERRUPTED', 'uncertain');
      }
      return result;
    };
    const sync = (advance = 0) =>
      new FeishuSyncService(database, gateway, {
        environment: 'TEST',
        mode: 'TEST',
        now: () => new Date(Date.now() + advance),
        retryBaseMs: 1000,
        transactionTimeoutMs: 600_000,
      });
    await sync().validateBindings();
    requireCondition(
      (await sync().runOnce(batch.outboxJobId)).retried === 1,
      'ACCEPTANCE_PARTIAL_RETRY_FAILED',
    );
    requireCondition(
      (await database.request.findUniqueOrThrow({ where: { id: request.id } })).syncStatus ===
        'PENDING',
      'ACCEPTANCE_MIXED_STATUS_FAILED',
    );
    gateway.createRecords = create;
    requireCondition(
      (await sync(60_000).runOnce(batch.outboxJobId)).succeeded === 1,
      'ACCEPTANCE_RECOVERY_FAILED',
    );
    requireCondition(
      (await database.request.findUniqueOrThrow({ where: { id: request.id } })).syncStatus ===
        'SYNCED',
      'ACCEPTANCE_REQUEST_STATUS_FAILED',
    );
    const counts = [];
    for (const binding of localBindings.filter((item) => item.kind === 'MOVEMENT')) {
      const page = await gateway.listRecords(binding);
      requireCondition(!page.hasMore && page.records.length === 1, 'ACCEPTANCE_DUPLICATE_MOVEMENT');
      counts.push(page.records.length);
    }
    const before = await database.inventoryBalance.findMany({ orderBy: { id: 'asc' } });
    requireCondition(
      (await sync(60_000).runOnce(batch.outboxJobId)).claimed === 0,
      'ACCEPTANCE_RERUN_CLAIMED',
    );
    requireCondition(
      hashCommand(before) ===
        hashCommand(await database.inventoryBalance.findMany({ orderBy: { id: 'asc' } })),
      'ACCEPTANCE_RERUN_CHANGED_BALANCE',
    );
    const reconciliation = await database.$transaction((tx) =>
      enqueueReconciliation(tx, `acceptance:${randomUUID()}`),
    );
    requireCondition(
      (await sync().runOnce(reconciliation.jobId)).succeeded === 1,
      'ACCEPTANCE_RECONCILIATION_FAILED',
    );
    const results = await database.inventoryReconciliation.findMany({
      where: { jobId: reconciliation.jobId },
    });
    requireCondition(
      results.length === 4 && results.every((item) => item.status === 'MATCHED'),
      'ACCEPTANCE_BALANCE_MISMATCH',
    );
    const evidence = {
      cliVersion: '1.0.91',
      mode: 'TEST',
      targets: 2,
      tables: 6,
      movementRecords: counts,
      actualRemoteWriteThenAckInterrupted: injected,
      newWorkerRecovery: true,
      mixedRequestStates: ['PENDING', 'SYNCED'],
      repeatedJobCreated: 0,
      repeatedBalanceChanges: 0,
      reconciliationMatched: results.length,
      formalBasesUsed: false,
      bindingStatus: 'PREPARED',
      destructiveOperations: 0,
    };
    const report = {
      kind: 'ISOLATED_TEST_ACCEPTANCE',
      passed: true,
      generatedAt: new Date().toISOString(),
      evidence,
      evidenceHash: hashCommand(evidence),
    };
    const path = await artifact('acceptance.json', report);
    await database.auditLog.create({
      data: {
        action: 'FEISHU_ISOLATED_ACCEPTANCE',
        entityType: 'OUTBOX_JOB',
        entityId: batch.outboxJobId,
        after: report,
      },
    });
    console.info(JSON.stringify({ path, ...report }, null, 2));
  } finally {
    await database.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      status: 'FAILED',
      code:
        error instanceof FeishuGatewayError
          ? error.code
          : error instanceof Error && /^ACCEPTANCE_[A-Z_]+$/.test(error.message)
            ? error.message
            : 'ACCEPTANCE_FAILED',
    }),
  );
  process.exitCode = 1;
});
