import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { hashCommand } from '../inventory/stable-json.js';

type Transaction = Prisma.TransactionClient;

const toJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

export interface IdempotentExecutionOptions<T> {
  readonly database: PrismaClient;
  readonly key: string;
  readonly operation: string;
  readonly command: unknown;
  readonly invalidKeyError: () => Error;
  readonly conflictError: () => Error;
  readonly execute: (transaction: Transaction) => Promise<T>;
}

export const executeIdempotently = async <T>(
  options: IdempotentExecutionOptions<T>,
): Promise<T> => {
  const key = options.key.trim();
  if (key.length === 0) throw options.invalidKeyError();
  const requestHash = hashCommand(options.command);

  return options.database.$transaction(
    async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const record = await transaction.idempotencyKey.upsert({
        where: { key },
        create: { key, operation: options.operation, requestHash },
        update: {},
      });
      if (record.operation !== options.operation || record.requestHash !== requestHash) {
        throw options.conflictError();
      }
      if (record.status === 'COMPLETED' && record.response !== null) {
        return record.response as unknown as T;
      }

      const response = await options.execute(transaction);
      await transaction.idempotencyKey.update({
        where: { key },
        data: {
          status: 'COMPLETED',
          response: toJson(response),
          completedAt: new Date(),
        },
      });
      return response;
    },
    { isolationLevel: 'ReadCommitted', maxWait: 5_000, timeout: 20_000 },
  );
};
