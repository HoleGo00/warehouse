import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  confirmReturnSchema,
  departureTriggerSchema,
  returnQueueQuerySchema,
} from '@glorychips/contracts';
import { AuthDomainError } from '@glorychips/database';
import type { ReturnReminderService, ReturnService } from '@glorychips/database';
import { SystemAdminGuard } from '../access/system-admin.guard.js';
import type { ApiRequest } from '../auth/http-types.js';
import { SessionGuard } from '../auth/session.guard.js';
import { RETURN_REMINDER_SERVICE, RETURN_SERVICE } from '../auth/tokens.js';
import { parseIdempotencyKey, requirePrincipal } from '../requests/request-http.js';

@Controller('admin/returns')
@UseGuards(SessionGuard)
export class AdminReturnsController {
  public constructor(
    @Inject(RETURN_SERVICE) private readonly returns: ReturnService,
    @Inject(RETURN_REMINDER_SERVICE) private readonly reminders: ReturnReminderService,
  ) {}

  @Get()
  public list(
    @Query('warehouse') warehouse: unknown,
    @Query('status') status: unknown,
    @Req() request: ApiRequest,
  ) {
    const query = returnQueueQuerySchema.safeParse({ warehouse, status });
    if (!query.success)
      throw new AuthDomainError('VALIDATION_ERROR', 'The return filter is invalid.');
    return this.returns.list(query.data, requirePrincipal(request));
  }

  @Post('confirm')
  public confirm(
    @Body() rawBody: unknown,
    @Headers('idempotency-key') rawKey: unknown,
    @Req() request: ApiRequest,
  ) {
    const body = confirmReturnSchema.safeParse(rawBody);
    if (!body.success)
      throw new AuthDomainError('VALIDATION_ERROR', 'The return command is invalid.');
    return this.returns.confirm(body.data, parseIdempotencyKey(rawKey), requirePrincipal(request));
  }

  @Post('departure-trigger')
  @UseGuards(SystemAdminGuard)
  public triggerDeparture(
    @Body() rawBody: unknown,
    @Headers('idempotency-key') rawKey: unknown,
    @Req() request: ApiRequest,
  ) {
    const body = departureTriggerSchema.safeParse(rawBody);
    if (!body.success) {
      throw new AuthDomainError('VALIDATION_ERROR', 'The departure trigger is invalid.');
    }
    return this.reminders.triggerDeparture(
      body.data,
      parseIdempotencyKey(rawKey),
      requirePrincipal(request),
    );
  }
}
