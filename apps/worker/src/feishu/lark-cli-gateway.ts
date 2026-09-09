import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { delimiter, isAbsolute, join } from 'node:path';
import { FeishuGatewayError } from '@glorychips/database';
import type {
  FeishuBaseGateway,
  FeishuCellValue,
  FeishuField,
  FeishuFields,
  FeishuRecord,
  FeishuRecordPage,
  FeishuTable,
  FeishuTableCoordinate,
} from '@glorychips/database';

export interface LarkCliOptions {
  executable: string;
  profile: 'glorychips-warehouse';
  identity: 'user' | 'bot';
  expectedVersion: '1.0.91';
  timeoutMs: number;
  maxOutputBytes: number;
  allowedBases: readonly string[];
}
export interface ProcessResult {
  code: number | null;
  stdout: string;
}
export type CliExecutor = (
  executable: string,
  args: readonly string[],
  options: Pick<LarkCliOptions, 'timeoutMs' | 'maxOutputBytes'>,
  writing: boolean,
) => Promise<ProcessResult>;

export const executeCli: CliExecutor = (executable, args, options, writing) =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, [...args], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let bytes = 0;
    const output: Buffer[] = [];
    let stopped = false;
    let termination: ReturnType<typeof setTimeout> | undefined;
    const fail = () => {
      if (stopped) return;
      stopped = true;
      child.kill('SIGTERM');
      termination = setTimeout(() => child.kill('SIGKILL'), 1000);
    };
    const timer = setTimeout(fail, options.timeoutMs);
    child.stdout.on('data', (data: Buffer) => {
      bytes += data.length;
      if (bytes > options.maxOutputBytes) fail();
      else output.push(data);
    });
    child.stderr.on('data', (data: Buffer) => {
      bytes += data.length;
      if (bytes > options.maxOutputBytes) fail();
    });
    child.once('error', () => {
      clearTimeout(timer);
      if (termination) clearTimeout(termination);
      reject(new FeishuGatewayError('CLI_EXECUTABLE_UNAVAILABLE', 'permanent'));
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (termination) clearTimeout(termination);
      if (stopped)
        reject(
          new FeishuGatewayError('CLI_PROCESS_INTERRUPTED', writing ? 'uncertain' : 'retryable'),
        );
      else resolve({ code, stdout: Buffer.concat(output).toString('utf8') });
    });
  });

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FeishuGatewayError('CLI_RESPONSE_INVALID', 'permanent');
  }
  return value as Record<string, unknown>;
};
const array = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new FeishuGatewayError('CLI_RESPONSE_INVALID', 'permanent');
  return value;
};
const text = (value: unknown): string => {
  if (typeof value !== 'string') throw new FeishuGatewayError('CLI_RESPONSE_INVALID', 'permanent');
  return value;
};
const integer = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new FeishuGatewayError('CLI_RESPONSE_INVALID', 'permanent');
  }
  return value;
};

export function parseRecordMatrix(value: unknown): FeishuRecordPage {
  const data = object(value);
  const ids = array(data['record_id_list']).map(text);
  const fieldIds = array(data['field_id_list']).map(text);
  const types = array(data['field_type_list']).map(text);
  const rows = array(data['data']);
  if (
    ids.length !== rows.length ||
    types.length !== fieldIds.length ||
    new Set(ids).size !== ids.length ||
    typeof data['has_more'] !== 'boolean'
  ) {
    throw new FeishuGatewayError('CLI_RESPONSE_INVALID', 'permanent');
  }
  const records = rows.map((raw, i): FeishuRecord => {
    const row = array(raw);
    if (row.length !== fieldIds.length)
      throw new FeishuGatewayError('CLI_RESPONSE_INVALID', 'permanent');
    return {
      recordId: ids[i]!,
      fields: Object.fromEntries(
        fieldIds.map((id, j) => {
          const cell = row[j] ?? null;
          if (types[j] === 'number' && cell !== null) {
            const numeric =
              typeof cell === 'number'
                ? cell
                : typeof cell === 'string' && /^-?\d+(?:\.\d+)?$/.test(cell)
                  ? Number(cell)
                  : NaN;
            if (!Number.isFinite(numeric))
              throw new FeishuGatewayError('CLI_RESPONSE_INVALID', 'permanent');
            return [id, numeric];
          }
          if (
            cell !== null &&
            !['string', 'number', 'boolean'].includes(typeof cell) &&
            !Array.isArray(cell)
          ) {
            throw new FeishuGatewayError('CLI_RESPONSE_INVALID', 'permanent');
          }
          return [id, cell as FeishuCellValue];
        }),
      ),
    };
  });
  return { records, hasMore: data['has_more'] };
}

