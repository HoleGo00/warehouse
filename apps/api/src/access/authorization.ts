import { AuthDomainError } from '@glorychips/database';
import type { RoleCode, WarehouseCode } from '@glorychips/contracts';
import type { SessionPrincipal } from '@glorychips/database';

export const assertRole = (principal: SessionPrincipal, role: RoleCode): void => {
  if (!principal.roles.includes(role)) {
    throw new AuthDomainError('FORBIDDEN_ROLE', `The ${role} role is required.`);
  }
};

export const assertWarehouseAccess = (
  principal: SessionPrincipal,
  warehouse: WarehouseCode,
): void => {
  if (principal.roles.includes('SYSTEM_ADMIN')) return;
  if (!principal.roles.includes('WAREHOUSE_ADMIN') || !principal.warehouses.includes(warehouse)) {
    throw new AuthDomainError(
      'FORBIDDEN_WAREHOUSE',
      'The requested warehouse is outside the granted scope.',
    );
  }
};
