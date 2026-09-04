import { Module } from '@nestjs/common';
import { createDatabaseClient, ReturnReminderService } from '@glorychips/database';
import { DatabaseLifecycle } from './database-lifecycle.js';
import { ReturnReminderRunner } from './return-reminder.runner.js';
import { DATABASE_CLIENT, RETURN_REMINDER_SERVICE } from './tokens.js';

@Module({
  providers: [
    { provide: DATABASE_CLIENT, useFactory: () => createDatabaseClient(process.env) },
    {
      provide: RETURN_REMINDER_SERVICE,
      useFactory: (database: ReturnType<typeof createDatabaseClient>) =>
        new ReturnReminderService(database),
      inject: [DATABASE_CLIENT],
    },
    ReturnReminderRunner,
    DatabaseLifecycle,
  ],
})
export class AppModule {}