export class LarkCliGateway implements FeishuBaseGateway {
  private executable: string | undefined;
  public constructor(
    private readonly options: LarkCliOptions,
    private readonly exec: CliExecutor = executeCli,
  ) {}

  private async executablePath(): Promise<string> {
    if (this.executable) return this.executable;
    const configured = this.options.executable;
    if (process.platform !== 'win32') return configured;
    // Resolve the installed native binary, not the npm .cmd wrapper or an auto-installer.
    const candidates = isAbsolute(configured)
      ? [configured]
      : (process.env['PATH'] ?? process.env['Path'] ?? '')
          .split(delimiter)
          .flatMap((directory) => [
            join(directory, `${configured}.exe`),
            ...(configured === 'lark-cli'
              ? [join(directory, 'node_modules/@larksuite/cli/bin/lark-cli.exe')]
              : []),
          ]);
    for (const candidate of candidates) {
      if (!candidate.toLowerCase().endsWith('.exe')) continue;
      try {
        await access(candidate);
        this.executable = candidate;
        return candidate;
      } catch {
        /* Next PATH entry. */
      }
    }
    throw new FeishuGatewayError('CLI_EXECUTABLE_UNAVAILABLE', 'permanent');
  }

  public async validate(): Promise<void> {
    const executable = await this.executablePath();
    const version = await this.exec(executable, ['--version'], this.options, false);
    if (
      version.code !== 0 ||
      !new RegExp(
        `(?:^|\\s)v?${this.options.expectedVersion.replaceAll('.', '\\.')}(?:\\s|$)`,
      ).test(version.stdout.trim())
    )
      throw new FeishuGatewayError('CLI_VERSION_MISMATCH', 'permanent');
    // whoami is JSON-only and does not accept --format in the pinned CLI.
    const inspectIdentity = async () => {
      const identity = await this.exec(
        executable,
        ['whoami', '--profile', this.options.profile, '--as', this.options.identity],
        this.options,
        false,
      );
      if (identity.code !== 0)
        throw new FeishuGatewayError('CLI_IDENTITY_UNAVAILABLE', 'permanent');
      let status: Record<string, unknown>;
      try {
        status = object(JSON.parse(identity.stdout));
      } catch {
        throw new FeishuGatewayError('CLI_IDENTITY_UNAVAILABLE', 'permanent');
      }
      if (
        status['profile'] !== this.options.profile ||
        status['identity'] !== this.options.identity ||
        status['available'] !== true
      ) {
        throw new FeishuGatewayError('CLI_IDENTITY_UNAVAILABLE', 'permanent');
      }
      return status['tokenStatus'];
    };
    const tokenStatus = await inspectIdentity();
    if (tokenStatus !== 'ready' && tokenStatus !== 'needs_refresh') {
      throw new FeishuGatewayError('CLI_IDENTITY_UNAVAILABLE', 'permanent');
    }
    for (const base of this.options.allowedBases) await this.listTables(base);
    // A read-only Base request refreshes the pinned CLI's existing token.
    if (tokenStatus === 'needs_refresh' && (await inspectIdentity()) !== 'ready') {
      throw new FeishuGatewayError('CLI_IDENTITY_UNAVAILABLE', 'permanent');
    }
  }

  private coordinates(base: string, table?: string): string[] {
    if (
      !this.options.allowedBases.includes(base) ||
      !/^[A-Za-z0-9]+$/.test(base) ||
      (table !== undefined && !/^tbl[A-Za-z0-9]+$/.test(table))
    ) {
      throw new FeishuGatewayError('CLI_TARGET_FORBIDDEN', 'permanent');
    }
    return ['--base-token', base, ...(table ? ['--table-id', table] : [])];
  }

