import { describe, expect, it } from 'vitest';
import {
  calculateAvailability,
  productCatalog,
  productStatusSchema,
  ringSizeSchema,
  ringSizes,
} from './index.js';

describe('shared contracts', () => {
  it('defines the exact supported ring sizes', () => {
    expect(ringSizes).toEqual(['6#', '7#', '8#', '9#', '10#', '11#', '12#', '13#']);
    expect(ringSizeSchema.safeParse('14#').success).toBe(false);
  });

  it('keeps the approved product catalog in one shared contract', () => {
    expect(productCatalog).toHaveLength(14);
    expect(
      productCatalog.filter((product) => product.status === 'INACTIVE_HISTORICAL'),
    ).toHaveLength(3);
    expect(productStatusSchema.parse('INACTIVE_HISTORICAL')).toBe('INACTIVE_HISTORICAL');
  });

  it('computes effective and available quantities', () => {
    expect(
      calculateAvailability({
        confirmedFeishuQuantity: 10,
        pendingMovementDelta: -2,
        reservedQuantity: 3,
      }),
    ).toEqual({ effectiveOnHandQuantity: 8, availableQuantity: 5 });
  });
});
