import { nextTick } from 'vue';
import { describe, expect, it } from 'vitest';
import { useNormalRequestForm } from './useNormalRequestForm.js';

const variantId = '11111111-1111-4111-8111-111111111111';

describe('useNormalRequestForm', () => {
  it('normalizes a fixed return policy and produces a trimmed command', async () => {
    const form = useNormalRequestForm({
      type: 'INTERNAL',
      purposeObject: ' 员工活动 ',
      finalDestination: ' 市场部 ',
      notes: ' 现场领取 ',
      returnMode: 'BY_DATE',
      expectedReturnDate: '2099-09-04',
      items: [{ variantId, quantity: 2 }],
    });

    form.draft.type = 'SALE';
    await nextTick();

    expect(form.draft.returnMode).toBe('NOT_REQUIRED');
    expect(form.draft.expectedReturnDate).toBeNull();
    expect(form.toCommand()).toMatchObject({
      type: 'SALE',
      notes: '现场领取',
      items: [{ variantId, quantity: 2 }],
    });
  });
});
