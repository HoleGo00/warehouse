import { Inject, Injectable } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import type { DatabaseClient } from '@glorychips/database';
import { DATABASE_CLIENT } from '../auth/tokens.js';

@Injectable()
export class DatabaseLifecycle implements OnApplicationShutdown {
  public constructor(@Inject(DATABASE_CLIENT) private readonly database: DatabaseClient) {}

  public async onApplicationShutdown(): Promise<void> {
    await this.database.$disconnect();
  }
}
