import { describe, expect, it, vi } from 'vitest';
import { executeCli, LarkCliGateway, parseRecordMatrix } from './lark-cli-gateway.js';
import type { LarkCliOptions } from './lark-cli-gateway.js';

const options: LarkCliOptions = {
  executable: process.execPath,
  profile: 'glorychips-warehouse',
  identity: 'user',
  expectedVersion: '1.0.91',
  timeoutMs: 1000,
  maxOutputBytes: 4096,
  allowedBases: ['baseexample'],
};
const table = { baseToken: 'baseexample', tableId: 'tblExample' };
const matrix = {
  record_id_list: ['recExample'],
  field_id_list: ['fldKey', 'fldCount'],
  field_type_list: ['text', 'number'],
  data: [['key', '3']],
  has_more: false,
};
const response = (data: unknown) => ({ code: 0, stdout: JSON.stringify({ ok: true, data }) });

describe('LarkCliGateway', () => {
  it('decodes the pinned CLI raw matrix using field IDs, not column names', () => {
    expect(parseRecordMatrix(matrix)).toEqual({
      records: [{ recordId: 'recExample', fields: { fldKey: 'key', fldCount: 3 } }],
      hasMore: false,
    });
    expect(() => parseRecordMatrix({ ...matrix, data: [] })).toThrow('CLI_RESPONSE_INVALID');
    expect(() => parseRecordMatrix({ ...matrix, data: [['key', 'secret']] })).toThrow(
      'CLI_RESPONSE_INVALID',
    );
    expect(() => parseRecordMatrix({ items: [] })).toThrow('CLI_RESPONSE_INVALID');
  });
  it('keeps JSON and shell metacharacters inside a single argv value', async () => {
    const exec = vi.fn().mockResolvedValue(response({}));
    const gateway = new LarkCliGateway(options, exec);
    await gateway.createRecords(table, [{ fldKey: '"; $(touch example) & |' }]);
    const args: string[] = exec.mock.calls[0]![1];
    expect(args.slice(0, 2)).toEqual(['base', '+record-batch-create']);
    expect(JSON.parse(args[args.indexOf('--json') + 1]!)).toEqual({
      create_records: [{ fldKey: '"; $(touch example) & |' }],
    });
    expect(args).toContain('glorychips-warehouse');
    expect(args).toContain('user');
  });
  it('rejects targets and oversized writes before calling the process', async () => {
    const exec = vi.fn();
    const gateway = new LarkCliGateway(options, exec);
    await expect(gateway.listTables('otherbase')).rejects.toThrow('CLI_TARGET_FORBIDDEN');
    await expect(
      gateway.createRecords(
        table,
        Array.from({ length: 201 }, () => ({})),
      ),
    ).rejects.toThrow();
    await expect(gateway.updateRecord(table, '--help', {})).rejects.toThrow('CLI_RECORD_INVALID');
    expect(exec).not.toHaveBeenCalled();
  });
  it('collects every matching page and refuses ignored filters', async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce(response({ ...matrix, has_more: true }))
      .mockResolvedValueOnce(response({ ...matrix, record_id_list: ['recSecond'] }));
    const gateway = new LarkCliGateway(options, exec);
    expect(await gateway.findRecords(table, 'fldKey', 'key')).toHaveLength(2);
    expect(exec.mock.calls[1]![1]).toContain('1');
    exec.mockResolvedValueOnce(response(matrix));
    await expect(gateway.findRecords(table, 'fldKey', 'other')).rejects.toThrow(
      'CLI_FILTER_INVALID',
    );
  });
  it('classifies ambiguous write output without leaking it', async () => {
    const gateway = new LarkCliGateway(
      options,
      vi.fn().mockResolvedValue({ code: 1, stdout: 'secret personal data' }),
    );
    await expect(gateway.createRecords(table, [{ fldKey: 'key' }])).rejects.toMatchObject({
      code: 'CLI_RESPONSE_INVALID',
      kind: 'uncertain',
      message: 'CLI_RESPONSE_INVALID',
    });
  });
  it('only treats explicit authentication/rate rejection as not applied and never guesses provider codes', async () => {
    for (const code of [429, 403, 500, 123456]) {
      const gateway = new LarkCliGateway(
        options,
        vi.fn().mockResolvedValue({
          code: 1,
          stdout: JSON.stringify({ ok: false, error: { code, message: 'secret' } }),
        }),
      );
      await expect(gateway.createRecords(table, [{ fldKey: 'key' }])).rejects.toMatchObject({
        kind: code === 429 ? 'retryable' : code === 403 ? 'permanent' : 'uncertain',
        writeOutcome: code === 429 || code === 403 ? 'not-applied' : 'unknown',
      });
    }
  });
  it('validates the exact CLI version, identity, profile and target access', async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce({ code: 0, stdout: 'lark-cli 1.0.91\n' })
      .mockResolvedValueOnce({
        code: 0,
        stdout: JSON.stringify({
          profile: 'glorychips-warehouse',
          identity: 'user',
          available: true,
          tokenStatus: 'ready',
        }),
      })
      .mockResolvedValueOnce(response({ tables: [] }));
    await new LarkCliGateway(options, exec).validate();
    expect(exec).toHaveBeenCalledTimes(3);
    exec.mockResolvedValueOnce({ code: 0, stdout: 'lark-cli 1.0.93' });
    await expect(new LarkCliGateway(options, exec).validate()).rejects.toThrow(
      'CLI_VERSION_MISMATCH',
    );
  });
  it('refreshes an available identity through read-only target access and verifies readiness again', async () => {
    const identity = (tokenStatus: string) => ({
      code: 0,
      stdout: JSON.stringify({
        profile: options.profile,
        identity: options.identity,
        available: true,
        tokenStatus,
      }),
    });
    const exec = vi
      .fn()
      .mockResolvedValueOnce({ code: 0, stdout: 'lark-cli 1.0.91\n' })
      .mockResolvedValueOnce(identity('needs_refresh'))
      .mockResolvedValueOnce(response({ tables: [] }))
      .mockResolvedValueOnce(identity('ready'));
    await new LarkCliGateway(options, exec).validate();
    expect(exec.mock.calls.map((call) => call[1].slice(0, 2))).toEqual([
      ['--version'],
      ['whoami', '--profile'],
      ['base', '+table-list'],
      ['whoami', '--profile'],
    ]);
    expect(exec.mock.calls.every((call) => call[3] === false)).toBe(true);
  });
  it.each([
    { tokenStatus: 'needs_refresh', profile: options.profile },
    { tokenStatus: 'ready', profile: 'another-profile' },
  ])('fails closed if refreshed identity is not ready and unchanged: %j', async (last) => {
    const identity = {
      identity: options.identity,
      available: true,
      profile: options.profile,
      tokenStatus: 'needs_refresh',
    };
    const exec = vi
      .fn()
      .mockResolvedValueOnce({ code: 0, stdout: 'lark-cli 1.0.91\n' })
      .mockResolvedValueOnce({ code: 0, stdout: JSON.stringify(identity) })
      .mockResolvedValueOnce(response({ tables: [] }))
      .mockResolvedValueOnce({ code: 0, stdout: JSON.stringify({ ...identity, ...last }) });
    await expect(new LarkCliGateway(options, exec).validate()).rejects.toThrow(
      'CLI_IDENTITY_UNAVAILABLE',
    );
  });
  it('does not bypass denied target access while refreshing an existing identity', async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce({ code: 0, stdout: 'lark-cli 1.0.91\n' })
      .mockResolvedValueOnce({
        code: 0,
        stdout: JSON.stringify({
          identity: options.identity,
          available: true,
          profile: options.profile,
          tokenStatus: 'needs_refresh',
        }),
      })
      .mockResolvedValueOnce({
        code: 1,
        stdout: JSON.stringify({ ok: false, error: { code: 403, message: 'secret' } }),
      });
    await expect(new LarkCliGateway(options, exec).validate()).rejects.toThrow();
    expect(exec).toHaveBeenCalledTimes(3);
  });
});

describe('CLI process limits', () => {
  it('passes argv without invoking a shell', async () => {
    const input = '"; & $(example)';
    const result = await executeCli(
      process.execPath,
      ['-e', 'process.stdout.write(process.argv[1])', input],
      { ...options, timeoutMs: 10_000 },
      false,
    );
    expect(result).toEqual({ code: 0, stdout: input });
  }, 15_000);
  it('waits for timeout termination and classifies a write as uncertain', async () => {
    await expect(
      executeCli(
        process.execPath,
        ['-e', 'setInterval(() => {}, 1000)'],
        { timeoutMs: 100, maxOutputBytes: 1024 },
        true,
      ),
    ).rejects.toMatchObject({ kind: 'uncertain' });
  });
  it('bounds combined stdout and stderr without returning secret output', async () => {
    await expect(
      executeCli(
        process.execPath,
        ['-e', 'process.stderr.write("secret".repeat(100000));setInterval(()=>{},1000)'],
        { timeoutMs: 1000, maxOutputBytes: 1024 },
        false,
      ),
    ).rejects.toMatchObject({
      code: 'CLI_PROCESS_INTERRUPTED',
      kind: 'retryable',
    });
  });
});
