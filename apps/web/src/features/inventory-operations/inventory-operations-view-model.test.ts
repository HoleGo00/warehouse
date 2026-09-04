import { describe, expect, it } from 'vitest';
import {
  managedWarehouseCodes,
  shanghaiCalendarDefaults,
  validReturnQuantities,
} from './inventory-operations-view-model.js';

describe('inventory operations view model', () => {
  it('keeps warehouse filters inside the authenticated administrator scope', () => {
    expect(
      managedWarehouseCodes({ roles: ['CLAIMANT', 'WAREHOUSE_ADMIN'], warehouses: ['YUHANG'] }),
    ).toEqual(['YUHANG']);
    expect(managedWarehouseCodes({ roles: ['CLAIMANT', 'SYSTEM_ADMIN'], warehouses: [] })).toEqual([
      'XIHU',
      'YUHANG',
    ]);
  });

  it('requires at least one valid return quantity and rejects any over-returned line', () => {
    const obligations = [
      { id: 'first', remainingQuantity: 2 },
      { id: 'second', remainingQuantity: 3 },
    ];
    expect(validReturnQuantities(obligations, { first: '0', second: '0' })).toBe(false);
    expect(validReturnQuantities(obligations, { first: '1', second: '4' })).toBe(false);
    expect(validReturnQuantities(obligations, { first: '1', second: '0' })).toBe(true);
  });

  it('derives the current Shanghai month range at UTC date boundaries', () => {
    expect(shanghaiCalendarDefaults(new Date('2026-08-31T16:30:00.000Z'))).toEqual({
      date: '2026-09-01',
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });
});
