import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AuthDomainError,
  AuthService,
  createBootstrapConfigDigest,
  createDatabaseClient,
  hashAuthSecret,
} from '../src/index.js';
import type { FeishuIdentity } from '../src/index.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';

const databaseUrl = process.env['DATABASE_URL'];
const integrationEnabled = databaseUrl !== undefined && databaseUrl.length > 0;
const tenantKey = 'tenant-it-auth';

const identity = (userId: string): FeishuIdentity => ({
  tenantKey,
  userId,
  openId: `open-${userId}`,
  unionId: `union-${userId}`,
  name: `User ${userId}`,
  avatarUrl: 'https://example.com/avatar.png',
  departments: ['Warehouse'],
  isInAppScope: true,
  isActive: true,
});

describe.skipIf(!integrationEnabled)('AuthService PostgreSQL integration', () => {
  let database: PrismaClient;
  let auth: AuthService;

  const bootstrapFor = (userId: string) => ({
    allowedTenantKey: tenantKey,
    initialAdminFeishuUserId: userId,
    configVersionDigest: createBootstrapConfigDigest(tenantKey, userId),
  });

  const clean = async (): Promise<void> => {
    const users = await database.user.findMany({
      where: { tenantKey },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    await database.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
    await database.systemBootstrapEvent.deleteMany({
      where: { key: 'INITIAL_SYSTEM_ADMIN' },
    });
    await database.user.deleteMany({ where: { id: { in: userIds } } });
    await database.authLoginState.deleteMany({});
  };

  beforeAll(() => {
    database = createDatabaseClient();
    auth = new AuthService(database);
  });

  beforeEach(clean);

  afterAll(async () => {
    await clean();
    await database.$disconnect();
  });

  it('consumes login state exactly once without storing the plaintext value', async () => {
    const created = await auth.createLoginState('OAUTH_STATE', '/w/XIHU/apply', 600);
    const stored = await database.authLoginState.findFirstOrThrow();
    expect(stored.digest).toBe(hashAuthSecret(created.value));
    expect(stored.digest).not.toContain(created.value);
    await expect(auth.consumeLoginState('OAUTH_STATE', created.value)).resolves.toEqual({
      returnTo: '/w/XIHU/apply',
    });
    await expect(auth.consumeLoginState('OAUTH_STATE', created.value)).rejects.toMatchObject({
      code: 'AUTH_STATE_INVALID',
    });
  });

  it('binds both login paths to one user and stores only session digests', async () => {
    const employee = identity('employee-one');
    const first = await auth.authenticate(employee, bootstrapFor('another-user'), 3_600);
    const second = await auth.authenticate(employee, bootstrapFor('another-user'), 3_600);

    expect(second.me.user.id).toBe(first.me.user.id);
    expect(await database.user.count({ where: { tenantKey } })).toBe(1);
    expect(await database.authSession.count()).toBe(2);
    expect(await database.authSession.count({ where: { tokenDigest: first.token } })).toBe(0);
  });

  it('allows only one concurrent initial administrator bootstrap event', async () => {
    const administrator = identity('initial-admin');
    const results = await Promise.all([
      auth.authenticate(administrator, bootstrapFor(administrator.userId), 3_600),
      auth.authenticate(administrator, bootstrapFor(administrator.userId), 3_600),
    ]);

    expect(results[0]?.me.user.id).toBe(results[1]?.me.user.id);
    expect(await database.systemBootstrapEvent.count()).toBe(1);
    expect(
      await database.userRole.count({
        where: {
          user: { tenantKey },
          role: { code: 'SYSTEM_ADMIN' },
        },
      }),
    ).toBe(1);
    expect(
      await database.auditLog.count({ where: { action: 'INITIAL_SYSTEM_ADMIN_GRANTED' } }),
    ).toBe(1);
  });

  it('enforces active identity, access matrix, audit, and last-admin protection', async () => {
    await expect(
      auth.authenticate(
        { ...identity('external'), tenantKey: 'external-tenant' },
        bootstrapFor('initial-admin'),
        3_600,
      ),
    ).rejects.toMatchObject({ code: 'FEISHU_TENANT_FORBIDDEN' });
    await expect(
      auth.authenticate(
        { ...identity('out-of-scope'), isInAppScope: false },
        bootstrapFor('initial-admin'),
        3_600,
      ),
    ).rejects.toMatchObject({ code: 'FEISHU_APP_SCOPE_FORBIDDEN' });

    const admin = await auth.authenticate(
      identity('initial-admin'),
      bootstrapFor('initial-admin'),
      3_600,
    );
    const employee = await auth.authenticate(
      identity('warehouse-admin'),
      bootstrapFor('initial-admin'),
      3_600,
    );
    const access = await auth.updateAccess(admin.me.user.id, employee.me.user.id, {
      roles: ['CLAIMANT', 'WAREHOUSE_ADMIN'],
      warehouses: ['XIHU'],
    });
    expect(access).toEqual({
      roles: ['CLAIMANT', 'WAREHOUSE_ADMIN'],
      warehouses: ['XIHU'],
    });
    expect(
      await database.auditLog.count({
        where: { action: 'USER_ACCESS_UPDATED', entityId: employee.me.user.id },
      }),
    ).toBe(1);

    await expect(
      auth.updateAccess(admin.me.user.id, admin.me.user.id, {
        roles: ['CLAIMANT'],
        warehouses: [],
      }),
    ).rejects.toBeInstanceOf(AuthDomainError);
    await expect(
      auth.updateAccess(admin.me.user.id, admin.me.user.id, {
        roles: ['CLAIMANT'],
        warehouses: [],
      }),
    ).rejects.toMatchObject({ code: 'LAST_SYSTEM_ADMIN' });

    await database.user.update({
      where: { id: employee.me.user.id },
      data: { status: 'INACTIVE' },
    });
    await expect(auth.loadSession(employee.token)).rejects.toMatchObject({
      code: 'USER_INACTIVE',
    });
  });

  it('serializes concurrent system administrator removals', async () => {
    const first = await auth.authenticate(
      identity('concurrent-admin-one'),
      bootstrapFor('concurrent-admin-one'),
      3_600,
    );
    const second = await auth.authenticate(
      identity('concurrent-admin-two'),
      bootstrapFor('concurrent-admin-one'),
      3_600,
    );
    await auth.updateAccess(first.me.user.id, second.me.user.id, {
      roles: ['CLAIMANT', 'SYSTEM_ADMIN'],
      warehouses: [],
    });

    const removals = await Promise.allSettled([
      auth.updateAccess(first.me.user.id, first.me.user.id, {
        roles: ['CLAIMANT'],
        warehouses: [],
      }),
      auth.updateAccess(second.me.user.id, second.me.user.id, {
        roles: ['CLAIMANT'],
        warehouses: [],
      }),
    ]);

    expect(removals.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(removals.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(
      await database.userRole.count({
        where: {
          user: { tenantKey, status: 'ACTIVE' },
          role: { code: 'SYSTEM_ADMIN' },
        },
      }),
    ).toBe(1);
  });
});
