import type { Prisma, PrismaClient, FeishuTableBinding } from '../generated/prisma/client.js';
import { setTimeout as delay } from 'node:timers/promises';
import { hashCommand } from '../inventory/stable-json.js';
import { feishuFieldsSchema } from '@glorychips/contracts';
import { fieldIdsSchema } from './binding-service.js';
import { FeishuSyncError } from './errors.js';
import { FeishuGatewayError } from './types.js';
import type { FeishuBaseGateway, FeishuFields, FeishuRecord } from './types.js';

export const payloadHash = hashCommand;

export function encodeFields(binding: FeishuTableBinding, fields: FeishuFields): FeishuFields {
  const ids = fieldIdsSchema.parse(binding.fieldIds);
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => {
      const id = ids[key];
      if (!id) throw new FeishuSyncError('SYNC_BINDING_INVALID');
      return [id, value];
    }),
  );
}

export function fieldValue(binding: FeishuTableBinding, record: FeishuRecord, key: string) {
  const id = fieldIdsSchema.parse(binding.fieldIds)[key];
  if (!id) throw new FeishuSyncError('SYNC_BINDING_INVALID');
  return record.fields[id] ?? null;
}

function equalsFields(actual: FeishuFields, expected: FeishuFields): boolean {
  return Object.entries(expected).every(
    ([key, value]) => hashCommand(actual[key] ?? null) === hashCommand(value ?? null),
  );
}

/**
 * Intents commit outside the settlement transaction. An abandoned intent may only
 * be recovered by remote evidence, never by sending a second uncertain write.
 */
export class FeishuRemoteWriter {
  public constructor(
    private readonly database: PrismaClient,
    private readonly gateway: FeishuBaseGateway,
    private readonly leaseToken: string,
    private readonly checkFence: () => Promise<void>,
  ) {}

  public async find(binding: FeishuTableBinding, key: string): Promise<FeishuRecord | null> {
    const fieldId = fieldIdsSchema.parse(binding.fieldIds)['stableKey'];
    if (!fieldId) throw new FeishuSyncError('SYNC_BINDING_INVALID');
    const records = await this.gateway.findRecords(binding, fieldId, key);
    if (records.length > 1) throw new FeishuSyncError('SYNC_REMOTE_CONFLICT');
    return records[0] ?? null;
  }

  public async write(
    binding: FeishuTableBinding,
    intentKey: string,
    fields: FeishuFields,
    recordId?: string,
  ): Promise<FeishuRecord> {
    const encoded = encodeFields(binding, fields);
    const key = fields['stableKey'];
    if (typeof key !== 'string') throw new FeishuSyncError('SYNC_LOCAL_INVARIANT');
    const unique = { bindingId: binding.id, stableKey: intentKey };
    const hash = payloadHash(encoded);
    let intent = await this.database.feishuSyncWrite.findUnique({
      where: { bindingId_stableKey: unique },
    });
    if (intent && intent.payloadHash !== hash) {
      throw new FeishuSyncError('SYNC_REMOTE_CONFLICT');
    }
    const existing = await this.find(binding, key);
    const stableFieldId = fieldIdsSchema.parse(binding.fieldIds)['stableKey']!;
    const unresolved = await this.database.feishuSyncWrite.findMany({
      where: {
        bindingId: binding.id,
        status: { in: ['INTENT', 'UNCERTAIN'] },
        fields: { path: [stableFieldId], equals: key },
      },
    });
    // A changed product payload must not bypass an older, possibly in-flight write.
    for (const pending of unresolved) {
      const pendingFields = feishuFieldsSchema.parse(pending.fields);
      if (!existing || !equalsFields(existing.fields, pendingFields)) {
        throw new FeishuSyncError('SYNC_REMOTE_UNCERTAIN');
      }
      await this.database.feishuSyncWrite.update({
        where: { id: pending.id },
        data: { status: 'CONFIRMED', recordId: existing.recordId },
      });
    }
    if (existing && equalsFields(existing.fields, encoded)) {
      if (recordId && existing.recordId !== recordId) {
        throw new FeishuSyncError('SYNC_REMOTE_CONFLICT');
      }
      if (intent)
        await this.database.feishuSyncWrite.update({
          where: { id: intent.id },
          data: { status: 'CONFIRMED', recordId: existing.recordId },
        });
      return existing;
    }
    if ((!recordId && existing) || (recordId && existing?.recordId !== recordId)) {
      throw new FeishuSyncError('SYNC_REMOTE_CONFLICT');
    }
    if (intent && intent.status !== 'REJECTED')
      throw new FeishuSyncError(
        intent.status === 'CONFIRMED' ? 'SYNC_REMOTE_CONFLICT' : 'SYNC_REMOTE_UNCERTAIN',
      );
    await this.checkFence();
    intent = intent
      ? await this.database.feishuSyncWrite.update({
          where: { id: intent.id },
          data: { status: 'INTENT', ownerToken: this.leaseToken, attempts: { increment: 1 } },
        })
      : await this.database.feishuSyncWrite.create({
          data: {
            ...unique,
            payloadHash: hash,
            fields: encoded as Prisma.InputJsonObject,
            ownerToken: this.leaseToken,
            attempts: 1,
          },
        });
    let acknowledged = false;
    try {
      await this.checkFence();
      if (recordId) {
        await this.gateway.updateRecord(binding, recordId, encoded);
      } else {
        await this.gateway.createRecords(binding, [encoded]);
      }
      acknowledged = true;
      let readback: FeishuRecord | null = null;
      // A successful acknowledgement can precede visibility in the Base query index.
      // Only repeat reads here; never resend the mutation.
      for (let attempt = 0; attempt < 4; attempt++) {
        if (attempt) await delay(500);
        await this.checkFence();
        readback = await this.find(binding, key);
        if (readback && equalsFields(readback.fields, encoded)) break;
      }
      if (!readback || !equalsFields(readback.fields, encoded)) {
        throw new FeishuSyncError('SYNC_REMOTE_UNCERTAIN');
      }
      await this.database.feishuSyncWrite.update({
        where: { id: intent.id },
        data: { status: 'CONFIRMED', recordId: readback.recordId },
      });
      return readback;
    } catch (error) {
      const rejected =
        !acknowledged &&
        error instanceof FeishuGatewayError &&
        error.writeOutcome === 'not-applied';
      const code = rejected ? 'SYNC_REMOTE_REJECTED' : 'SYNC_REMOTE_UNCERTAIN';
      await this.database.feishuSyncWrite.update({
        where: { id: intent.id },
        data: { status: rejected ? 'REJECTED' : 'UNCERTAIN', lastErrorCode: code },
      });
      await this.database.auditLog.create({
        data: {
          action: 'FEISHU_WRITE_FAILED',
          entityType: 'FEISHU_SYNC_WRITE',
          entityId: intent.id,
          after: { code, attempts: intent.attempts, outcome: rejected ? 'not-applied' : 'unknown' },
        },
      });
      throw error;
    }
  }
}
