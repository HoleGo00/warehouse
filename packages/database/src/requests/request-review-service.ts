import type { RequestActionResponse, ReviewRequest } from '@glorychips/contracts';
import type { SessionPrincipal } from '../auth/types.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { RequestDomainError } from './errors.js';
import type { NormalRequestService } from './normal-request-service.js';
import type { TemporaryOfflineRequestService } from './temporary-offline-request-service.js';

export class RequestReviewService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly normalRequests: NormalRequestService,
    private readonly temporaryRequests: TemporaryOfflineRequestService,
  ) {}

  public async review(
    requestId: string,
    command: ReviewRequest,
    idempotencyKey: string,
    principal: SessionPrincipal,
  ): Promise<RequestActionResponse> {
    const request = await this.database.request.findUnique({
      where: { id: requestId },
      select: { origin: true },
    });
    if (request === null) {
      throw new RequestDomainError('REQUEST_NOT_FOUND', 'The request was not found.');
    }
    if (request.origin === 'ONLINE') {
      return this.normalRequests.review(requestId, command, idempotencyKey, principal);
    }
    if (request.origin === 'EXPRESS') {
      return this.temporaryRequests.reviewTemporary(requestId, command, idempotencyKey, principal);
    }
    throw new RequestDomainError(
      'REQUEST_STATE_CONFLICT',
      'Offline requests do not have an approval step.',
    );
  }
}
