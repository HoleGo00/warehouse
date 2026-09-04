import { describe, expect, it } from 'vitest';
import { createIdempotencyKeyStore, createRequestApi } from './request-api.js';

const requestId = '11111111-1111-4111-8111-111111111111';
const variantId = '22222222-2222-4222-8222-222222222222';
const responseBody = {
  request: {
    id: requestId,
    requestNumber: 'NR-20260904-TEST',
    warehouse: 'YUHANG',
    warehouseName: '余杭仓',
    claimantId: '33333333-3333-4333-8333-333333333333',
    claimantName: '测试员工',
    type: 'INTERNAL',
    purposeObject: '测试',
    finalDestination: '测试部门',
    notes: null,
    returnMode: 'NOT_REQUIRED',
    expectedReturnDate: null,
    status: 'PENDING_APPROVAL',
    syncStatus: 'NOT_REQUIRED',
    itemCount: 1,
    totalQuantity: 1,
    submittedAt: '2026-09-04T00:00:00.000Z',
    createdAt: '2026-09-04T00:00:00.000Z',
    updatedAt: '2026-09-04T00:00:00.000Z',
    latestReviewComment: null,
    allowedActions: {
      resubmit: false,
      cancel: true,
      review: false,
      fulfill: false,
      adminCancel: false,
    },
    items: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        productId: '55555555-5555-4555-8555-555555555555',
        variantId,
        productName: '健康腕表',
        variantName: '健康腕表',
        size: null,
        quantity: 1,
      },
    ],
    approvals: [],
    fulfillment: null,
    returnObligations: [],
  },
};

describe('normal request API adapter', () => {
  it('reuses a key for the same command and rotates it after input changes', () => {
    let sequence = 0;
    const keys = createIdempotencyKeyStore(() => `key-${++sequence}`);

    expect(keys.keyFor({ requestId: 'request-a', reason: 'same' })).toBe('key-1');
    expect(keys.keyFor({ requestId: 'request-a', reason: 'same' })).toBe('key-1');
    expect(keys.keyFor({ requestId: 'request-a', reason: 'changed' })).toBe('key-2');
  });

  it('sends credentials and a stable idempotency header for submission', async () => {
    let requestedUrl = '';
    let requestedInit: RequestInit | undefined;
    const api = createRequestApi({
      baseUrl: 'http://localhost:3000',
      fetchFunction: async (input, init) => {
        requestedUrl = input.toString();
        requestedInit = init;
        return new Response(JSON.stringify(responseBody), { status: 201 });
      },
    });

    await api.create(
      {
        warehouse: 'YUHANG',
        type: 'INTERNAL',
        purposeObject: '测试',
        finalDestination: '测试部门',
        returnMode: 'NOT_REQUIRED',
        items: [{ variantId, quantity: 1 }],
      },
      'stable-submit-key',
    );

    expect(requestedUrl).toBe('http://localhost:3000/requests/normal');
    expect(requestedInit?.credentials).toBe('include');
    expect(requestedInit?.headers).toMatchObject({ 'idempotency-key': 'stable-submit-key' });
  });

  it('uses the administrator queue and fulfillment endpoints', async () => {
    const urls: string[] = [];
    const api = createRequestApi({
      baseUrl: 'http://localhost:3000',
      fetchFunction: async (input) => {
        urls.push(input.toString());
        return new Response(JSON.stringify(urls.length === 1 ? { items: [] } : responseBody), {
          status: 200,
        });
      },
    });
    await api.adminQueue({ warehouse: 'YUHANG', status: 'PENDING_RELEASE' });
    await api.fulfill(requestId, 'fulfill-key');
    expect(urls).toEqual([
      'http://localhost:3000/admin/requests?warehouse=YUHANG&status=PENDING_RELEASE',
      `http://localhost:3000/admin/requests/${requestId}/fulfill`,
    ]);
  });
});
