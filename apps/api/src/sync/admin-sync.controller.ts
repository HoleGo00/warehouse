import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  retrySyncJobSchema,
  runSyncReconciliationSchema,
  syncJobIdSchema,
  syncJobsQuerySchema,
  syncReconciliationsQuerySchema,
} from '@glorychips/contracts';
import { AuthDomainError } from '@glorychips/database';
import type { FeishuSyncAdminService } from '@glorychips/database';
import type { z } from 'zod';
import { SystemAdminGuard } from '../access/system-admin.guard.js';
import { SessionGuard } from '../auth/session.guard.js';
import type { ApiRequest } from '../auth/http-types.js';
import { parseIdempotencyKey, requirePrincipal } from '../requests/request-http.js';

export const FEISHU_SYNC_ADMIN_SERVICE = Symbol('FEISHU_SYNC_ADMIN_SERVICE');
const parse = <T>(schema: z.ZodType<T>, raw: unknown): T => {
  const result = schema.safeParse(raw);
  if (!result.success)
    throw new AuthDomainError('VALIDATION_ERROR', 'Invalid synchronization request.');
  return result.data;
};

@Controller('admin/sync')
@UseGuards(SessionGuard, SystemAdminGuard)
export class AdminSyncController {
  public constructor(
    @Inject(FEISHU_SYNC_ADMIN_SERVICE) private readonly sync: FeishuSyncAdminService,
  ) {}
  @Get('jobs')
  public jobs(@Query() raw: unknown, @Req() request: ApiRequest) {
    return this.sync.jobs(parse(syncJobsQuerySchema, raw), requirePrincipal(request));
  }
  @Get('jobs/:id')
  public job(@Param('id') id: string, @Req() request: ApiRequest) {
    return this.sync.job(parse(syncJobIdSchema, id), requirePrincipal(request));
  }
  @Post('jobs/:id/retry')
  public retry(
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.sync.retry(
      parse(syncJobIdSchema, id),
      parse(retrySyncJobSchema, body),
      parseIdempotencyKey(key),
      requirePrincipal(request),
    );
  }
  @Get('reconciliations')
  public reconciliations(@Query() raw: unknown, @Req() request: ApiRequest) {
    return this.sync.reconciliations(
      parse(syncReconciliationsQuerySchema, raw),
      requirePrincipal(request),
    );
  }
  @Post('reconciliations/run')
  public run(
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
    @Req() request: ApiRequest,
  ) {
    return this.sync.runReconciliation(
      parse(runSyncReconciliationSchema, body),
      parseIdempotencyKey(key),
      requirePrincipal(request),
    );
  }
  @Get('bindings')
  public bindings(@Req() request: ApiRequest) {
    return this.sync.bindings(requirePrincipal(request));
  }
}

@Controller('admin/migrations')
@UseGuards(SessionGuard, SystemAdminGuard)
export class AdminMigrationsController {
  public constructor(
    @Inject(FEISHU_SYNC_ADMIN_SERVICE) private readonly sync: FeishuSyncAdminService,
  ) {}
  @Get()
  public list(@Req() request: ApiRequest) {
    return this.sync.migrations(requirePrincipal(request));
  }
}
