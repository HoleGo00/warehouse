import { describe, expect, it } from 'vitest';
import { reportFiltersSchema, reportQuerySchema } from './request-report.js';

describe('report filters', () => {
  it('defaults to submission date and preserves same-line filters', () => {
    expect(reportQuerySchema.parse({ category: 'SMART_RING', size: '8#' })).toEqual({
      category: 'SMART_RING',
      size: '8#',
      dateMode: 'SUBMITTED',
      limit: 50,
    });
  });
  it('rejects reversed or invalid dates, oversized pages and unknown filters', () => {
    for (const query of [
      { from: '2026-09-03', to: '2026-09-01' },
      { from: '2026-02-30' },
      { limit: 101 },
      { dateMode: 'COMPLETED' },
      { warehouse: 'OTHER' },
      { sql: '1=1' },
    ])
      expect(reportQuerySchema.safeParse(query).success).toBe(false);
  });
  it('allows fulfilled dates and trims destination', () => {
    expect(
      reportFiltersSchema.parse({ dateMode: 'FULFILLED', finalDestination: ' office ' })
        .finalDestination,
    ).toBe('office');
  });
});
