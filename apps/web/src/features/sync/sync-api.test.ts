import { describe, expect, it, vi } from 'vitest';
import { createSyncApi } from './sync-api.js';
import { jobStatusLabel, syncActionError, syncErrorLabel } from './sync-view-model.js';
import type { SyncJob } from '@glorychips/contracts';

const job: SyncJob = {
  id: '11111111-1111-4111-8111-111111111111',
  type: 'SYNC_INVENTORY_MOVEMENTS',
  businessNumber: 'IN-1',
  status: 'RETRY',
  attempts: 2,
  availableAt: '2026-09-05T00:00:00.000Z',
  createdAt: '2026-09-05T00:00:00.000Z',
  lastError: null,
  lastErrorCode: null,
  canRetry: true,
  steps: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      target: 'RING_BASE',
      status: 'SUCCEEDED',
      attempts: 1,
      availableAt: '2026-09-05T00:00:00.000Z',
      startedAt: null,
      completedAt: null,
      lastError: null,
      lastErrorCode: null,
    },
  ],
};
describe('synchronization API adapter', () => {
  it('uses authenticated reads, filters, abort signals and every endpoint', async () => {
    const fetchFunction = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ items: [] }));
    const api = createSyncApi({ baseUrl: 'http://localhost:3000', fetchFunction });
    const signal = new AbortController().signal;
    await api.jobs({ target: 'WATCH_BASE', status: 'RETRY', limit: 10 }, signal);
    expect(String(fetchFunction.mock.calls[0]![0])).toBe(
      'http://localhost:3000/admin/sync/jobs?target=WATCH_BASE&status=RETRY&limit=10',
    );
    expect(fetchFunction.mock.calls[0]![1]).toMatchObject({ credentials: 'include', signal });
    await api.reconciliations({ warehouse: 'YUHANG' });
    await api.bindings();
    await api.migrations();
    expect(fetchFunction.mock.calls.slice(1).map(([url]) => new URL(String(url)).pathname)).toEqual(
      ['/admin/sync/reconciliations', '/admin/sync/bindings', '/admin/migrations'],
    );
    fetchFunction.mockResolvedValueOnce(Response.json({ job }));
    expect((await api.job(job.id)).job.id).toBe(job.id);
  });
  it('sends the same supplied key and typed mutation body', async () => {
    const fetchFunction = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ job }))
      .mockResolvedValueOnce(Response.json({ jobId: job.id }));
    const api = createSyncApi({ baseUrl: 'http://localhost:3000', fetchFunction });
    await api.retry(job.id, { reason: 'Retry', target: 'WATCH_BASE' }, 'retry-key');
    await api.runReconciliation({}, 'run-key');
    expect(fetchFunction.mock.calls[0]![1]).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: { 'idempotency-key': 'retry-key' },
      body: JSON.stringify({ reason: 'Retry', target: 'WATCH_BASE' }),
    });
    expect(fetchFunction.mock.calls[1]![1]).toMatchObject({
      headers: { 'idempotency-key': 'run-key' },
    });
  });
  it('rejects malformed responses and never renders raw provider errors', async () => {
    const api = createSyncApi({
      baseUrl: 'http://localhost:3000',
      fetchFunction: vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ items: [{ secret: 'raw' }] })),
    });
    await expect(api.jobs({})).rejects.toHaveProperty('name', 'ZodError');
    expect(syncActionError(new Error('secret token and raw provider details'))).not.toContain(
      'secret',
    );
    expect(syncErrorLabel('UNKNOWN_PROVIDER_ERROR')).toBe('同步异常');
    expect(jobStatusLabel(job)).toBe('部分已同步 · 等待重试');
    expect(jobStatusLabel({ ...job, status: 'SUCCEEDED' })).toBe('已同步');
  });
});
