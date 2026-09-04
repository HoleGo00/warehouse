import { describe, expect, it } from 'vitest';
import {
  cancelNormalRequestSchema,
  completeTemporaryPaperworkSchema,
  createNormalRequestSchema,
  createOfflineRequestSchema,
  createTemporaryRequestSchema,
  reviewNormalRequestSchema,
} from './requests.js';

const variantId = '11111111-1111-4111-8111-111111111111';
const base = {
  warehouse: 'XIHU' as const,
  purposeObject: '员工健康管理',
  finalDestination: '市场部',
  items: [{ variantId, quantity: 2 }],
};

describe('normal request contracts', () => {
  it.each([
    { type: 'GIFT', returnMode: 'NOT_REQUIRED' },
    { type: 'SALE', returnMode: 'NOT_REQUIRED' },
    { type: 'EXHIBIT', returnMode: 'BY_DATE', expectedReturnDate: '2026-09-04' },
    { type: 'INTERNAL', returnMode: 'ON_DEPARTURE' },
    { type: 'INTERNAL', returnMode: 'BY_DATE', expectedReturnDate: '2026-09-04' },
  ] as const)('accepts the supported return policy %#', (policy) => {
    expect(createNormalRequestSchema.safeParse({ ...base, ...policy }).success).toBe(true);
  });

  it.each([
    { type: 'GIFT', returnMode: 'BY_DATE', expectedReturnDate: '2026-09-04' },
    { type: 'SALE', returnMode: 'NOT_REQUIRED', expectedReturnDate: '2026-09-04' },
    { type: 'EXHIBIT', returnMode: 'NOT_REQUIRED' },
    { type: 'INTERNAL', returnMode: 'BY_DATE' },
    { type: 'INTERNAL', returnMode: 'ON_DEPARTURE', expectedReturnDate: '2026-09-04' },
  ] as const)('rejects an unsupported return policy %#', (policy) => {
    expect(createNormalRequestSchema.safeParse({ ...base, ...policy }).success).toBe(false);
  });

  it('rejects duplicate variants and non-positive quantities', () => {
    expect(
      createNormalRequestSchema.safeParse({
        ...base,
        type: 'INTERNAL',
        returnMode: 'NOT_REQUIRED',
        items: [
          { variantId, quantity: 1 },
          { variantId, quantity: 0 },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects impossible calendar dates', () => {
    expect(
      createNormalRequestSchema.safeParse({
        ...base,
        type: 'EXHIBIT',
        returnMode: 'BY_DATE',
        expectedReturnDate: '2026-02-30',
      }).success,
    ).toBe(false);
  });

  it('requires rejection comments and cancellation reasons', () => {
    expect(reviewNormalRequestSchema.safeParse({ decision: 'REJECTED' }).success).toBe(false);
    expect(reviewNormalRequestSchema.safeParse({ decision: 'APPROVED' }).success).toBe(true);
    expect(cancelNormalRequestSchema.safeParse({ reason: '  ' }).success).toBe(false);
  });

  it('accepts a minimal temporary request and rejects duplicate variants', () => {
    expect(
      createTemporaryRequestSchema.safeParse({
        warehouse: 'YUHANG',
        items: [{ variantId, quantity: 1 }],
      }).success,
    ).toBe(true);
    expect(
      createTemporaryRequestSchema.safeParse({
        warehouse: 'YUHANG',
        items: [
          { variantId, quantity: 1 },
          { variantId, quantity: 2 },
        ],
      }).success,
    ).toBe(false);
  });

  it('requires complete policy fields for paperwork and offline registration', () => {
    const paperwork = {
      type: 'INTERNAL' as const,
      purposeObject: '展会健康体验',
      finalDestination: '市场部',
      returnMode: 'ON_DEPARTURE' as const,
    };
    expect(completeTemporaryPaperworkSchema.safeParse(paperwork).success).toBe(true);
    expect(
      createOfflineRequestSchema.safeParse({
        warehouse: 'YUHANG',
        claimantId: '22222222-2222-4222-8222-222222222222',
        ...paperwork,
        items: [{ variantId, quantity: 1 }],
      }).success,
    ).toBe(true);
    expect(
      completeTemporaryPaperworkSchema.safeParse({ ...paperwork, purposeObject: '' }).success,
    ).toBe(false);
  });
});
