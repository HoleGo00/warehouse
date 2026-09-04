import {
  claimantCandidateListResponseSchema,
  claimantSearchQuerySchema,
  normalRequestAdminQueueQuerySchema,
  paperworkQueueQuerySchema,
  requestDetailResponseSchema,
  requestListResponseSchema,
} from '@glorychips/contracts';
import type {
  ClaimantCandidateListResponse,
  ClaimantSearchQuery,
  NormalRequestAdminQueueQuery,
  PaperworkQueueQuery,
  RequestDetailResponse,
  RequestListResponse,
} from '@glorychips/contracts';
import type { SessionPrincipal } from '../auth/types.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { RequestDomainError } from './errors.js';
import {
  assertAdminAccess,
  isAdminForWarehouse,
  requestDetailInclude,
  toJson,
  toRequestDetail,
  toRequestSummary,
} from './request-shared.js';

export class RequestQueryService {
  public constructor(private readonly database: PrismaClient) {}

  public async listMine(principal: SessionPrincipal): Promise<RequestListResponse> {
    const records = await this.database.request.findMany({
      where: { claimantId: principal.userId },
      include: requestDetailInclude,
      orderBy: { createdAt: 'desc' },
    });
    return requestListResponseSchema.parse({
      items: records.map((record) => toRequestSummary(toRequestDetail(record, principal))),
    });
  }

  public async getVisibleDetail(
    requestId: string,
    principal: SessionPrincipal,
  ): Promise<RequestDetailResponse> {
    const record = await this.database.request.findUnique({
      where: { id: requestId },
      include: requestDetailInclude,
    });
    if (record === null) this.notFound();
    if (
      record.claimantId !== principal.userId &&
      !isAdminForWarehouse(principal, this.warehouseCode(record.warehouse.code))
    ) {
      this.forbidden();
    }
    return requestDetailResponseSchema.parse({ request: toRequestDetail(record, principal) });
  }

  public async listAdminQueue(
    rawQuery: NormalRequestAdminQueueQuery,
    principal: SessionPrincipal,
  ): Promise<RequestListResponse> {
    const query = normalRequestAdminQueueQuerySchema.parse(rawQuery);
    assertAdminAccess(principal, query.warehouse);
    const records = await this.database.request.findMany({
      where: {
        origin: 'ONLINE',
        status: query.status,
        warehouse: { code: query.warehouse },
      },
      include: requestDetailInclude,
      orderBy: { submittedAt: 'asc' },
    });
    return requestListResponseSchema.parse({
      items: records.map((record) => toRequestSummary(toRequestDetail(record, principal))),
    });
  }

  public async listPaperworkQueue(
    rawQuery: PaperworkQueueQuery,
    principal: SessionPrincipal,
  ): Promise<RequestListResponse> {
    const query = paperworkQueueQuerySchema.parse(rawQuery);
    assertAdminAccess(principal, query.warehouse);
    await this.refreshOverdueTasks(query.warehouse);
    const requestStatus = query.state === 'CORRECTION' ? 'REJECTED' : 'PENDING_PAPERWORK';
    const taskType = query.state === 'OVERDUE' ? 'PAPERWORK_OVERDUE' : undefined;
    const records = await this.database.request.findMany({
      where: {
        origin: 'EXPRESS',
        status:
          query.state === 'OVERDUE' ? { in: ['PENDING_PAPERWORK', 'REJECTED'] } : requestStatus,
        warehouse: { code: query.warehouse },
        adminTasks: {
          some: {
            status: 'OPEN',
            ...(taskType === undefined ? {} : { type: taskType }),
          },
        },
      },
      include: requestDetailInclude,
      orderBy: { submittedAt: 'asc' },
    });
    const filtered =
      query.state === 'REQUIRED'
        ? records.filter((record) =>
            record.adminTasks.some((task) => task.type === 'PAPERWORK_REQUIRED'),
          )
        : records;
    return requestListResponseSchema.parse({
      items: filtered.map((record) => toRequestSummary(toRequestDetail(record, principal))),
    });
  }

  public async searchClaimants(
    rawQuery: ClaimantSearchQuery,
    principal: SessionPrincipal,
  ): Promise<ClaimantCandidateListResponse> {
    if (!principal.roles.includes('SYSTEM_ADMIN') && !principal.roles.includes('WAREHOUSE_ADMIN')) {
      this.forbidden();
    }
    const query = claimantSearchQuerySchema.parse(rawQuery);
    const users = await this.database.user.findMany({
      where: {
        status: 'ACTIVE',
        name: query.query.length === 0 ? undefined : { contains: query.query, mode: 'insensitive' },
        userRoles: { some: { role: { code: 'CLAIMANT' } } },
      },
      select: { id: true, name: true, avatarUrl: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 20,
    });
    return claimantCandidateListResponseSchema.parse({ items: users });
  }

  public async refreshOverdueTasks(warehouse?: string, now = new Date()): Promise<number> {
    const tasks = await this.database.adminTask.findMany({
      where: {
        type: 'PAPERWORK_REQUIRED',
        status: 'OPEN',
        dueAt: { lt: now },
        ...(warehouse === undefined ? {} : { warehouse: { code: warehouse } }),
      },
      select: {
        id: true,
        requestId: true,
        warehouseId: true,
        dueAt: true,
        request: { select: { claimantId: true } },
      },
    });
    let upgraded = 0;
    for (const task of tasks) {
      const changed = await this.database.$transaction(async (transaction) => {
        const result = await transaction.adminTask.updateMany({
          where: { id: task.id, type: 'PAPERWORK_REQUIRED', status: 'OPEN', dueAt: { lt: now } },
          data: { type: 'PAPERWORK_OVERDUE', severity: 'CRITICAL' },
        });
        if (result.count === 0) return false;
        await transaction.auditLog.create({
          data: {
            warehouseId: task.warehouseId,
            action: 'TEMPORARY_REQUEST_PAPERWORK_OVERDUE',
            entityType: 'REQUEST',
            entityId: task.requestId ?? task.id,
            before: toJson({ taskType: 'PAPERWORK_REQUIRED' }),
            after: toJson({
              taskType: 'PAPERWORK_OVERDUE',
              dueAt: task.dueAt,
              claimantId: task.request?.claimantId ?? null,
            }),
          },
        });
        return true;
      });
      if (changed) upgraded += 1;
    }
    return upgraded;
  }

  private warehouseCode(value: string) {
    if (value === 'XIHU' || value === 'YUHANG') return value;
    throw new RequestDomainError('REQUEST_STATE_CONFLICT', 'The request warehouse is invalid.');
  }

  private notFound(): never {
    throw new RequestDomainError('REQUEST_NOT_FOUND', 'The request was not found.');
  }

  private forbidden(): never {
    throw new RequestDomainError('REQUEST_FORBIDDEN', 'The request is outside the granted scope.');
  }
}
