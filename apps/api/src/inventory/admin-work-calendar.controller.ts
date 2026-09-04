import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  dateOnlySchema,
  upsertWorkCalendarDaySchema,
  workCalendarQuerySchema,
} from '@glorychips/contracts';
import { AuthDomainError } from '@glorychips/database';
import type { WorkCalendarAdminService } from '@glorychips/database';
import { SystemAdminGuard } from '../access/system-admin.guard.js';
import type { ApiRequest } from '../auth/http-types.js';
import { SessionGuard } from '../auth/session.guard.js';
import { WORK_CALENDAR_ADMIN_SERVICE } from '../auth/tokens.js';
import { parseIdempotencyKey, requirePrincipal } from '../requests/request-http.js';

@Controller('admin/work-calendar')
@UseGuards(SessionGuard)
export class AdminWorkCalendarController {
  public constructor(
    @Inject(WORK_CALENDAR_ADMIN_SERVICE)
    private readonly calendar: WorkCalendarAdminService,
  ) {}

  @Get()
  public list(@Query('from') from: unknown, @Query('to') to: unknown) {
    const query = workCalendarQuerySchema.safeParse({ from, to });
    if (!query.success)
      throw new AuthDomainError('VALIDATION_ERROR', 'The calendar range is invalid.');
    return this.calendar.list(query.data);
  }

  @Put(':date')
  @UseGuards(SystemAdminGuard)
  public upsert(
    @Param('date') date: string,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') rawKey: unknown,
    @Req() request: ApiRequest,
  ) {
    const parsedDate = dateOnlySchema.safeParse(date);
    const body = upsertWorkCalendarDaySchema.safeParse(rawBody);
    if (!parsedDate.success || !body.success) {
      throw new AuthDomainError('VALIDATION_ERROR', 'The calendar override is invalid.');
    }
    return this.calendar.upsert(
      parsedDate.data,
      body.data,
      parseIdempotencyKey(rawKey),
      requirePrincipal(request),
    );
  }

  @Delete(':date')
  @UseGuards(SystemAdminGuard)
  public remove(
    @Param('date') date: string,
    @Headers('idempotency-key') rawKey: unknown,
    @Req() request: ApiRequest,
  ) {
    const parsedDate = dateOnlySchema.safeParse(date);
    if (!parsedDate.success) {
      throw new AuthDomainError('VALIDATION_ERROR', 'The calendar date is invalid.');
    }
    return this.calendar.remove(
      parsedDate.data,
      parseIdempotencyKey(rawKey),
      requirePrincipal(request),
    );
  }
}
