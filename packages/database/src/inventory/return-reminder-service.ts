import { departureTriggerSchema } from '@glorychips/contracts';
import type { DepartureTrigger } from '@glorychips/contracts';
import type { SessionPrincipal } from '../auth/types.js';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { executeIdempotently } from '../idempotency/execute-idempotently.js';
import { shanghaiDate, toJson } from '../requests/request-shared.js';
import { InventoryDomainError } from './errors.js';
import { IdempotencyConflictError } from './errors.js';

type Transaction = Prisma.TransactionClient;

const endOfShanghaiDate = (date: string): Date => new Date(`${date}T15:59:59.999Z`);

export class ReturnReminderService {
  public constructor(private readonly database: PrismaClient) {}

  public async scanDueReturns(now = new Date()): Promise<{ created: number; upgraded: number }> {
    const today = shanghaiDate(now);
    const todayDate = new Date(`${today}T00:00:00.000Z`);
    return this.database.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "return_obligations"
        WHERE "trigger" = 'DATE'
          AND "status" IN ('PENDING', 'PARTIAL')
          AND "due_date" <= ${today}::date
        ORDER BY "id"
        FOR UPDATE
      `;
      const obligations = await transaction.returnObligation.findMany({
        where: {
          trigger: 'DATE',
          status: { in: ['PENDING', 'PARTIAL'] },
          dueDate: { lte: todayDate },
        },
        include: { request: true },
        orderBy: [{ requestId: 'asc' }, { dueDate: 'asc' }],
      });
      const byRequest = new Map<string, (typeof obligations)[number]>();
      for (const obligation of obligations) {
        const current = byRequest.get(obligation.requestId);
        if (
          current === undefined ||
          (obligation.dueDate !== null &&
            current.dueDate !== null &&
            obligation.dueDate < current.dueDate)
        ) {
          byRequest.set(obligation.requestId, obligation);
        }
      }
      let created = 0;
      let upgraded = 0;
      for (const obligation of byRequest.values()) {
        const dueDate = obligation.dueDate;
        if (dueDate === null) continue;
        const overdue = dueDate < todayDate;
        const result = await this.upsertReturnTask(transaction, {
          deduplicationKey: `return:${obligation.requestId}`,
          requestId: obligation.requestId,
          warehouseId: obligation.request.warehouseId,
          dueAt: endOfShanghaiDate(dueDate.toISOString().slice(0, 10)),
          overdue,
        });
        if (result === 'created') created += 1;
        if (result === 'upgraded') upgraded += 1;
      }
      return { created, upgraded };
    });
  }

  public async triggerDeparture(
    rawCommand: DepartureTrigger,
    idempotencyKey: string,
    actor: SessionPrincipal,
  ): Promise<{ created: number }> {
    if (!actor.roles.includes('SYSTEM_ADMIN')) {
      throw new InventoryDomainError('FORBIDDEN_ROLE', 'System administrator access is required.');
    }
    const command = departureTriggerSchema.parse(rawCommand);
    return executeIdempotently({
      database: this.database,
      key: idempotencyKey,
      operation: 'TRIGGER_DEPARTURE_RETURNS',
      command,
      invalidKeyError: () =>
        new InventoryDomainError('VALIDATION_ERROR', 'An idempotency key is required.'),
      conflictError: () => new IdempotencyConflictError(idempotencyKey),
      execute: async (transaction) => {
        const user = await transaction.user.findUnique({ where: { id: command.claimantId } });
        if (user === null) {
          throw new InventoryDomainError('CLAIMANT_NOT_FOUND', 'The claimant was not found.');
        }
        await transaction.$queryRaw`
          SELECT obligation."id" FROM "return_obligations" obligation
          INNER JOIN "requests" request ON request."id" = obligation."request_id"
          WHERE obligation."trigger" = 'DEPARTURE'
            AND obligation."status" IN ('PENDING', 'PARTIAL')
            AND request."claimant_id" = ${command.claimantId}::uuid
          ORDER BY obligation."id"
          FOR UPDATE OF obligation
        `;
        const obligations = await transaction.returnObligation.findMany({
          where: {
            trigger: 'DEPARTURE',
            status: { in: ['PENDING', 'PARTIAL'] },
            request: { claimantId: command.claimantId },
          },
          include: { request: true },
          orderBy: { requestId: 'asc' },
        });
        const requests = new Map(obligations.map((item) => [item.requestId, item.request]));
        let created = 0;
        for (const request of requests.values()) {
          const key = `departure:${command.claimantId}:${request.id}`;
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
          const existing = await transaction.adminTask.findUnique({
            where: { deduplicationKey: key },
          });
          if (existing !== null) continue;
          const task = await transaction.adminTask.create({
            data: {
              deduplicationKey: key,
              type: 'RETURN_OVERDUE',
              severity: 'CRITICAL',
              status: 'OPEN',
              warehouseId: request.warehouseId,
              requestId: request.id,
              title: '员工离职待归还',
              detail: toJson({ claimantId: command.claimantId, reason: command.reason }),
            },
          });
          await transaction.auditLog.create({
            data: {
              actorUserId: actor.userId,
              warehouseId: request.warehouseId,
              action: 'RETURN_DEPARTURE_TRIGGERED',
              entityType: 'ADMIN_TASK',
              entityId: task.id,
              after: toJson({
                claimantId: command.claimantId,
                requestId: request.id,
                reason: command.reason,
              }),
            },
          });
          created += 1;
        }
        return { created };
      },
    });
  }

  private async upsertReturnTask(
    transaction: Transaction,
    input: {
      deduplicationKey: string;
      requestId: string;
      warehouseId: string;
      dueAt: Date;
      overdue: boolean;
    },
  ): Promise<'created' | 'upgraded' | 'unchanged'> {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.deduplicationKey}))`;
    const existing = await transaction.adminTask.findUnique({
      where: { deduplicationKey: input.deduplicationKey },
    });
    if (existing === null) {
      const task = await transaction.adminTask.create({
        data: {
          deduplicationKey: input.deduplicationKey,
          type: input.overdue ? 'RETURN_OVERDUE' : 'RETURN_DUE',
          severity: input.overdue ? 'CRITICAL' : 'WARNING',
          status: 'OPEN',
          warehouseId: input.warehouseId,
          requestId: input.requestId,
          title: input.overdue ? '归还已超期' : '到期待归还',
          dueAt: input.dueAt,
        },
      });
      await this.auditTask(transaction, task.id, input, 'RETURN_DUE_TASK_CREATED');
      return 'created';
    }
    if (input.overdue && existing.status === 'OPEN' && existing.type !== 'RETURN_OVERDUE') {
      await transaction.adminTask.update({
        where: { id: existing.id },
        data: { type: 'RETURN_OVERDUE', severity: 'CRITICAL', title: '归还已超期' },
      });
      await this.auditTask(transaction, existing.id, input, 'RETURN_OVERDUE_TASK_UPGRADED');
      return 'upgraded';
    }
    return 'unchanged';
  }

  private async auditTask(
    transaction: Transaction,
    taskId: string,
    input: { requestId: string; warehouseId: string; dueAt: Date; overdue: boolean },
    action: string,
  ): Promise<void> {
    await transaction.auditLog.create({
      data: {
        warehouseId: input.warehouseId,
        action,
        entityType: 'ADMIN_TASK',
        entityId: taskId,
        after: toJson({ requestId: input.requestId, dueAt: input.dueAt, overdue: input.overdue }),
      },
    });
  }
}
