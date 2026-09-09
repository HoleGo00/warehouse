import { FeishuGatewayError, feishuSchemaFingerprint } from '@glorychips/database';
import type { FeishuBaseGateway, FeishuField, PreparedFeishuBinding } from '@glorychips/database';

type Kind = PreparedFeishuBinding['kind'];
type Definition = { key: string; name: string; type: string };
const field = (key: string, name: string, type = 'text'): Definition => ({ key, name, type });
const common = [
  field('stableKey', '稳定键'),
  field('productId', '产品ID'),
  field('productName', '正式名称'),
];
export const v1Schema: Readonly<Record<Kind, { name: string; fields: readonly Definition[] }>> = {
  PRODUCT: {
    name: '产品资料 V1',
    fields: [...common, field('category', '商品大类'), field('active', '启用状态', 'checkbox')],
  },
  BALANCE: {
    name: '仓库库存余额 V1',
    fields: [
      ...common,
      field('warehouseId', '仓库ID'),
      field('warehouseName', '仓库名称'),
      field('variantId', '规格ID'),
      field('size', '尺码'),
      field('quantity', '当前库存', 'number'),
      field('sequence', '同步版本', 'number'),
      field('lastMovementId', '最后流水ID'),
      field('businessNumber', '最后业务单号'),
    ],
  },
  MOVEMENT: {
    name: '库存流水 V1',
    fields: [
      ...common,
      field('movementId', '流水ID'),
      field('businessNumber', '业务单号'),
      field('warehouseId', '仓库ID'),
      field('variantId', '规格ID'),
      field('size', '尺码'),
      field('type', '流水类型'),
      field('source', '业务来源'),
      field('delta', '数量变化', 'number'),
      field('before', '变化前数量', 'number'),
      field('after', '变化后数量', 'number'),
      field('sequence', '事务顺序', 'number'),
      field('actorName', '操作人快照'),
      field('actorFeishuUserId', '操作人飞书ID'),
      field('occurredAt', '发生时间'),
      field('sourceTableId', '旧表ID'),
      field('sourceRecordId', '旧记录ID'),
      field('sourceName', '原始名称'),
      field('migrationBatchId', '迁移批次'),
      field('historyOrderRebuilt', '历史顺序重建', 'checkbox'),
      field('payloadHash', '内容哈希'),
    ],
  },
};

export const schemaFingerprint = feishuSchemaFingerprint;

export interface SchemaPlan {
  kind: Kind;
  name: string;
  action: 'CREATE' | 'REUSE';
  tableId?: string;
}

export class V1SchemaProvisioner {
  public constructor(private readonly gateway: FeishuBaseGateway) {}
  public async plan(base: string): Promise<SchemaPlan[]> {
    const tables = await this.gateway.listTables(base);
    const result: SchemaPlan[] = [];
    for (const kind of ['PRODUCT', 'BALANCE', 'MOVEMENT'] as const) {
      const definition = v1Schema[kind];
      const existing = tables.filter((item) => item.name === definition.name);
      if (existing.length > 1) throw new FeishuGatewayError('CLI_SCHEMA_CONFLICT', 'permanent');
      const table = existing[0];
      if (table)
        this.verify(
          kind,
          await this.gateway.listFields({ baseToken: base, tableId: table.tableId }),
        );
      result.push({
        kind,
        name: definition.name,
        action: table ? 'REUSE' : 'CREATE',
        tableId: table?.tableId,
      });
    }
    return result;
  }
  private verify(kind: Kind, fields: readonly FeishuField[]): Record<string, string> {
    const expected = v1Schema[kind].fields;
    if (
      fields.length !== expected.length ||
      new Set(fields.map((item) => item.fieldId)).size !== fields.length
    ) {
      throw new FeishuGatewayError('CLI_SCHEMA_CONFLICT', 'permanent');
    }
    return Object.fromEntries(
      expected.map((definition) => {
        const matches = fields.filter(
          (item) => item.name === definition.name && item.type === definition.type,
        );
        if (matches.length !== 1) throw new FeishuGatewayError('CLI_SCHEMA_CONFLICT', 'permanent');
        return [definition.key, matches[0]!.fieldId];
      }),
    );
  }
  public async provision(
    baseToken: string,
    target: PreparedFeishuBinding['target'],
    environment: PreparedFeishuBinding['environment'],
  ): Promise<PreparedFeishuBinding[]> {
    const plans = await this.plan(baseToken);
    const bindings: PreparedFeishuBinding[] = [];
    for (const plan of plans) {
      const tableId =
        plan.tableId ??
        (await this.gateway.createTable(baseToken, plan.name, v1Schema[plan.kind].fields)).tableId;
      const fields = await this.gateway.listFields({ baseToken, tableId });
      bindings.push({
        baseToken,
        tableId,
        target,
        environment,
        kind: plan.kind,
        schemaVersion: 1,
        schemaFingerprint: schemaFingerprint(fields),
        fieldIds: this.verify(plan.kind, fields),
      });
    }
    return bindings;
  }
}
