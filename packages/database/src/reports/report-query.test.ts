import { describe, expect, it } from 'vitest';
import { reportFiltersSchema } from '@glorychips/contracts';
import {
  decodeReportCursor,
  encodeReportCursor,
  reportDateBoundary,
  reportHash,
  reportItemsWhere,
} from './report-query.js';

describe('report query primitives', () => {
  it('uses Shanghai inclusive calendar days', () => {
    expect(reportDateBoundary('2026-09-01').toISOString()).toBe('2026-08-31T16:00:00.000Z');
    expect(reportDateBoundary('2026-09-01', true).toISOString()).toBe('2026-09-01T16:00:00.000Z');
  });
  it('binds cursors to filters and warehouse scope', () => {
    const filters = reportFiltersSchema.parse({});
    const hash = reportHash(filters, ['XIHU']);
    const cursor = encodeReportCursor('00000000-0000-4000-8000-000000000001', new Date(), hash);
    expect(decodeReportCursor(cursor, hash).hash).toBe(hash);
    expect(() => decodeReportCursor(cursor, reportHash(filters, ['YUHANG']))).toThrow();
    expect(() => decodeReportCursor('not-json', hash)).toThrow();
  });
  it('combines item predicates rather than independent EXISTS clauses', () => {
    expect(
      reportItemsWhere(reportFiltersSchema.parse({ category: 'SMART_RING', size: '8#' })),
    ).toEqual({ product: { category: { code: 'SMART_RING' } }, sizeSnapshot: '8#' });
  });
});
