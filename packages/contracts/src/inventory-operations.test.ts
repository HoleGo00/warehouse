import { describe, expect, it } from 'vitest';
import {
  adminTaskQuerySchema,
  confirmReturnSchema,
  createInboundSchema,
  createStocktakeSchema,
  createTransferSchema,
  workCalendarQuerySchema,
} from './inventory-operations.js';

const variantId = '11111111-1111-4111-8111-111111111111';

describe('inventory operation contracts', () => {
  it('accepts a multi-line inbound command and rejects duplicate variants', () => {
    const base = {
      warehouse: 'YUHANG',
      inboundType: 'PURCHASE',
      occurredAt: '2026-09-04T08:00:00.000Z',
      reason: '采购到货',
      lines: [{ variantId, quantity: 2 }],
    };
    expect(createInboundSchema.safeParse(base).success).toBe(true);
    expect(
      createInboundSchema.safeParse({ ...base, lines: [...base.lines, ...base.lines] }).success,
    ).toBe(false);
  });

  it('requires different transfer warehouses and positive quantities', () => {
    expect(
      createTransferSchema.safeParse({
        sourceWarehouse: 'YUHANG',
        destinationWarehouse: 'YUHANG',
        occurredAt: '2026-09-04T08:00:00.000Z',
        reason: '调拨',
        lines: [{ variantId, quantity: 1 }],
      }).success,
    ).toBe(false);
  });

  it('accepts zero counted stock and rejects duplicate return obligations', () => {
    expect(
      createStocktakeSchema.safeParse({
        warehouse: 'YUHANG',
        occurredAt: '2026-09-04T08:00:00.000Z',
        reason: '盘点复核',
        lines: [{ variantId, countedQuantity: 0 }],
      }).success,
    ).toBe(true);
    const line = { obligationId: variantId, quantity: 1 };
    expect(
      confirmReturnSchema.safeParse({
        requestId: '22222222-2222-4222-8222-222222222222',
        warehouse: 'YUHANG',
        occurredAt: '2026-09-04T08:00:00.000Z',
        lines: [line, line],
      }).success,
    ).toBe(false);
  });

  it('validates task filters and calendar ranges at the boundary', () => {
    expect(adminTaskQuerySchema.parse({ severity: 'CRITICAL' })).toEqual({ severity: 'CRITICAL' });
    expect(workCalendarQuerySchema.safeParse({ from: '2026-09-01', to: 'bad' }).success).toBe(
      false,
    );
  });
});
