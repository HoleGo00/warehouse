import { describe, expect, it, vi } from 'vitest';
import { createInventoryOperationsApi } from './inventory-operations-api.js';

const variantId = '11111111-1111-4111-8111-111111111111';
const requestId = '88888888-8888-4888-8888-888888888888';
const claimantId = '99999999-9999-4999-8999-999999999999';
const obligationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const operationResponse = {
  operation: {
    id: '22222222-2222-4222-8222-222222222222',
    operationNumber: 'IN-20260904-TEST',
    type: 'INBOUND',
    inboundType: 'PURCHASE',
    warehouse: 'YUHANG',
    sourceWarehouse: null,
    destinationWarehouse: null,
    actorUserId: '33333333-3333-4333-8333-333333333333',
    occurredAt: '2026-09-04T08:00:00.000Z',
    reason: '采购到货',
    notes: null,
    lines: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        variantId,
        productName: '健康腕表',
        variantName: '健康腕表',
        quantity: 1,
        systemQuantity: null,
        countedQuantity: null,
        difference: null,
        adjustedQuantity: 11,
      },
    ],
    movementIds: ['55555555-5555-4555-8555-555555555555'],
    outboxJobId: '66666666-6666-4666-8666-666666666666',
    availability: [
      {
        warehouseId: '77777777-7777-4777-8777-777777777777',
        variantId,
        confirmedFeishuQuantity: 10,
        pendingMovementDelta: 1,
        effectiveOnHandQuantity: 11,
        reservedQuantity: 0,
        availableQuantity: 11,
      },
    ],
  },
};

