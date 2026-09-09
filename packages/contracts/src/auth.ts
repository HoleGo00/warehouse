import { z } from 'zod';
import { roleCodeSchema, warehouseCodeSchema } from './enums.js';

export const feishuAppIdSchema = z
  .string()
  .regex(/^cli_[A-Za-z0-9]{8,}$/, 'A valid Feishu App ID is required.');

export const isFeishuAppId = (value: unknown): value is string =>
  feishuAppIdSchema.safeParse(value).success;

export const authErrorCodes = [
  'AUTH_REQUIRED',
  'AUTH_STATE_INVALID',
  'AUTH_IDENTITY_CONFLICT',
  'AUTH_UPSTREAM_UNAVAILABLE',
  'FEISHU_TENANT_FORBIDDEN',
  'FEISHU_APP_SCOPE_FORBIDDEN',
  'USER_INACTIVE',
  'USER_NOT_FOUND',
  'FORBIDDEN_ROLE',
  'FORBIDDEN_WAREHOUSE',
  'INVALID_ACCESS_PROFILE',
  'LAST_SYSTEM_ADMIN',
  'VALIDATION_ERROR',
] as const;

export const authErrorCodeSchema = z.enum(authErrorCodes);
export type AuthErrorCode = z.infer<typeof authErrorCodeSchema>;

export const authLoginKinds = ['OAUTH_STATE', 'CLIENT_CHALLENGE'] as const;
export const authLoginKindSchema = z.enum(authLoginKinds);
export type AuthLoginKind = z.infer<typeof authLoginKindSchema>;

export const authSessionUserSchema = z.object({
  id: z.uuid(),
  feishuUserId: z.string().min(1),
  name: z.string().min(1),
  avatarUrl: z.url().nullable(),
});
export type AuthSessionUser = z.infer<typeof authSessionUserSchema>;

export const accessProfileSchema = z.object({
  roles: z.array(roleCodeSchema),
  warehouses: z.array(warehouseCodeSchema),
});
export type AccessProfile = z.infer<typeof accessProfileSchema>;

export const authMeResponseSchema = z.object({
  authenticated: z.literal(true),
  user: authSessionUserSchema,
  access: accessProfileSchema,
  expiresAt: z.iso.datetime(),
});
export type AuthMeResponse = z.infer<typeof authMeResponseSchema>;

export const clientLoginChallengeRequestSchema = z.object({
  returnTo: z.string().optional(),
});
export type ClientLoginChallengeRequest = z.infer<typeof clientLoginChallengeRequestSchema>;

export const clientLoginChallengeResponseSchema = z.object({
  challenge: z.string().min(32),
  expiresAt: z.iso.datetime(),
});
export type ClientLoginChallengeResponse = z.infer<typeof clientLoginChallengeResponseSchema>;

export const clientLoginRequestSchema = z.object({
  code: z.string().min(1).max(4096),
  challenge: z.string().min(32).max(4096),
});
export type ClientLoginRequest = z.infer<typeof clientLoginRequestSchema>;

export const clientLoginResponseSchema = z.object({
  returnTo: z.string(),
  session: authMeResponseSchema,
});
export type ClientLoginResponse = z.infer<typeof clientLoginResponseSchema>;

export const updateAccessRequestSchema = z
  .object({
    roles: z.array(roleCodeSchema),
    warehouses: z.array(warehouseCodeSchema),
  })
  .superRefine((value, context) => {
    const roles = new Set(value.roles);
    const warehouses = new Set(value.warehouses);
    if (!roles.has('CLAIMANT')) {
      context.addIssue({ code: 'custom', message: 'CLAIMANT is required.', path: ['roles'] });
    }
    if (roles.has('WAREHOUSE_ADMIN') !== warehouses.size > 0) {
      context.addIssue({
        code: 'custom',
        message:
          'WAREHOUSE_ADMIN requires at least one warehouse and warehouse scopes require the role.',
        path: ['warehouses'],
      });
    }
    if (roles.size !== value.roles.length) {
      context.addIssue({ code: 'custom', message: 'Roles must be unique.', path: ['roles'] });
    }
    if (warehouses.size !== value.warehouses.length) {
      context.addIssue({
        code: 'custom',
        message: 'Warehouses must be unique.',
        path: ['warehouses'],
      });
    }
  });
export type UpdateAccessRequest = z.infer<typeof updateAccessRequestSchema>;

export const updateAccessResponseSchema = z.object({
  userId: z.uuid(),
  access: accessProfileSchema,
});
export type UpdateAccessResponse = z.infer<typeof updateAccessResponseSchema>;

export const warehouseAccessProbeResponseSchema = z.object({
  allowed: z.literal(true),
  warehouse: warehouseCodeSchema,
});
export type WarehouseAccessProbeResponse = z.infer<typeof warehouseAccessProbeResponseSchema>;

export const warehouseAccessProbeRequestSchema = z.object({
  warehouse: warehouseCodeSchema,
});
export type WarehouseAccessProbeRequest = z.infer<typeof warehouseAccessProbeRequestSchema>;

export const authErrorResponseSchema = z.object({
  code: authErrorCodeSchema,
  message: z.string().min(1),
  traceId: z.uuid(),
});
export type AuthErrorResponse = z.infer<typeof authErrorResponseSchema>;

const knownReturnPathSchema = z.string().refine((value) => {
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return false;
  try {
    const url = new URL(value, 'https://warehouse.invalid');
    return (
      url.origin === 'https://warehouse.invalid' &&
      (url.pathname === '/' ||
        url.pathname === '/admin/access' ||
        url.pathname === '/admin/catalog' ||
        url.pathname === '/admin/requests' ||
        url.pathname === '/admin/inventory/inbound' ||
        url.pathname === '/admin/inventory/transfer' ||
        url.pathname === '/admin/inventory/stocktake' ||
        url.pathname === '/admin/returns' ||
        url.pathname === '/admin/tasks' ||
        url.pathname === '/admin/work-calendar' ||
        url.pathname === '/admin/sync' ||
        url.pathname === '/inventory' ||
        url.pathname === '/requests/me' ||
        /^\/requests\/[0-9a-fA-F-]{36}$/.test(url.pathname) ||
        url.pathname === '/admin/requests/offline' ||
        /^\/w\/(XIHU|YUHANG)\/apply(\/(normal|temporary))?$/.test(url.pathname))
    );
  } catch {
    return false;
  }
});

export const normalizeAuthReturnPath = (value: unknown): string => {
  const result = knownReturnPathSchema.safeParse(value);
  if (!result.success) return '/';
  const url = new URL(result.data, 'https://warehouse.invalid');
  return `${url.pathname}${url.search}`;
};
