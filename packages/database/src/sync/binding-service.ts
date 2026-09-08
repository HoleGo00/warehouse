import { feishuFieldIdsSchema } from '@glorychips/contracts';
import type { OutboxStepTarget } from '@glorychips/contracts';
import type { Prisma, PrismaClient, FeishuTableBinding } from '../generated/prisma/client.js';
import { FeishuSyncError } from './errors.js';
import type { PreparedFeishuBinding, FeishuSyncOptions } from './types.js';
import { hashCommand } from '../inventory/stable-json.js';

export const fieldIdsSchema = feishuFieldIdsSchema;

export class FeishuBindingService {
  public constructor(private readonly database: PrismaClient) {}

  public async savePrepared(
    bindings: readonly PreparedFeishuBinding[],
    actorUserId?: string,
  ): Promise<void> {
    if (bindings.length !== 3 || new Set(bindings.map((item) => item.kind)).size !== 3) {
      throw new FeishuSyncError('SYNC_BINDING_INVALID');
    }
    const first = bindings[0];
    if (
      first === undefined ||
      bindings.some(
        (item) =>
          item.baseToken !== first.baseToken ||
          item.environment !== first.environment ||
          item.target !== first.target ||
          item.schemaVersion !== first.schemaVersion ||
          !Number.isSafeInteger(item.schemaVersion) ||
          item.schemaVersion < 1 ||
          item.schemaFingerprint.length === 0 ||
          !fieldIdsSchema.safeParse(item.fieldIds).success ||
          !item.fieldIds['stableKey'],
      )
    )
      throw new FeishuSyncError('SYNC_BINDING_INVALID');

    await this.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`feishu:${first.baseToken}`}))`;
      for (const input of bindings) {
        const unique = {
          environment: input.environment,
          target: input.target,
          kind: input.kind,
          schemaVersion: input.schemaVersion,
        };
        const existing = await tx.feishuTableBinding.findUnique({
          where: { environment_target_kind_schemaVersion: unique },
        });
        if (
          existing !== null &&
          (existing.baseToken !== input.baseToken ||
            existing.tableId !== input.tableId ||
            existing.schemaFingerprint !== input.schemaFingerprint ||
            existing.status !== 'PREPARED' ||
            hashCommand(fieldIdsSchema.parse(existing.fieldIds)) !== hashCommand(input.fieldIds))
        )
          throw new FeishuSyncError('SYNC_BINDING_INVALID');
        if (existing !== null) continue;
        const binding = await tx.feishuTableBinding.create({
          data: { ...input, fieldIds: { ...input.fieldIds }, status: 'PREPARED' },
        });
        await tx.auditLog.create({
          data: {
            actorUserId,
            action: 'FEISHU_BINDING_PREPARED',
            entityType: 'FEISHU_TABLE_BINDING',
            entityId: binding.id,
            after: {
              target: input.target,
              kind: input.kind,
              environment: input.environment,
              schemaVersion: input.schemaVersion,
              schemaFingerprint: input.schemaFingerprint,
            },
          },
        });
      }
    });
  }
}

export async function loadBindings(
  tx: Prisma.TransactionClient,
  target: OutboxStepTarget,
  options: FeishuSyncOptions,
): Promise<Record<'PRODUCT' | 'BALANCE' | 'MOVEMENT', FeishuTableBinding>> {
  if (
    options.environment === 'FORMAL' &&
    options.mode !== 'ACTIVE' &&
    (options.mode !== 'MIGRATION_SHADOW' || !options.migrationBatchId)
  )
    throw new FeishuSyncError('SYNC_BINDING_INVALID');
  if (options.environment === 'TEST' && options.mode !== 'TEST') {
    throw new FeishuSyncError('SYNC_BINDING_INVALID');
  }
  const bindings = await tx.feishuTableBinding.findMany({
    where: {
      target,
      environment: options.environment,
      status: options.mode === 'ACTIVE' ? 'ACTIVE' : 'PREPARED',
    },
  });
  const product = bindings.find((item) => item.kind === 'PRODUCT');
  const balance = bindings.find((item) => item.kind === 'BALANCE');
  const movement = bindings.find((item) => item.kind === 'MOVEMENT');
  if (
    bindings.length !== 3 ||
    product === undefined ||
    balance === undefined ||
    movement === undefined ||
    bindings.some(
      (item) =>
        item.schemaVersion !== product.schemaVersion || item.baseToken !== product.baseToken,
    )
  )
    throw new FeishuSyncError('SYNC_BINDING_INVALID');
  return { PRODUCT: product, BALANCE: balance, MOVEMENT: movement };
}