const requestActionResponse = {
  request: {
    id: requestId,
    requestNumber: 'REQ-20260904-TEST',
    warehouse: 'YUHANG',
    warehouseName: '余杭仓',
    claimantId,
    claimantName: '测试员工',
    origin: 'ONLINE',
    type: 'INTERNAL',
    purposeObject: '测试',
    finalDestination: '测试部门',
    notes: null,
    returnMode: 'BY_DATE',
    expectedReturnDate: '2026-09-04',
    status: 'COMPLETED',
    syncStatus: 'PENDING',
    itemCount: 1,
    totalQuantity: 1,
    submittedAt: '2026-09-04T00:00:00.000Z',
    createdAt: '2026-09-04T00:00:00.000Z',
    updatedAt: '2026-09-04T00:00:00.000Z',
    latestReviewComment: null,
    paperworkDueAt: null,
    paperworkOverdue: false,
    allowedActions: {
      resubmit: false,
      completePaperwork: false,
      cancel: false,
      review: false,
      fulfill: false,
      adminCancel: false,
      confirmReturn: true,
    },
    items: [
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        productId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
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

describe('inventory operations API adapter', () => {
  it('sends inbound commands with credentials and idempotency key', async () => {
    const fetchFunction = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(operationResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const api = createInventoryOperationsApi({ baseUrl: 'http://api.test', fetchFunction });
    await api.inbound(
      {
        warehouse: 'YUHANG',
        inboundType: 'PURCHASE',
        occurredAt: '2026-09-04T08:00:00.000Z',
        reason: '采购到货',
        lines: [{ variantId, quantity: 1 }],
      },
      'stable-key',
    );
    expect(fetchFunction).toHaveBeenCalledWith(
      new URL('http://api.test/admin/inventory/inbound'),
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: expect.objectContaining({ 'idempotency-key': 'stable-key' }),
      }),
    );
  });

  it('serializes task filters and calendar date ranges', async () => {
    const fetchFunction = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    const api = createInventoryOperationsApi({ baseUrl: 'http://api.test', fetchFunction });
    await api.tasks({ warehouse: 'YUHANG', severity: 'CRITICAL' });
    await api.calendar('2026-09-01', '2026-09-30');
    expect(String(fetchFunction.mock.calls[0]?.[0])).toContain('warehouse=YUHANG');
    expect(String(fetchFunction.mock.calls[0]?.[0])).toContain('severity=CRITICAL');
    expect(String(fetchFunction.mock.calls[1]?.[0])).toContain('from=2026-09-01');
  });

  it('uses every inventory-operation endpoint with credentials and mutation keys', async () => {
    const fetchFunction = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input.toString());
      let body: unknown;
      if (
        url.pathname === '/admin/inventory/inbound' ||
        url.pathname === '/admin/inventory/transfers' ||
        url.pathname === '/admin/inventory/stocktakes'
      ) {
        body = operationResponse;
      } else if (url.pathname === '/admin/returns/confirm') {
        body = requestActionResponse;
      } else if (url.pathname === '/admin/returns/departure-trigger') {
        body = { created: 1 };
      } else if (url.pathname === '/admin/returns' || url.pathname === '/admin/tasks') {
        body = { items: [] };
      } else if (url.pathname === '/admin/work-calendar/2026-09-05') {
        body =
          init?.method === 'DELETE'
            ? { deleted: true }
            : { date: '2026-09-05', isWorkingDay: true, description: null };
      } else if (url.pathname === '/admin/work-calendar') {
        body = { items: [] };
      } else {
        throw new Error(`Unexpected URL ${url}`);
      }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const api = createInventoryOperationsApi({ baseUrl: 'http://api.test', fetchFunction });
    const occurredAt = '2026-09-04T08:00:00.000Z';

    await api.inbound(
      {
        warehouse: 'YUHANG',
        inboundType: 'PURCHASE',
        occurredAt,
        reason: '采购到货',
        lines: [{ variantId, quantity: 1 }],
      },
      'inbound-key',
    );
    await api.transfer(
      {
        sourceWarehouse: 'YUHANG',
        destinationWarehouse: 'XIHU',
        occurredAt,
        reason: '仓间补货',
        lines: [{ variantId, quantity: 1 }],
      },
      'transfer-key',
    );
    await api.stocktake(
      {
        warehouse: 'YUHANG',
        occurredAt,
        reason: '月度盘点',
        lines: [{ variantId, countedQuantity: 1 }],
      },
      'stocktake-key',
    );
    await api.returns({ warehouse: 'YUHANG', status: 'PARTIAL' });
    await api.confirmReturn(
      {
        requestId,
        warehouse: 'YUHANG',
        occurredAt,
        lines: [{ obligationId, quantity: 1 }],
      },
      'return-key',
    );
    await api.triggerDeparture({ claimantId, reason: '离职同步异常兜底' }, 'departure-key');
    await api.tasks({ warehouse: 'YUHANG', type: 'RETURN_DUE', status: 'OPEN' });
    await api.calendar('2026-09-01', '2026-09-30');
    await api.upsertCalendar('2026-09-05', { isWorkingDay: true }, 'calendar-upsert-key');
    await api.deleteCalendar('2026-09-05', 'calendar-delete-key');

    expect(
      fetchFunction.mock.calls.map(([input, init]) => ({
        url: input.toString(),
        method: init?.method ?? 'GET',
        credentials: init?.credentials,
        key: new Headers(init?.headers).get('idempotency-key'),
      })),
    ).toEqual([
      {
        url: 'http://api.test/admin/inventory/inbound',
        method: 'POST',
        credentials: 'include',
        key: 'inbound-key',
      },
      {
        url: 'http://api.test/admin/inventory/transfers',
        method: 'POST',
        credentials: 'include',
        key: 'transfer-key',
      },
      {
        url: 'http://api.test/admin/inventory/stocktakes',
        method: 'POST',
        credentials: 'include',
        key: 'stocktake-key',
      },
      {
        url: 'http://api.test/admin/returns?warehouse=YUHANG&status=PARTIAL',
        method: 'GET',
        credentials: 'include',
        key: null,
      },
      {
        url: 'http://api.test/admin/returns/confirm',
        method: 'POST',
        credentials: 'include',
        key: 'return-key',
      },
      {
        url: 'http://api.test/admin/returns/departure-trigger',
        method: 'POST',
        credentials: 'include',
        key: 'departure-key',
      },
      {
        url: 'http://api.test/admin/tasks?warehouse=YUHANG&type=RETURN_DUE&status=OPEN',
        method: 'GET',
        credentials: 'include',
        key: null,
      },
      {
        url: 'http://api.test/admin/work-calendar?from=2026-09-01&to=2026-09-30',
        method: 'GET',
        credentials: 'include',
        key: null,
      },
      {
        url: 'http://api.test/admin/work-calendar/2026-09-05',
        method: 'PUT',
        credentials: 'include',
        key: 'calendar-upsert-key',
      },
      {
        url: 'http://api.test/admin/work-calendar/2026-09-05',
        method: 'DELETE',
        credentials: 'include',
        key: 'calendar-delete-key',
      },
    ]);
  });
});
