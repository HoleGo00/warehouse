import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  cancelNormalRequestSchema,
  completeTemporaryPaperworkSchema,
  createNormalRequestSchema,
  createTemporaryRequestSchema,
  resubmitNormalRequestSchema,
} from '@glorychips/contracts';
import { AuthDomainError } from '@glorychips/database';
import type {
  NormalRequestService,
  RequestQueryService,
  TemporaryOfflineRequestService,
} from '@glorychips/database';
import type { ApiRequest } from '../auth/http-types.js';
import { SessionGuard } from '../auth/session.guard.js';
import {
  NORMAL_REQUEST_SERVICE,
  REQUEST_QUERY_SERVICE,
  TEMPORARY_OFFLINE_REQUEST_SERVICE,
} from '../auth/tokens.js';
import { parseIdempotencyKey, parseRequestId, requirePrincipal } from './request-http.js';

@Controller('requests')
@UseGuards(SessionGuard)
export class RequestsController {
  public constructor(
    @Inject(NORMAL_REQUEST_SERVICE) private readonly requests: NormalRequestService,
    @Inject(REQUEST_QUERY_SERVICE) private readonly queries: RequestQueryService,
    @Inject(TEMPORARY_OFFLINE_REQUEST_SERVICE)
    private readonly temporaryRequests: TemporaryOfflineRequestService,
  ) {}

  @Post('normal')
  public async create(
    @Body() rawBody: unknown,
    @Headers('idempotency-key') rawKey: unknown,
    @Req() request: ApiRequest,
  ) {
    const body = createNormalRequestSchema.safeParse(rawBody);
    if (!body.success) {
      throw new AuthDomainError('VALIDATION_ERROR', 'The normal request is invalid.');
    }
    return this.requests.createAndSubmit(
      body.data,
      parseIdempotencyKey(rawKey),
      requirePrincipal(request),
    );
  }

  @Post('temporary')
  public async createTemporary(
    @Body() rawBody: unknown,
    @Headers('idempotency-key') rawKey: unknown,
    @Req() request: ApiRequest,
  ) {
    const body = createTemporaryRequestSchema.safeParse(rawBody);
    if (!body.success) {
      throw new AuthDomainError('VALIDATION_ERROR', 'The temporary request is invalid.');
    }
    return this.temporaryRequests.createTemporary(
      body.data,
      parseIdempotencyKey(rawKey),
      requirePrincipal(request),
    );
  }

  @Put(':requestId/resubmit')
  public async resubmit(
    @Param('requestId') rawRequestId: unknown,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') rawKey: unknown,
    @Req() request: ApiRequest,
  ) {
    const body = resubmitNormalRequestSchema.safeParse(rawBody);
    if (!body.success) {
      throw new AuthDomainError('VALIDATION_ERROR', 'The resubmitted request is invalid.');
    }
    return this.requests.resubmit(
      parseRequestId(rawRequestId),
      body.data,
      parseIdempotencyKey(rawKey),
      requirePrincipal(request),
    );
  }

  @Get('me')
  public async listMine(@Req() request: ApiRequest) {
    return this.queries.listMine(requirePrincipal(request));
  }

  @Put(':requestId/paperwork')
  public async completePaperwork(
    @Param('requestId') rawRequestId: unknown,
    @Body() rawBody: unknown,
    @Headers('idempotency-key') rawKey: unknown,
    @Req() request: ApiRequest,
  ) {
    const body = completeTemporaryPaperworkSchema.safeParse(rawBody);
    if (!body.success) {
      throw new AuthDomainError('VALIDATION_ERROR', 'The request paperwork is invalid.');
    }
    return this.temporaryRequests.completePaperwork(
      parseRequestId(rawRequestId),
      body.data,
      parseIdempotencyKey(rawKey),
      requirePrincipal(request),
    );
  }

  @Get(':requestId')
  public async detail(@Param('requestId') rawRequestId: unknown, @Req() request: ApiRequest) {
    return this.queries.getVisibleDetail(parseRequestId(rawRequestId), requirePrincipal(request));
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
}
