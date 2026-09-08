import { describe, expect, it, vi } from 'vitest';
import type { FeishuBaseGateway, FeishuField } from '@glorychips/database';
import { V1SchemaProvisioner } from './v1-schema.js';

const fake = () => {
  const tables = new Map<string, { name: string; fields: FeishuField[] }>();
  const gateway = {
    listTables: async () => [...tables].map(([tableId, item]) => ({ tableId, name: item.name })),
    listFields: async (table: { tableId: string }) => tables.get(table.tableId)!.fields,
    createTable: vi.fn(
      async (_base: string, name: string, fields: Omit<FeishuField, 'fieldId'>[]) => {
        const tableId = `tbl${tables.size}`;
        tables.set(tableId, {
          name,
          fields: fields.map((field, i) => ({ ...field, fieldId: `fld${i}` })),
        });
        return { tableId, name };
      },
    ),
  };
  return { gateway: gateway as unknown as FeishuBaseGateway, tables };
};

describe('V1 schema provisioner', () => {
  it('plans without writes and reuses exactly the same provisioned schema', async () => {
    const { gateway, tables } = fake();
    const provisioner = new V1SchemaProvisioner(gateway);
    expect((await provisioner.plan('ringexample')).map((item) => item.action)).toEqual([
      'CREATE',
      'CREATE',
      'CREATE',
    ]);
    expect(tables.size).toBe(0);
    const first = await provisioner.provision('ringexample', 'RING_BASE', 'TEST');
    expect(first).toHaveLength(3);
    expect(await provisioner.provision('ringexample', 'RING_BASE', 'TEST')).toEqual(first);
    expect(tables.size).toBe(3);
  });
  it('rejects same-name incomplete schemas and formula balance fields without writes', async () => {
    const { gateway, tables } = fake();
    const provisioner = new V1SchemaProvisioner(gateway);
    const bindings = await provisioner.provision('ringexample', 'RING_BASE', 'TEST');
    const balance = bindings.find((item) => item.kind === 'BALANCE')!;
    const fields = tables.get(balance.tableId)!.fields;
    const index = fields.findIndex((item) => item.name === '当前库存');
    fields[index] = { ...fields[index]!, type: 'formula' };
    await expect(provisioner.plan('ringexample')).rejects.toThrow('CLI_SCHEMA_CONFLICT');
    expect(tables.size).toBe(3);
  });
});
