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
  cancelNormalRequestSchema,
  fulfillNormalRequestSchema,
  normalRequestAdminQueueQuerySchema,
  reviewNormalRequestSchema,
} from '@glorychips/contracts';
import { AuthDomainError } from '@glorychips/database';
import type { NormalRequestService } from '@glorychips/database';
import type { ApiRequest } from '../auth/http-types.js';
import { SessionGuard } from '../auth/session.guard.js';
import { NORMAL_REQUEST_SERVICE } from '../auth/tokens.js';
import { parseIdempotencyKey, parseRequestId, requirePrincipal } from './request-http.js';

@Controller('admin/requests')
@UseGuards(SessionGuard)
export class AdminRequestsController {
  public constructor(
    @Inject(NORMAL_REQUEST_SERVICE) private readonly requests: NormalRequestService,
  ) {}

  @Get()
  public async queue(
    @Query('warehouse') warehouse: unknown,
    @Query('status') status: unknown,
    @Req() request: ApiRequest,
  ) {
    const query = normalRequestAdminQueueQuerySchema.safeParse({ warehouse, status });
    if (!query.success) {
      throw new AuthDomainError('VALIDATION_ERROR', 'The request queue filter is invalid.');
    }
    return this.requests.listAdminQueue(query.data, requirePrincipal(request));
  }

  @Post(':requestId/review')
  public async review(
    @Param('requestId') rawRequestId: unknown,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') rawKey: unknown,
    @Req() request: ApiRequest,
  ) {
    const body = reviewNormalRequestSchema.safeParse(rawBody);
    if (!body.success) {
      throw new AuthDomainError('VALIDATION_ERROR', 'The review decision is invalid.');
    }
    return this.requests.review(
      parseRequestId(rawRequestId),
      body.data,
      parseIdempotencyKey(rawKey),
      requirePrincipal(request),
    );
  }

  @Post(':requestId/cancel')
  public async cancel(
    @Param('requestId') rawRequestId: unknown,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') rawKey: unknown,
    @Req() request: ApiRequest,
  ) {
    const body = cancelNormalRequestSchema.safeParse(rawBody);
    if (!body.success) {
      throw new AuthDomainError('VALIDATION_ERROR', 'A cancellation reason is required.');
    }
    return this.requests.cancel(
      parseRequestId(rawRequestId),
      body.data,
      parseIdempotencyKey(rawKey),
      requirePrincipal(request),
    );
  }

  @Post(':requestId/fulfill')
  public async fulfill(
    @Param('requestId') rawRequestId: unknown,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') rawKey: unknown,
    @Req() request: ApiRequest,
  ) {
    if (!fulfillNormalRequestSchema.safeParse(rawBody ?? {}).success) {
      throw new AuthDomainError('VALIDATION_ERROR', 'The fulfillment request is invalid.');
    }
    return this.requests.fulfill(
      parseRequestId(rawRequestId),
      parseIdempotencyKey(rawKey),
      requirePrincipal(request),
    );
  }
}
