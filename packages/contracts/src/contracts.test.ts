import { describe, expect, it } from 'vitest';
import {
  calculateAvailability,
  normalizeAuthReturnPath,
  productCatalog,
  productStatusSchema,
  ringSizeSchema,
  ringSizes,
  updateAccessRequestSchema,
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

  it('normalizes only known internal authentication return paths', () => {
    expect(normalizeAuthReturnPath('/w/XIHU/apply?source=qr')).toBe('/w/XIHU/apply?source=qr');
    expect(normalizeAuthReturnPath('/w/UNKNOWN/apply')).toBe('/');
    expect(normalizeAuthReturnPath('//evil.example/path')).toBe('/');
    expect(normalizeAuthReturnPath('https://evil.example/path')).toBe('/');
  });

  it('rejects invalid warehouse administrator access profiles', () => {
    expect(
      updateAccessRequestSchema.safeParse({
        roles: ['CLAIMANT', 'WAREHOUSE_ADMIN'],
        warehouses: [],
      }).success,
    ).toBe(false);
    expect(
      updateAccessRequestSchema.safeParse({
        roles: ['CLAIMANT', 'WAREHOUSE_ADMIN'],
        warehouses: ['XIHU'],
      }).success,
    ).toBe(true);
  });
});
