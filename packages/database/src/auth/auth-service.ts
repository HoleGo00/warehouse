import { createHash, randomBytes } from 'node:crypto';
import {
  accessProfileSchema,
  authMeResponseSchema,
  roleCodes,
  updateAccessRequestSchema,
  warehouseCodes,
} from '@glorychips/contracts';
import type {
  AccessProfile,
  AuthLoginKind,
  AuthMeResponse,
  RoleCode,
  UpdateAccessRequest,
  WarehouseCode,
} from '@glorychips/contracts';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { AuthDomainError } from './errors.js';
import type {
  AuthBootstrapConfig,
  AuthServicePort,
  ConsumedLoginState,
  CreatedLoginState,
  CreatedSession,
  FeishuIdentity,
  SessionPrincipal,
} from './types.js';

type Transaction = Prisma.TransactionClient;

const INITIAL_SYSTEM_ADMIN = 'INITIAL_SYSTEM_ADMIN';
const SYSTEM_ADMIN_ACCESS_GUARD = 'SYSTEM_ADMIN_ACCESS_GUARD';

const roleOrder = new Map(roleCodes.map((code, index) => [code, index]));
const warehouseOrder = new Map(warehouseCodes.map((code, index) => [code, index]));

export const hashAuthSecret = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

export const createBootstrapConfigDigest = (
  allowedTenantKey: string,
  initialAdminFeishuUserId: string,
): string => hashAuthSecret(`${allowedTenantKey}\0${initialAdminFeishuUserId}`);

const createOpaqueToken = (): string => randomBytes(32).toString('base64url');

const hasErrorCode = (error: unknown, code: string): boolean =>
  error !== null && typeof error === 'object' && Reflect.get(error, 'code') === code;

const sortRoles = (roles: readonly RoleCode[]): RoleCode[] =>
  [...new Set(roles)].sort(
    (left, right) => (roleOrder.get(left) ?? 0) - (roleOrder.get(right) ?? 0),
  );

const sortWarehouses = (warehouses: readonly WarehouseCode[]): WarehouseCode[] =>
  [...new Set(warehouses)].sort(
    (left, right) => (warehouseOrder.get(left) ?? 0) - (warehouseOrder.get(right) ?? 0),
  );

const toKnownWarehouseCodes = (codes: readonly string[]): WarehouseCode[] =>
  sortWarehouses(
    codes.flatMap((code) => {
      const parsed = warehouseCodes.find((knownCode) => knownCode === code);
      return parsed === undefined ? [] : [parsed];
    }),
  );

const profileFromUser = async (
  transaction: Transaction,
  user: {
    readonly userRoles: readonly { readonly role: { readonly code: RoleCode } }[];
    readonly warehouseAdminScopes: readonly {
      readonly warehouse: { readonly code: string };
    }[];
  },
): Promise<AccessProfile> => {
  const roles = sortRoles(user.userRoles.map((item) => item.role.code));
  const warehouses = roles.includes('SYSTEM_ADMIN')
    ? toKnownWarehouseCodes(
        (
          await transaction.warehouse.findMany({
            where: { isActive: true },
            select: { code: true },
          })
        ).map((warehouse) => warehouse.code),
      )
    : toKnownWarehouseCodes(user.warehouseAdminScopes.map((scope) => scope.warehouse.code));
  return accessProfileSchema.parse({ roles, warehouses });
};

const userInclude = {
  userRoles: { include: { role: true } },
  warehouseAdminScopes: { include: { warehouse: true } },
} as const;

export class AuthService implements AuthServicePort {
  public constructor(private readonly database: PrismaClient) {}

