import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { finished } from 'node:stream/promises';
import { ExportStorage } from './export-storage.js';
describe('private export storage', () => {
  it('publishes atomically, rejects traversal and retains unrelated files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'warehouse-export-test-'));
    try {
      const storage = new ExportStorage(root);
      await storage.initialize();
      const stem = `${randomUUID()}.${randomUUID()}`;
      const out = await storage.writer(`${stem}.partial`);
      out.end('xlsx-test');
      await finished(out);
      await storage.publish(`${stem}.partial`, `${stem}.xlsx`);
      expect((await storage.info(`${stem}.xlsx`)).size).toBe(9);
      await expect(storage.reader('../outside.xlsx')).rejects.toThrow();
      await writeFile(join(root, 'unrelated.txt'), 'retained');
      expect(await storage.files()).toHaveLength(1);
      await storage.remove(`${stem}.xlsx`);
      expect(await storage.files()).toEqual([]);
    } finally {
      await rm(root, { recursive: true });
    }
  });
  it('rejects a symlink root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'warehouse-export-link-test-'));
    const link = `${root}-link`;
    try {
      await symlink(root, link, process.platform === 'win32' ? 'junction' : 'dir');
      await expect(new ExportStorage(link).initialize()).rejects.toThrow();
    } finally {
      await rm(link, { force: true, recursive: true });
      await rm(root, { recursive: true });
    }
  });
});
