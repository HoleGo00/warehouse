import { Controller, Get, Inject, Query, Req, UseGuards } from '@nestjs/common';
import { claimantSearchQuerySchema } from '@glorychips/contracts';
import { AuthDomainError } from '@glorychips/database';
import type { RequestQueryService } from '@glorychips/database';
import type { ApiRequest } from '../auth/http-types.js';
import { SessionGuard } from '../auth/session.guard.js';
import { REQUEST_QUERY_SERVICE } from '../auth/tokens.js';
import { requirePrincipal } from './request-http.js';

@Controller('admin/claimants')
@UseGuards(SessionGuard)
export class AdminClaimantsController {
  public constructor(
    @Inject(REQUEST_QUERY_SERVICE) private readonly queries: RequestQueryService,
  ) {}

  @Get()
  public async search(@Query('query') query: unknown, @Req() request: ApiRequest) {
    const parsed = claimantSearchQuerySchema.safeParse({ query });
    if (!parsed.success) {
      throw new AuthDomainError('VALIDATION_ERROR', 'The claimant search is invalid.');
    }
    return this.queries.searchClaimants(parsed.data, requirePrincipal(request));
  }
}
