import { describe, expect, it } from 'vitest';
import { parseMigrationArguments } from './migration-command.js';

describe('controlled migration command arguments', () => {
  it('defaults to prepared shadow mode and supports the pnpm separator', () => {
    expect(parseMigrationArguments(['--', 'plan', '--batch', 'baseline-20260905'])).toMatchObject({
      command: 'plan',
      mode: 'FORMAL_SHADOW',
      batchKey: 'baseline-20260905',
    });
    expect(parseMigrationArguments(['resume', '--mode', 'TEST', '--batch', 'test'])).toMatchObject({
      command: 'resume',
      mode: 'TEST',
    });
  });
  it('rejects path traversal, unknown switches and commands, and an active mode', () => {
    expect(() => parseMigrationArguments(['plan', '--batch', '../outside'])).toThrow(
      'MIGRATION_BATCH_INVALID',
    );
    expect(() => parseMigrationArguments(['activate', '--batch', 'test'])).toThrow(
      'MIGRATION_COMMAND_INVALID',
    );
    expect(() => parseMigrationArguments(['apply', '--batch', 'test', '--mode', 'ACTIVE'])).toThrow(
      'MIGRATION_MODE_INVALID',
    );
    expect(() => parseMigrationArguments(['plan', '--batch', 'test', '--skip-fence'])).toThrow();
  });
});
