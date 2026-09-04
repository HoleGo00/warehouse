import {
  normalRequestActionResponseSchema,
  normalRequestDetailResponseSchema,
  normalRequestListResponseSchema,
} from '@glorychips/contracts';
import type {
  CancelNormalRequest,
  CreateNormalRequest,
  NormalRequestActionResponse,
  NormalRequestAdminQueueQuery,
  NormalRequestDetailResponse,
  NormalRequestListResponse,
  ResubmitNormalRequest,
  ReviewNormalRequest,
} from '@glorychips/contracts';
import { apiBaseUrl, parseApiResponse, type FetchFunction } from '../shared/api-client.js';

interface CreateRequestApiOptions {
  readonly baseUrl?: string;
  readonly fetchFunction?: FetchFunction;
}

const mutationHeaders = (idempotencyKey: string) => ({
  'content-type': 'application/json',
  'idempotency-key': idempotencyKey,
});

export const createRequestApi = ({
  baseUrl = apiBaseUrl,
  fetchFunction = fetch,
}: CreateRequestApiOptions = {}) => ({
  async create(
    command: CreateNormalRequest,
    idempotencyKey: string,
  ): Promise<NormalRequestActionResponse> {
    const response = await fetchFunction(new URL('/requests/normal', baseUrl), {
      method: 'POST',
      credentials: 'include',
      headers: mutationHeaders(idempotencyKey),
      body: JSON.stringify(command),
    });
    return parseApiResponse(response, normalRequestActionResponseSchema);
  },

  async resubmit(
    requestId: string,
    command: ResubmitNormalRequest,
    idempotencyKey: string,
  ): Promise<NormalRequestActionResponse> {
    const response = await fetchFunction(new URL(`/requests/${requestId}/resubmit`, baseUrl), {
      method: 'PUT',
      credentials: 'include',
      headers: mutationHeaders(idempotencyKey),
      body: JSON.stringify(command),
    });
    return parseApiResponse(response, normalRequestActionResponseSchema);
  },

  async listMine(): Promise<NormalRequestListResponse> {
    const response = await fetchFunction(new URL('/requests/me', baseUrl), {
      credentials: 'include',
    });
    return parseApiResponse(response, normalRequestListResponseSchema);
  },

  async detail(requestId: string): Promise<NormalRequestDetailResponse> {
    const response = await fetchFunction(new URL(`/requests/${requestId}`, baseUrl), {
      credentials: 'include',
    });
    return parseApiResponse(response, normalRequestDetailResponseSchema);
  },

  async cancel(
    requestId: string,
    command: CancelNormalRequest,
    idempotencyKey: string,
    admin = false,
  ): Promise<NormalRequestActionResponse> {
    const prefix = admin ? '/admin/requests' : '/requests';
    const response = await fetchFunction(new URL(`${prefix}/${requestId}/cancel`, baseUrl), {
      method: 'POST',
      credentials: 'include',
      headers: mutationHeaders(idempotencyKey),
      body: JSON.stringify(command),
    });
    return parseApiResponse(response, normalRequestActionResponseSchema);
  },

  async adminQueue(query: NormalRequestAdminQueueQuery): Promise<NormalRequestListResponse> {
    const url = new URL('/admin/requests', baseUrl);
    url.searchParams.set('warehouse', query.warehouse);
    url.searchParams.set('status', query.status);
    const response = await fetchFunction(url, { credentials: 'include' });
    return parseApiResponse(response, normalRequestListResponseSchema);
  },

  async review(
    requestId: string,
    command: ReviewNormalRequest,
    idempotencyKey: string,
  ): Promise<NormalRequestActionResponse> {
    const response = await fetchFunction(new URL(`/admin/requests/${requestId}/review`, baseUrl), {
      method: 'POST',
      credentials: 'include',
      headers: mutationHeaders(idempotencyKey),
      body: JSON.stringify(command),
    });
    return parseApiResponse(response, normalRequestActionResponseSchema);
  },

  async fulfill(requestId: string, idempotencyKey: string): Promise<NormalRequestActionResponse> {
    const response = await fetchFunction(new URL(`/admin/requests/${requestId}/fulfill`, baseUrl), {
      method: 'POST',
      credentials: 'include',
      headers: mutationHeaders(idempotencyKey),
      body: '{}',
    });
    return parseApiResponse(response, normalRequestActionResponseSchema);
  },
});

export const newIdempotencyKey = (): string => crypto.randomUUID();

export const createIdempotencyKeyStore = (generateKey: () => string = newIdempotencyKey) => {
  let signature: string | null = null;
  let key: string | null = null;

  return {
    keyFor(command: unknown): string {
      const nextSignature = JSON.stringify(command) ?? 'undefined';
      if (key === null || signature !== nextSignature) {
        signature = nextSignature;
        key = generateKey();
      }
      return key;
    },
  };
};
