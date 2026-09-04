import { Body, Controller, Headers, Inject, Post, Req, UseGuards } from '@nestjs/common';
import {
  createInboundSchema,
  createStocktakeSchema,
  createTransferSchema,
} from '@glorychips/contracts';
import { AuthDomainError } from '@glorychips/database';
import type { InventoryOperationsService } from '@glorychips/database';
import type { ApiRequest } from '../auth/http-types.js';
import { SessionGuard } from '../auth/session.guard.js';
import { INVENTORY_OPERATIONS_SERVICE } from '../auth/tokens.js';
import { parseIdempotencyKey, requirePrincipal } from '../requests/request-http.js';

@Controller('admin/inventory')
@UseGuards(SessionGuard)
export class AdminInventoryOperationsController {
  public constructor(
    @Inject(INVENTORY_OPERATIONS_SERVICE)
    private readonly operations: InventoryOperationsService,
  ) {}

  @Post('inbound')
  public inbound(
    @Body() rawBody: unknown,
    @Headers('idempotency-key') rawKey: unknown,
    @Req() request: ApiRequest,
  ) {
    const body = createInboundSchema.safeParse(rawBody);
    if (!body.success) throw this.validationError('The inbound command is invalid.');
    return this.operations.createInbound(
      body.data,
      parseIdempotencyKey(rawKey),
      requirePrincipal(request),
    );
  }

  @Post('transfers')
  public transfer(
    @Body() rawBody: unknown,
    @Headers('idempotency-key') rawKey: unknown,
    @Req() request: ApiRequest,
  ) {
    const body = createTransferSchema.safeParse(rawBody);
    if (!body.success) throw this.validationError('The transfer command is invalid.');
    return this.operations.createTransfer(
      body.data,
      parseIdempotencyKey(rawKey),
      requirePrincipal(request),
    );
  }

  @Post('stocktakes')
  public stocktake(
    @Body() rawBody: unknown,
    @Headers('idempotency-key') rawKey: unknown,
    @Req() request: ApiRequest,
  ) {
    const body = createStocktakeSchema.safeParse(rawBody);
    if (!body.success) throw this.validationError('The stocktake command is invalid.');
    return this.operations.createStocktake(
      body.data,
      parseIdempotencyKey(rawKey),
      requirePrincipal(request),
    );
  }

  private validationError(message: string): AuthDomainError {
    return new AuthDomainError('VALIDATION_ERROR', message);
  }
}