  private async call(
    operation: string,
    args: readonly string[],
    writing = false,
  ): Promise<Record<string, unknown>> {
    const allowed = [
      '+table-list',
      '+table-create',
      '+field-list',
      '+field-create',
      '+record-list',
      '+record-get',
      '+record-batch-create',
      '+record-upsert',
      '+base-copy',
    ];
    if (!allowed.includes(operation))
      throw new FeishuGatewayError('CLI_OPERATION_FORBIDDEN', 'permanent');
    const result = await this.exec(
      await this.executablePath(),
      [
        'base',
        operation,
        '--profile',
        this.options.profile,
        '--as',
        this.options.identity,
        '--format',
        'json',
        ...args,
      ],
      this.options,
      writing,
    );
    let envelope: Record<string, unknown>;
    try {
      envelope = object(JSON.parse(result.stdout));
    } catch {
      throw new FeishuGatewayError('CLI_RESPONSE_INVALID', writing ? 'uncertain' : 'permanent');
    }
    if (result.code !== 0 || envelope['ok'] !== true) {
      const error =
        typeof envelope['error'] === 'object' && envelope['error'] !== null
          ? object(envelope['error'])
          : {};
      const code = error['code'];
      const rateLimited = code === 429;
      const rejected =
        envelope['ok'] === false && typeof code === 'number' && [401, 403, 429].includes(code);
      const transient = typeof code === 'number' && (rateLimited || (code >= 500 && code < 600));
      throw new FeishuGatewayError(
        transient ? 'CLI_REMOTE_UNAVAILABLE' : 'CLI_REMOTE_REJECTED',
        rejected
          ? rateLimited
            ? 'retryable'
            : 'permanent'
          : writing
            ? 'uncertain'
            : transient
              ? 'retryable'
              : 'permanent',
        writing && rejected ? 'not-applied' : 'unknown',
      );
    }
    return object(envelope['data']);
  }

  public async listTables(baseToken: string): Promise<readonly FeishuTable[]> {
    const data = await this.call('+table-list', this.coordinates(baseToken));
    return array(data['tables']).map((raw) => {
      const item = object(raw);
      return {
        tableId: text(item['id']),
        name: text(item['name']),
        revision: item['rev'] === undefined ? undefined : integer(item['rev']),
        recordCount:
          item['records_count'] === undefined ? undefined : integer(item['records_count']),
      };
    });
  }

