import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createDatabaseClient } from '../../src/client.js';

export async function createIsolatedSyncDatabase() {
  const source = new URL(process.env['DATABASE_URL']!);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(source.hostname)) {
    throw new Error('Synchronization integration tests require a local PostgreSQL server.');
  }
  const name = `warehouse_sync_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: source.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  const target = new URL(source);
  target.pathname = `/${name}`;
  const database = createDatabaseClient({ DATABASE_URL: target.toString() });
  const dispose = async () => {
    await database.$disconnect();
    // Only this invocation's newly created database may be removed.
    if (!/^warehouse_sync_test_[a-f0-9]{32}$/.test(name) || source.pathname === `/${name}`) {
      throw new Error('Invalid isolated test database cleanup target.');
    }
    await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  };
  try {
    execFileSync(
      process.execPath,
      [
        createRequire(import.meta.url).resolve('prisma/build/index.js'),
        'migrate',
        'deploy',
        '--config',
        'prisma.config.ts',
      ],
      {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        env: { ...process.env, DATABASE_URL: target.toString() },
        stdio: 'pipe',
        timeout: 60_000,
      },
    );
    await database.warehouse.createMany({
      data: [
        { code: 'YUHANG', name: 'Yuhang', publicSlug: 'sync-test-yuhang' },
        { code: 'XIHU', name: 'Xihu', publicSlug: 'sync-test-xihu' },
      ],
    });
    await database.productCategory.createMany({
      data: [
        { code: 'SMART_RING', name: 'Ring' },
        { code: 'SMART_WATCH', name: 'Watch' },
      ],
    });
    return { database, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}
