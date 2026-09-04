import {
  dateOnlySchema,
  upsertWorkCalendarDaySchema,
  workCalendarListResponseSchema,
  workCalendarQuerySchema,
} from '@glorychips/contracts';
import type { WorkCalendarListResponse } from '@glorychips/contracts';
import type { SessionPrincipal } from '../auth/types.js';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { executeIdempotently } from '../idempotency/execute-idempotently.js';
import { IdempotencyConflictError, InventoryDomainError } from '../inventory/errors.js';
import { toJson } from './request-shared.js';

type Transaction = Prisma.TransactionClient;
const asDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

export class WorkCalendarAdminService {
  public constructor(private readonly database: PrismaClient) {}

  public async list(rawQuery: unknown): Promise<WorkCalendarListResponse> {
    const query = workCalendarQuerySchema.parse(rawQuery);
    if (query.from > query.to) {
      throw new InventoryDomainError('VALIDATION_ERROR', 'The date range is invalid.');
    }
    const records = await this.database.workCalendarDay.findMany({
      where: { date: { gte: asDate(query.from), lte: asDate(query.to) } },
      orderBy: { date: 'asc' },
    });
    return workCalendarListResponseSchema.parse({
      items: records.map((record) => ({
        date: record.date.toISOString().slice(0, 10),
        isWorkingDay: record.isWorkingDay,
        description: record.description,
      })),
    });
  }

  public upsert(
    rawDate: string,
    rawCommand: unknown,
    idempotencyKey: string,
    actor: SessionPrincipal,
  ): Promise<WorkCalendarListResponse['items'][number]> {
    this.assertSystemAdmin(actor);
    const date = dateOnlySchema.parse(rawDate);
    const command = upsertWorkCalendarDaySchema.parse(rawCommand);
    return this.execute(
      idempotencyKey,
      'UPSERT_WORK_CALENDAR_OVERRIDE',
      { date, ...command },
      async (transaction) => {
        const before = await transaction.workCalendarDay.findUnique({
          where: { date: asDate(date) },
        });
        const record = await transaction.workCalendarDay.upsert({
          where: { date: asDate(date) },
          create: {
            date: asDate(date),
            isWorkingDay: command.isWorkingDay,
            description: command.description ?? null,
          },
          update: {
            isWorkingDay: command.isWorkingDay,
            description: command.description ?? null,
          },
        });
        await transaction.auditLog.create({
          data: {
            actorUserId: actor.userId,
            action: 'WORK_CALENDAR_OVERRIDE_UPSERTED',
            entityType: 'WORK_CALENDAR_DAY',
            entityId: date,
            before: before === null ? undefined : toJson(before),
            after: toJson(record),
          },
        });
        return {
          date,
          isWorkingDay: record.isWorkingDay,
          description: record.description,
        };
      },
    );
  }

  public remove(
    rawDate: string,
    idempotencyKey: string,
    actor: SessionPrincipal,
  ): Promise<{ deleted: boolean }> {
    this.assertSystemAdmin(actor);
    const date = dateOnlySchema.parse(rawDate);
    return this.execute(
      idempotencyKey,
      'DELETE_WORK_CALENDAR_OVERRIDE',
      { date },
      async (transaction) => {
        const before = await transaction.workCalendarDay.findUnique({
          where: { date: asDate(date) },
        });
        if (before === null) return { deleted: false };
        await transaction.workCalendarDay.delete({ where: { id: before.id } });
        await transaction.auditLog.create({
          data: {
            actorUserId: actor.userId,
            action: 'WORK_CALENDAR_OVERRIDE_DELETED',
            entityType: 'WORK_CALENDAR_DAY',
            entityId: date,
            before: toJson(before),
          },
        });
        return { deleted: true };
      },
    );
  }

  private execute<T>(
    key: string,
    operation: string,
    command: unknown,
    execute: (transaction: Transaction) => Promise<T>,
  ): Promise<T> {
    return executeIdempotently({
      database: this.database,
      key,
      operation,
      command,
      invalidKeyError: () =>
        new InventoryDomainError('VALIDATION_ERROR', 'An idempotency key is required.'),
      conflictError: () => new IdempotencyConflictError(key),
      execute,
    });
  }

  private assertSystemAdmin(actor: SessionPrincipal): void {
    if (!actor.roles.includes('SYSTEM_ADMIN')) {
      throw new InventoryDomainError('FORBIDDEN_ROLE', 'System administrator access is required.');
    }
  }
}
