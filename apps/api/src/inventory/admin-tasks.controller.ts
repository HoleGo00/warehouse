import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { adminTaskQuerySchema } from '@glorychips/contracts';
import { AuthDomainError } from '@glorychips/database';
import type { AdminTaskService } from '@glorychips/database';
import type { ApiRequest } from '../auth/http-types.js';
import { SessionGuard } from '../auth/session.guard.js';
import { ADMIN_TASK_SERVICE } from '../auth/tokens.js';
import { requirePrincipal } from '../requests/request-http.js';

@Controller('admin/tasks')
@UseGuards(SessionGuard)
export class AdminTasksController {
  public constructor(@Inject(ADMIN_TASK_SERVICE) private readonly tasks: AdminTaskService) {}

  @Get()
  public list(
    @Query('warehouse') warehouse: unknown,
    @Query('type') type: unknown,
    @Query('status') status: unknown,
    @Query('severity') severity: unknown,
    @Req() request: ApiRequest,
  ) {
    const query = adminTaskQuerySchema.safeParse({ warehouse, type, status, severity });
    if (!query.success)
      throw new AuthDomainError('VALIDATION_ERROR', 'The task filter is invalid.');
    return this.tasks.list(query.data, requirePrincipal(request));
  }
}
