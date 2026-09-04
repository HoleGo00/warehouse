import type {
  AccessProfile,
  AuthLoginKind,
  AuthMeResponse,
  RoleCode,
  UpdateAccessRequest,
  WarehouseCode,
} from '@glorychips/contracts';

export interface FeishuIdentity {
  readonly tenantKey: string;
  readonly userId: string;
  readonly openId: string;
  readonly unionId?: string;
  readonly name: string;
  readonly avatarUrl?: string;
  readonly departments?: readonly string[];
  readonly isInAppScope: boolean;
  readonly isActive: boolean;
}

export interface AuthBootstrapConfig {
  readonly allowedTenantKey: string;
  readonly initialAdminFeishuUserId: string;
  readonly configVersionDigest: string;
}

export interface CreatedLoginState {
  readonly value: string;
  readonly expiresAt: Date;
}

export interface ConsumedLoginState {
  readonly returnTo: string;
}

export interface CreatedSession {
  readonly token: string;
  readonly me: AuthMeResponse;
}

export interface SessionPrincipal {
  readonly sessionId: string;
  readonly userId: string;
  readonly feishuUserId: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly roles: readonly RoleCode[];
  readonly warehouses: readonly WarehouseCode[];
  readonly expiresAt: Date;
}

export interface AuthServicePort {
  createLoginState(
    kind: AuthLoginKind,
    returnTo: string,
    ttlSeconds: number,
  ): Promise<CreatedLoginState>;
  consumeLoginState(kind: AuthLoginKind, value: string): Promise<ConsumedLoginState>;
  authenticate(
    identity: FeishuIdentity,
    bootstrap: AuthBootstrapConfig,
    sessionTtlSeconds: number,
  ): Promise<CreatedSession>;
  loadSession(token: string): Promise<SessionPrincipal>;
  logout(token: string): Promise<void>;
  updateAccess(
    actorUserId: string,
    targetUserId: string,
    access: UpdateAccessRequest,
  ): Promise<AccessProfile>;
}
