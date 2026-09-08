import { randomUUID } from 'node:crypto';
import type {
  FeishuBaseGateway,
  FeishuField,
  FeishuFields,
  FeishuRecord,
  FeishuTable,
  FeishuTableCoordinate,
} from '../../src/sync/types.js';

export class FakeFeishuGateway implements FeishuBaseGateway {
  public readonly tables = new Map<
    string,
    { table: FeishuTable; fields: FeishuField[]; rows: Map<string, FeishuRecord> }
  >();
  public creates = 0;
  public updates = 0;
  public afterWrite: ((table: FeishuTableCoordinate) => void) | undefined;
  public beforeWrite: ((table: FeishuTableCoordinate) => void) | undefined;
  private key(table: FeishuTableCoordinate) {
    return `${table.baseToken}:${table.tableId}`;
  }
  public async listTables(base: string) {
    return [...this.tables.entries()]
      .filter(([key]) => key.startsWith(`${base}:`))
      .map(([, value]) => value.table);
  }
  public async createTable(
    baseToken: string,
    name: string,
    fields: readonly Omit<FeishuField, 'fieldId'>[] = [],
  ) {
    const table = { tableId: `tbl${randomUUID().replaceAll('-', '')}`, name, revision: 1 };
    this.tables.set(this.key({ baseToken, ...table }), {
      table,
      fields: fields.map((field, i) => ({ ...field, fieldId: `fld${i}` })),
      rows: new Map(),
    });
    return table;
  }
  public async listFields(table: FeishuTableCoordinate) {
    return this.tables.get(this.key(table))!.fields;
  }
  public async createField(table: FeishuTableCoordinate, field: Omit<FeishuField, 'fieldId'>) {
    const state = this.tables.get(this.key(table))!;
    const created = { ...field, fieldId: `fld${state.fields.length}` };
    state.fields.push(created);
    return created;
  }
  public async listRecords(table: FeishuTableCoordinate) {
    return { records: [...this.tables.get(this.key(table))!.rows.values()], hasMore: false };
  }
  public async findRecords(table: FeishuTableCoordinate, fieldId: string, value: string) {
    return [...this.tables.get(this.key(table))!.rows.values()].filter(
      (record) => record.fields[fieldId] === value,
    );
  }
  public async getRecord(table: FeishuTableCoordinate, recordId: string) {
    return this.tables.get(this.key(table))!.rows.get(recordId) ?? null;
  }
  public async createRecords(table: FeishuTableCoordinate, records: readonly FeishuFields[]) {
    this.beforeWrite?.(table);
    const created = records.map((fields) => ({
      recordId: `rec${randomUUID().replaceAll('-', '')}`,
      fields: structuredClone(fields),
    }));
    for (const record of created)
      this.tables.get(this.key(table))!.rows.set(record.recordId, record);
    this.creates += created.length;
    this.afterWrite?.(table);
    return created;
  }
  public async updateRecord(table: FeishuTableCoordinate, recordId: string, fields: FeishuFields) {
    this.beforeWrite?.(table);
    const record = { recordId, fields: structuredClone(fields) };
    this.tables.get(this.key(table))!.rows.set(recordId, record);
    this.updates++;
    this.afterWrite?.(table);
    return record;
  }
}
