import { describe, expect, it, vi } from 'vitest';
import { createReportApi } from './report-api.js';
describe('report API', () => {
  it('serializes filters and does not export only the current page', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ items: [], nextCursor: null })));
    const api = createReportApi({ baseUrl: 'http://localhost', fetchFunction: fetcher });
    await api.query(
      { dateMode: 'FULFILLED', category: 'SMART_RING', finalDestination: 'a&b' },
      'cursor',
    );
    const url = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(url.searchParams.get('finalDestination')).toBe('a&b');
    expect(url.searchParams.get('dateMode')).toBe('FULFILLED');
    expect(fetcher.mock.calls[0]?.[1].credentials).toBe('include');
  });
  it('surfaces expiration instead of downloading a JSON error', async () => {
    const api = createReportApi({
      baseUrl: 'http://localhost',
      fetchFunction: async () =>
        new Response(
          JSON.stringify({
            code: 'EXPORT_EXPIRED',
            message: '已过期',
            traceId: '11111111-1111-4111-8111-111111111111',
          }),
          { status: 410 },
        ),
    });
    await expect(api.checkDownload('id')).rejects.toMatchObject({ code: 'EXPORT_EXPIRED' });
  });
});
