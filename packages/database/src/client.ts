import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export type DatabaseClient = PrismaClient;

export const createDatabaseClient = (
  environment: Record<string, string | undefined> = process.env,
  poolOptions: { max?: number; connectionTimeoutMillis?: number } = {},
): DatabaseClient => {
  const databaseUrl = environment['DATABASE_URL'];
  if (databaseUrl === undefined || !databaseUrl.startsWith('postgresql://')) {
    throw new Error('DATABASE_URL must be a postgresql:// connection string.');
  }
  const adapter = new PrismaPg({ connectionString: databaseUrl, ...poolOptions });

  return new PrismaClient({ adapter });
};