  public async createLoginState(
    kind: AuthLoginKind,
    returnTo: string,
    ttlSeconds: number,
  ): Promise<CreatedLoginState> {
    const value = createOpaqueToken();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1_000);
    await this.database.authLoginState.create({
      data: { digest: hashAuthSecret(value), kind, returnTo, expiresAt },
    });
    return { value, expiresAt };
  }

  public async consumeLoginState(kind: AuthLoginKind, value: string): Promise<ConsumedLoginState> {
    const digest = hashAuthSecret(value);
    return this.database.$transaction(async (transaction) => {
      const consumedAt = new Date();
      const result = await transaction.authLoginState.updateMany({
        where: { digest, kind, consumedAt: null, expiresAt: { gt: consumedAt } },
        data: { consumedAt },
      });
      if (result.count !== 1) {
        throw new AuthDomainError('AUTH_STATE_INVALID', 'The login state is invalid or expired.');
      }
      const state = await transaction.authLoginState.findUniqueOrThrow({ where: { digest } });
      return { returnTo: state.returnTo };
    });
  }

  public async authenticate(
    identity: FeishuIdentity,
    bootstrap: AuthBootstrapConfig,
    sessionTtlSeconds: number,
  ): Promise<CreatedSession> {
    this.assertFeishuIdentity(identity, bootstrap.allowedTenantKey);
    const token = createOpaqueToken();
    const tokenDigest = hashAuthSecret(token);

    try {
      const me = await this.database.$transaction(async (transaction) => {
        const user = await this.bindUser(transaction, identity);
        await this.applyInitialAdministrator(transaction, user.id, identity, bootstrap);
        const expiresAt = new Date(Date.now() + sessionTtlSeconds * 1_000);
        await transaction.authSession.create({
          data: { tokenDigest, userId: user.id, expiresAt },
        });
        const refreshedUser = await transaction.user.findUniqueOrThrow({
          where: { id: user.id },
          include: userInclude,
        });
        return this.toMe(
          refreshedUser,
          await profileFromUser(transaction, refreshedUser),
          expiresAt,
        );
      });
      return { token, me };
    } catch (error: unknown) {
      if (hasErrorCode(error, 'P2002')) {
        throw new AuthDomainError(
          'AUTH_IDENTITY_CONFLICT',
          'The Feishu identity conflicts with an existing user.',
        );
      }
      throw error;
    }
  }

  public async loadSession(token: string): Promise<SessionPrincipal> {
    const tokenDigest = hashAuthSecret(token);
    return this.database.$transaction(async (transaction) => {
      const session = await transaction.authSession.findUnique({
        where: { tokenDigest },
        include: { user: { include: userInclude } },
      });
      const now = new Date();
      if (session === null || session.revokedAt !== null || session.expiresAt <= now) {
        throw new AuthDomainError('AUTH_REQUIRED', 'A valid session is required.');
      }
      if (session.user.status !== 'ACTIVE') {
        throw new AuthDomainError('USER_INACTIVE', 'The local user is inactive.');
      }
      await transaction.authSession.update({
        where: { id: session.id },
        data: { lastSeenAt: now },
      });
      const profile = await profileFromUser(transaction, session.user);
      return {
        sessionId: session.id,
        userId: session.user.id,
        feishuUserId: session.user.feishuUserId ?? '',
        name: session.user.name,
        avatarUrl: session.user.avatarUrl,
        roles: profile.roles,
        warehouses: profile.warehouses,
        expiresAt: session.expiresAt,
      };
    });
  }

  public async logout(token: string): Promise<void> {
    const tokenDigest = hashAuthSecret(token);
    await this.database.$transaction(async (transaction) => {
      const session = await transaction.authSession.findUnique({ where: { tokenDigest } });
      if (session === null || session.revokedAt !== null) return;
      const revokedAt = new Date();
      await transaction.authSession.update({
        where: { id: session.id },
        data: { revokedAt },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: session.userId,
          action: 'AUTH_SESSION_LOGOUT',
          entityType: 'AUTH_SESSION',
          entityId: session.id,
          after: { revokedAt: revokedAt.toISOString() },
        },
      });
    });
  }

  public async updateAccess(
    actorUserId: string,
    targetUserId: string,
    rawAccess: UpdateAccessRequest,
  ): Promise<AccessProfile> {
    const access = updateAccessRequestSchema.parse(rawAccess);
    return this.database.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${targetUserId}::uuid FOR UPDATE`;
      const actor = await transaction.user.findUnique({
        where: { id: actorUserId },
        include: userInclude,
      });
      if (
        actor === null ||
        actor.status !== 'ACTIVE' ||
        !actor.userRoles.some((item) => item.role.code === 'SYSTEM_ADMIN')
      ) {
        throw new AuthDomainError('FORBIDDEN_ROLE', 'System administrator role is required.');
      }
      const target = await transaction.user.findUnique({
        where: { id: targetUserId },
        include: userInclude,
      });
      if (target === null) {
        throw new AuthDomainError('USER_NOT_FOUND', 'The target user was not found.');
      }

      const before = await profileFromUser(transaction, target);
      if (
        target.status === 'ACTIVE' &&
        before.roles.includes('SYSTEM_ADMIN') &&
        !access.roles.includes('SYSTEM_ADMIN')
      ) {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SYSTEM_ADMIN_ACCESS_GUARD}))`;
        const activeSystemAdministrators = await transaction.user.count({
          where: {
            status: 'ACTIVE',
            userRoles: { some: { role: { code: 'SYSTEM_ADMIN' } } },
          },
        });
        if (activeSystemAdministrators <= 1) {
          throw new AuthDomainError(
            'LAST_SYSTEM_ADMIN',
            'The last active system administrator cannot be removed.',
          );
        }
      }

      const roles = await transaction.role.findMany({
        where: { code: { in: access.roles } },
      });
      if (roles.length !== access.roles.length) {
        throw new AuthDomainError('INVALID_ACCESS_PROFILE', 'One or more roles do not exist.');
      }
      const warehouses = await transaction.warehouse.findMany({
        where: { code: { in: access.warehouses }, isActive: true },
      });
      if (warehouses.length !== access.warehouses.length) {
        throw new AuthDomainError(
          'INVALID_ACCESS_PROFILE',
          'One or more warehouses do not exist or are inactive.',
        );
      }

      await transaction.userRole.deleteMany({ where: { userId: targetUserId } });
      await transaction.userRole.createMany({
        data: roles.map((role) => ({ userId: targetUserId, roleId: role.id })),
      });
      await transaction.warehouseAdminScope.deleteMany({ where: { userId: targetUserId } });
      if (warehouses.length > 0) {
        await transaction.warehouseAdminScope.createMany({
          data: warehouses.map((warehouse) => ({
            userId: targetUserId,
            warehouseId: warehouse.id,
          })),
        });
      }

      const updated = await transaction.user.findUniqueOrThrow({
        where: { id: targetUserId },
        include: userInclude,
      });
      const after = await profileFromUser(transaction, updated);
      await transaction.auditLog.create({
        data: {
          actorUserId,
          action: 'USER_ACCESS_UPDATED',
          entityType: 'USER',
          entityId: targetUserId,
          before: { roles: before.roles, warehouses: before.warehouses },
          after: { roles: after.roles, warehouses: after.warehouses },
        },
      });
      return after;
    });
  }

  private assertFeishuIdentity(identity: FeishuIdentity, allowedTenantKey: string): void {
    if (identity.tenantKey !== allowedTenantKey) {
      throw new AuthDomainError('FEISHU_TENANT_FORBIDDEN', 'The Feishu tenant is not allowed.');
    }
    if (!identity.isInAppScope) {
      throw new AuthDomainError(
        'FEISHU_APP_SCOPE_FORBIDDEN',
        'The user is outside the application scope.',
      );
    }
    if (!identity.isActive) {
      throw new AuthDomainError('USER_INACTIVE', 'The Feishu employee is inactive.');
    }
  }

  private async bindUser(transaction: Transaction, identity: FeishuIdentity) {
    const [openIdOwner, unionIdOwner] = await Promise.all([
      transaction.user.findUnique({ where: { feishuOpenId: identity.openId } }),
      identity.unionId === undefined
        ? Promise.resolve(null)
        : transaction.user.findFirst({
            where: { tenantKey: identity.tenantKey, feishuUnionId: identity.unionId },
          }),
    ]);
    if (
      (openIdOwner !== null && openIdOwner.feishuUserId !== identity.userId) ||
      (unionIdOwner !== null && unionIdOwner.feishuUserId !== identity.userId)
    ) {
      throw new AuthDomainError(
        'AUTH_IDENTITY_CONFLICT',
        'The Feishu identity conflicts with an existing user.',
      );
    }

    const user = await transaction.user.upsert({
      where: { feishuUserId: identity.userId },
      create: {
        tenantKey: identity.tenantKey,
        feishuUserId: identity.userId,
        feishuOpenId: identity.openId,
        feishuUnionId: identity.unionId,
        name: identity.name,
        avatarUrl: identity.avatarUrl,
        departmentSnapshot:
          identity.departments === undefined ? undefined : [...identity.departments],
        lastLoginAt: new Date(),
      },
      update: {
        tenantKey: identity.tenantKey,
        feishuOpenId: identity.openId,
        feishuUnionId: identity.unionId,
        name: identity.name,
        avatarUrl: identity.avatarUrl,
        departmentSnapshot:
          identity.departments === undefined ? undefined : [...identity.departments],
        lastLoginAt: new Date(),
      },
    });
    if (user.status !== 'ACTIVE') {
      throw new AuthDomainError('USER_INACTIVE', 'The local user is inactive.');
    }
    if (user.tenantKey !== identity.tenantKey) {
      throw new AuthDomainError(
        'AUTH_IDENTITY_CONFLICT',
        'The stable user identifier belongs to another tenant.',
      );
    }
    const claimant = await transaction.role.findUniqueOrThrow({ where: { code: 'CLAIMANT' } });
    await transaction.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: claimant.id } },
      create: { userId: user.id, roleId: claimant.id },
      update: {},
    });
    return user;
  }

  private async applyInitialAdministrator(
    transaction: Transaction,
    userId: string,
    identity: FeishuIdentity,
    bootstrap: AuthBootstrapConfig,
  ): Promise<void> {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${INITIAL_SYSTEM_ADMIN}))`;
    const event = await transaction.systemBootstrapEvent.findUnique({
      where: { key: INITIAL_SYSTEM_ADMIN },
    });
    if (event !== null) return;
    if (
      identity.tenantKey !== bootstrap.allowedTenantKey ||
      identity.userId !== bootstrap.initialAdminFeishuUserId
    ) {
      return;
    }

    const systemAdministrator = await transaction.role.findUniqueOrThrow({
      where: { code: 'SYSTEM_ADMIN' },
    });
    await transaction.userRole.upsert({
      where: { userId_roleId: { userId, roleId: systemAdministrator.id } },
      create: { userId, roleId: systemAdministrator.id },
      update: {},
    });
    const createdEvent = await transaction.systemBootstrapEvent.create({
      data: {
        key: INITIAL_SYSTEM_ADMIN,
        userId,
        tenantKey: identity.tenantKey,
        configVersionDigest: bootstrap.configVersionDigest,
      },
    });
    await transaction.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'INITIAL_SYSTEM_ADMIN_GRANTED',
        entityType: 'SYSTEM_BOOTSTRAP_EVENT',
        entityId: createdEvent.id,
        after: {
          key: INITIAL_SYSTEM_ADMIN,
          tenantKey: identity.tenantKey,
          configVersionDigest: bootstrap.configVersionDigest,
        },
      },
    });
  }

  private toMe(
    user: {
      readonly id: string;
      readonly feishuUserId: string | null;
      readonly name: string;
      readonly avatarUrl: string | null;
    },
    access: AccessProfile,
    expiresAt: Date,
  ): AuthMeResponse {
    if (user.feishuUserId === null) {
      throw new AuthDomainError('AUTH_IDENTITY_CONFLICT', 'The user has no Feishu identity.');
    }
    return authMeResponseSchema.parse({
      authenticated: true,
      user: {
        id: user.id,
        feishuUserId: user.feishuUserId,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
      access,
      expiresAt: expiresAt.toISOString(),
    });
  }
}