  public async copyStructure(
    baseToken: string,
    name: string,
  ): Promise<Readonly<Record<string, unknown>>> {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(name))
      throw new FeishuGatewayError('CLI_COPY_NAME_INVALID', 'permanent');
    return this.call(
      '+base-copy',
      [
        ...this.coordinates(baseToken),
        '--name',
        name,
        '--without-content',
        '--time-zone',
        'Asia/Shanghai',
      ],
      true,
    );
  }

  public async createTable(
    baseToken: string,
    name: string,
    fields: readonly Omit<FeishuField, 'fieldId'>[] = [{ name: '稳定键', type: 'text' }],
  ): Promise<FeishuTable> {
    await this.call(
      '+table-create',
      [
        ...this.coordinates(baseToken),
        '--name',
        name,
        '--fields',
        JSON.stringify(fields.map((field) => ({ name: field.name, type: field.type }))),
      ],
      true,
    );
    const matches = (await this.listTables(baseToken)).filter((table) => table.name === name);
    if (matches.length !== 1) throw new FeishuGatewayError('CLI_SCHEMA_CONFLICT', 'permanent');
    return matches[0]!;
  }

  public async listFields(table: FeishuTableCoordinate): Promise<readonly FeishuField[]> {
    const data = await this.call('+field-list', this.coordinates(table.baseToken, table.tableId));
    return array(data['fields']).map((raw) => {
      const field = object(raw);
      return {
        fieldId: text(field['id']),
        name: text(field['name']),
        type: text(field['type']),
        isPrimary: field['is_primary'] === true,
        property: field,
      };
    });
  }

  public async createField(
    table: FeishuTableCoordinate,
    field: Omit<FeishuField, 'fieldId'>,
  ): Promise<FeishuField> {
    if (!['text', 'number', 'checkbox'].includes(field.type)) {
      throw new FeishuGatewayError('CLI_FIELD_TYPE_FORBIDDEN', 'permanent');
    }
    await this.call(
      '+field-create',
      [
        ...this.coordinates(table.baseToken, table.tableId),
        '--json',
        JSON.stringify({ name: field.name, type: field.type }),
      ],
      true,
    );
    const matches = (await this.listFields(table)).filter(
      (item) => item.name === field.name && item.type === field.type,
    );
    if (matches.length !== 1) throw new FeishuGatewayError('CLI_SCHEMA_CONFLICT', 'permanent');
    return matches[0]!;
  }

  public async listRecords(
    table: FeishuTableCoordinate,
    pageToken = '0',
  ): Promise<FeishuRecordPage> {
    if (!/^\d+$/.test(pageToken)) throw new FeishuGatewayError('CLI_PAGE_INVALID', 'permanent');
    const offset = Number(pageToken);
    const data = await this.call('+record-list', [
      ...this.coordinates(table.baseToken, table.tableId),
      '--offset',
      String(offset),
      '--limit',
      '200',
    ]);
    const page = parseRecordMatrix(data);
    if (page.hasMore && page.records.length === 0)
      throw new FeishuGatewayError('CLI_PAGE_INVALID', 'permanent');
    return { ...page, pageToken: page.hasMore ? String(offset + page.records.length) : undefined };
  }

  public async findRecords(
    table: FeishuTableCoordinate,
    fieldId: string,
    value: string,
  ): Promise<readonly FeishuRecord[]> {
    if (!/^fld[A-Za-z0-9]+$/.test(fieldId))
      throw new FeishuGatewayError('CLI_FIELD_INVALID', 'permanent');
    const found: FeishuRecord[] = [];
    let offset = 0;
    for (;;) {
      const data = await this.call('+record-list', [
        ...this.coordinates(table.baseToken, table.tableId),
        '--filter-json',
        JSON.stringify({ logic: 'and', conditions: [[fieldId, '==', value]] }),
        '--offset',
        String(offset),
        '--limit',
        '200',
      ]);
      const page = parseRecordMatrix(data);
      if (page.records.some((record) => record.fields[fieldId] !== value)) {
        throw new FeishuGatewayError('CLI_FILTER_INVALID', 'permanent');
      }
      found.push(...page.records);
      if (!page.hasMore) return found;
      if (!page.records.length) throw new FeishuGatewayError('CLI_PAGE_INVALID', 'permanent');
      offset += page.records.length;
      if (offset > 100_000) throw new FeishuGatewayError('CLI_PAGE_LIMIT', 'permanent');
    }
  }

  public async getRecord(
    table: FeishuTableCoordinate,
    recordId: string,
  ): Promise<FeishuRecord | null> {
    if (!/^rec[A-Za-z0-9]+$/.test(recordId))
      throw new FeishuGatewayError('CLI_RECORD_INVALID', 'permanent');
    const data = await this.call('+record-get', [
      ...this.coordinates(table.baseToken, table.tableId),
      '--record-id',
      recordId,
    ]);
    return parseRecordMatrix(data).records.find((record) => record.recordId === recordId) ?? null;
  }

  public async createRecords(
    table: FeishuTableCoordinate,
    records: readonly FeishuFields[],
  ): Promise<readonly FeishuRecord[]> {
    if (records.length === 0 || records.length > 200)
      throw new FeishuGatewayError('CLI_BATCH_INVALID', 'permanent');
    await this.call(
      '+record-batch-create',
      [
        ...this.coordinates(table.baseToken, table.tableId),
        '--json',
        JSON.stringify({ create_records: records }),
      ],
      true,
    );
    // The domain writer performs stable-key readback and does not trust mutation acknowledgements.
    return [];
  }

  public async updateRecord(
    table: FeishuTableCoordinate,
    recordId: string,
    fields: FeishuFields,
  ): Promise<FeishuRecord> {
    if (!/^rec[A-Za-z0-9]+$/.test(recordId))
      throw new FeishuGatewayError('CLI_RECORD_INVALID', 'permanent');
    await this.call(
      '+record-upsert',
      [
        ...this.coordinates(table.baseToken, table.tableId),
        '--record-id',
        recordId,
        '--json',
        JSON.stringify(fields),
      ],
      true,
    );
    // The domain writer performs bounded readback for both creates and updates.
    return { recordId, fields };
  }
}
