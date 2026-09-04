import { AuthDomainError } from '@glorychips/database';
import type { ApiRequest } from '../auth/http-types.js';
import { idempotencyKeySchema } from '@glorychips/contracts';
import { z } from 'zod';

export const requirePrincipal = (request: ApiRequest) => {
  if (request.auth === undefined) {
    throw new AuthDomainError('AUTH_REQUIRED', 'A valid session is required.');
  }
  return request.auth;
};

export const parseRequestId = (value: unknown): string => {
  const result = z.uuid().safeParse(value);
  if (!result.success) {
    throw new AuthDomainError('VALIDATION_ERROR', 'The request id is invalid.');
  }
  return result.data;
};

export const parseIdempotencyKey = (value: unknown): string => {
  const candidate = Array.isArray(value) ? value[0] : value;
  const result = idempotencyKeySchema.safeParse(candidate);
  if (!result.success) {
    throw new AuthDomainError('VALIDATION_ERROR', 'A valid Idempotency-Key header is required.');
  }
  return result.data;
};
