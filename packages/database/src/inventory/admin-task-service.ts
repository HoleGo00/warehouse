import {
  adminTaskListResponseSchema,
  adminTaskQuerySchema,
  warehouseCodeSchema,
} from '@glorychips/contracts';
import type { AdminTaskListResponse, AdminTaskQuery, WarehouseCode } from '@glorychips/contracts';
import type { SessionPrincipal } from '../auth/types.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { InventoryDomainError } from './errors.js';

export class AdminTaskService {
  public constructor(private readonly database: PrismaClient) {}

  public async list(
    rawQuery: AdminTaskQuery,
    principal: SessionPrincipal,
  ): Promise<AdminTaskListResponse> {
    this.assertAdministrator(principal);
    const query = adminTaskQuerySchema.parse(rawQuery);
    if (query.warehouse !== undefined) this.assertWarehouseAccess(principal, query.warehouse);
    const systemAdmin = principal.roles.includes('SYSTEM_ADMIN');
    const records = await this.database.adminTask.findMany({
      where: {
        type: query.type,
        status: query.status,
        severity: query.severity,
        warehouse:
          query.warehouse !== undefined
            ? { code: query.warehouse }
            : systemAdmin
              ? undefined
              : { code: { in: [...principal.warehouses] } },
        ...(systemAdmin ? {} : { warehouseId: { not: null } }),
      },
      include: {
        warehouse: true,
        request: { include: { claimant: true } },
      },
      orderBy: [{ severity: 'desc' }, { dueAt: 'asc' }, { createdAt: 'asc' }],
    });
    return adminTaskListResponseSchema.parse({
      items: records.map((task) => ({
        id: task.id,
        type: task.type,
        severity: task.severity,
        status: task.status,
        warehouse: task.warehouse === null ? null : warehouseCodeSchema.parse(task.warehouse.code),
        warehouseName: task.warehouse?.name ?? null,
        requestId: task.requestId,
        requestNumber: task.request?.requestNumber ?? null,
        claimantName: task.request?.claimant.name ?? null,
        title: task.title,
        dueAt: task.dueAt?.toISOString() ?? null,
        createdAt: task.createdAt.toISOString(),
        allowedAction:
          task.status !== 'OPEN'
            ? null
            : task.type === 'PAPERWORK_REQUIRED' || task.type === 'PAPERWORK_OVERDUE'
              ? 'COMPLETE_PAPERWORK'
              : task.type === 'RETURN_DUE' || task.type === 'RETURN_OVERDUE'
                ? 'CONFIRM_RETURN'
                : 'VIEW',
      })),
    });
  }

  private assertWarehouseAccess(principal: SessionPrincipal, warehouse: WarehouseCode): void {
    if (
      !principal.roles.includes('SYSTEM_ADMIN') &&
      (!principal.roles.includes('WAREHOUSE_ADMIN') || !principal.warehouses.includes(warehouse))
    ) {
      throw new InventoryDomainError(
        'FORBIDDEN_WAREHOUSE',
        'The warehouse is outside the granted scope.',
      );
    }
  }

  private assertAdministrator(principal: SessionPrincipal): void {
    if (!principal.roles.includes('SYSTEM_ADMIN') && !principal.roles.includes('WAREHOUSE_ADMIN')) {
      throw new InventoryDomainError(
        'FORBIDDEN_ROLE',
        'Warehouse administrator access is required.',
      );
    }
  }
}
