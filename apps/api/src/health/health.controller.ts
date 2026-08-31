import { Controller, Get } from '@nestjs/common';
import { healthResponseSchema } from '@glorychips/contracts';
import { createDatabaseClient } from '@glorychips/database';

@Controller('health')
export class HealthController {
  @Get()
  public async health() {
    const timestamp = new Date().toISOString();
    const databaseUrl = process.env['DATABASE_URL'];
    if (databaseUrl === undefined) {
      return healthResponseSchema.parse({
        service: 'api',
        status: 'ok',
        database: 'not-configured',
        timestamp,
      });
    }

    const database = createDatabaseClient();
    try {
      await database.$queryRaw`SELECT 1`;
      return healthResponseSchema.parse({
        service: 'api',
        status: 'ok',
        database: 'ok',
        timestamp,
      });
    } finally {
      await database.$disconnect();
    }
  }
}
