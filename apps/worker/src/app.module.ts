import { Module } from '@nestjs/common';
import { createDatabaseClient, ReturnReminderService } from '@glorychips/database';
import { parseWorkerEnvironment } from '@glorychips/config';
import { DatabaseLifecycle } from './database-lifecycle.js';
import { WorkerScheduler } from './worker-scheduler.js';
import { createWorkerScheduler } from './create-worker-scheduler.js';
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
    {
      provide: WorkerScheduler,
      inject: [DATABASE_CLIENT, RETURN_REMINDER_SERVICE],
      useFactory: async (
        database: ReturnType<typeof createDatabaseClient>,
        reminders: ReturnReminderService,
      ) => {
        try {
          return await createWorkerScheduler(
            database,
            reminders,
            parseWorkerEnvironment(process.env),
          );
        } catch (error) {
          await database.$disconnect();
          throw error;
        }
      },
    },
    DatabaseLifecycle,
  ],
})
export class AppModule {}
