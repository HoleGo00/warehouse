import { describe, expect, it } from 'vitest';
import { hashCommand } from './stable-json.js';

describe('hashCommand', () => {
  it('is stable across object key order', () => {
    expect(hashCommand({ warehouseId: 'a', variantId: 'b' })).toBe(
      hashCommand({ variantId: 'b', warehouseId: 'a' }),
    );
  });

  it('normalizes dates to ISO strings', () => {
    expect(hashCommand({ at: new Date('2026-08-31T00:00:00.000Z') })).toBe(
      hashCommand({ at: '2026-08-31T00:00:00.000Z' }),
    );
  });
});
