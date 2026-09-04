import { describe, expect, it } from 'vitest';
import type { InventoryProductProjection } from '@glorychips/contracts';
import {
  hasPendingSync,
  productStatusLabel,
  quantityForWarehouse,
  quantitySummary,
} from './inventory-view-model.js';

const product: InventoryProductProjection = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'WATCH_HISTORY',
  name: '历史腕表',
  category: 'SMART_WATCH',
  status: 'INACTIVE_HISTORICAL',
  imageReady: false,
  mainImage: null,
  variants: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      code: 'DEFAULT',
      displayName: '历史腕表',
      size: null,
      isActive: false,
      warehouses: [
        {
          warehouse: 'XIHU',
          confirmedFeishuQuantity: 8,
          pendingMovementDelta: -2,
          effectiveOnHandQuantity: 6,
          reservedQuantity: 1,
          availableQuantity: 5,
          syncIndicator: 'PENDING_LOCAL_CHANGES',
        },
      ],
      total: {
        confirmedFeishuQuantity: 8,
        pendingMovementDelta: -2,
        effectiveOnHandQuantity: 6,
        reservedQuantity: 1,
        availableQuantity: 5,
        syncIndicator: 'PENDING_LOCAL_CHANGES',
      },
    },
  ],
};

describe('inventory view model', () => {
  it('preserves historical and pending-sync labels', () => {
    expect(productStatusLabel(product.status)).toBe('历史停用');
    expect(hasPendingSync(product)).toBe(true);
  });

  it('finds exact warehouse quantities and formats their source breakdown', () => {
    const variant = product.variants[0];
    if (variant === undefined) throw new Error('The fixture variant is required.');
    const quantity = quantityForWarehouse(variant, 'XIHU');
    expect(quantity?.availableQuantity).toBe(5);
    expect(quantity === null ? '' : quantitySummary(quantity)).toBe('飞书 8 / 待同步 -2 / 预占 1');
    expect(quantityForWarehouse(variant, 'YUHANG')).toBeNull();
  });
});
