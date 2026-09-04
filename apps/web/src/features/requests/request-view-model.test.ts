import { describe, expect, it } from 'vitest';
import type { CatalogListResponse, InventoryQueryResponse } from '@glorychips/contracts';
import {
  buildRequestVariantOptions,
  normalizeReturnPolicy,
  totalRequestQuantity,
  validateNormalRequestDraft,
} from './request-view-model.js';

const variantId = '11111111-1111-4111-8111-111111111111';
const productId = '22222222-2222-4222-8222-222222222222';

const catalog: CatalogListResponse = {
  items: [
    {
      id: productId,
      code: 'WATCH_TEST',
      name: '测试腕表',
      category: 'SMART_WATCH',
      specificationMode: 'NONE',
      status: 'ACTIVE',
      baseTarget: 'WATCH',
      imageReady: false,
      mainImage: null,
      detailImages: [],
      variants: [
        { id: variantId, code: 'DEFAULT', displayName: '测试腕表', size: null, isActive: true },
      ],
    },
  ],
};

const inventory: InventoryQueryResponse = {
  warehouse: 'YUHANG',
  category: null,
  warehouses: [{ code: 'YUHANG', name: '余杭仓' }],
  products: [
    {
      id: productId,
      code: 'WATCH_TEST',
      name: '测试腕表',
      category: 'SMART_WATCH',
      status: 'ACTIVE',
      imageReady: false,
      mainImage: null,
      variants: [
        {
          id: variantId,
          code: 'DEFAULT',
          displayName: '测试腕表',
          size: null,
          isActive: true,
          warehouses: [
            {
              warehouse: 'YUHANG',
              confirmedFeishuQuantity: 8,
              pendingMovementDelta: -1,
              effectiveOnHandQuantity: 7,
              reservedQuantity: 2,
              availableQuantity: 5,
              syncIndicator: 'PENDING_LOCAL_CHANGES',
            },
          ],
          total: {
            confirmedFeishuQuantity: 8,
            pendingMovementDelta: -1,
            effectiveOnHandQuantity: 7,
            reservedQuantity: 2,
            availableQuantity: 5,
            syncIndicator: 'PENDING_LOCAL_CHANGES',
          },
        },
      ],
    },
  ],
};

describe('normal request view model', () => {
  it('joins selectable catalog variants with the locked warehouse availability', () => {
    expect(buildRequestVariantOptions(catalog, inventory, 'YUHANG')).toEqual([
      {
        productId,
        variantId,
        productName: '测试腕表',
        variantName: '测试腕表',
        category: 'SMART_WATCH',
        availableQuantity: 5,
      },
    ]);
  });

  it('normalizes fixed return policies when request type changes', () => {
    expect(normalizeReturnPolicy('SALE', 'BY_DATE')).toEqual({
      returnMode: 'NOT_REQUIRED',
      expectedReturnDate: null,
    });
    expect(normalizeReturnPolicy('EXHIBIT', 'NOT_REQUIRED')).toEqual({
      returnMode: 'BY_DATE',
      expectedReturnDate: null,
    });
  });

  it('validates past return dates and derives quantity totals', () => {
    const draft = {
      type: 'INTERNAL' as const,
      purposeObject: '测试',
      finalDestination: '测试部门',
      returnMode: 'BY_DATE' as const,
      expectedReturnDate: '2026-09-03',
      items: [{ variantId, quantity: 3 }],
    };
    expect(validateNormalRequestDraft(draft, '2026-09-04')).toContain('预计归还日期不能早于今天');
    expect(totalRequestQuantity(draft)).toBe(3);
  });
});
