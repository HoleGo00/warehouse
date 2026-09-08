import { afterEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, shallowRef } from 'vue';
import type { SyncJob } from '@glorychips/contracts';
import type { SyncApi } from './sync-api.js';
import { useSyncAdmin } from './useSyncAdmin.js';

const job: SyncJob = {
  id: '11111111-1111-4111-8111-111111111111',
  type: 'SYNC_INVENTORY_MOVEMENTS',
  businessNumber: 'IN-001',
  status: 'RETRY',
  attempts: 1,
  availableAt: '2026-09-05T00:00:00.000Z',
  createdAt: '2026-09-05T00:00:00.000Z',
  lastErrorCode: null,
  lastError: null,
  canRetry: true,
  steps: [],
};
const pending = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const scopes: ReturnType<typeof effectScope>[] = [];
const setup = (permitted = true) => {
  const api = {
    jobs: vi.fn<SyncApi['jobs']>().mockResolvedValue({ items: [] }),
    job: vi.fn<SyncApi['job']>().mockResolvedValue({ job }),
    retry: vi.fn<SyncApi['retry']>().mockResolvedValue({ job: { ...job, canRetry: false } }),
    reconciliations: vi.fn<SyncApi['reconciliations']>().mockResolvedValue({ items: [] }),
    runReconciliation: vi.fn<SyncApi['runReconciliation']>().mockResolvedValue({ jobId: job.id }),
    bindings: vi.fn<SyncApi['bindings']>().mockResolvedValue({ items: [] }),
    migrations: vi.fn<SyncApi['migrations']>().mockResolvedValue({ items: [] }),
  };
  const allowed = shallowRef(permitted);
  const scope = effectScope();
  scopes.push(scope);
  const state = scope.run(() => useSyncAdmin(allowed, api))!;
  return { api, allowed, scope, state };
};
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.stop());
});

describe('synchronization administration state', () => {
  it('does not fetch or mutate without system administrator permission', async () => {
    const { state, api } = setup(false);
    await state.openDetail(job.id);
    await state.retry({ reason: 'Retry' });
    await state.runReconciliation();
    expect(api.jobs).not.toHaveBeenCalled();
    expect(api.job).not.toHaveBeenCalled();
    expect(api.retry).not.toHaveBeenCalled();
    expect(api.runReconciliation).not.toHaveBeenCalled();
  });

  it('aborts previous reads and ignores responses arriving after a filter change', async () => {
    const { state, api } = setup();
    const stale = pending<{ items: SyncJob[] }>();
    api.jobs.mockReturnValueOnce(stale.promise);
    const oldLoad = state.load();
    const signal = api.jobs.mock.calls.at(-1)![1]!;
    state.target.value = 'WATCH_BASE';
    await nextTick();
    await vi.waitFor(() => expect(state.loading.value).toBe(false));
    expect(signal.aborted).toBe(true);
    stale.resolve({ items: [job] });
    await oldLoad;
    expect(state.jobs.value).toEqual([]);
    expect(api.jobs.mock.calls.at(-1)![0]).toEqual({ target: 'WATCH_BASE' });
  });

  it('suppresses double submission and reuses the key after an uncertain failure', async () => {
    const { state, api } = setup();
    await state.openDetail(job.id);
    const response = pending<{ job: SyncJob }>();
    api.retry.mockReturnValueOnce(response.promise);
    const first = state.retry({ reason: 'Retry' });
    await state.retry({ reason: 'Retry' });
    expect(api.retry).toHaveBeenCalledTimes(1);
    response.reject(new TypeError('Network interrupted'));
    await first;
    expect(state.detailError.value).toBeTruthy();
    await state.retry({ reason: 'Retry' });
    expect(api.retry).toHaveBeenCalledTimes(2);
    expect(api.retry.mock.calls[1]![2]).toBe(api.retry.mock.calls[0]![2]);
    expect(state.detailOpen.value).toBe(false);
    expect(state.message.value).toBe('已提交重试');
  });

  it('does not show pending detail or mutation responses after permission revocation', async () => {
    const { state, api, allowed } = setup();
    await state.openDetail(job.id);
    const mutation = pending<{ job: SyncJob }>();
    api.retry.mockReturnValueOnce(mutation.promise);
    const action = state.retry({ reason: 'Retry' });
    allowed.value = false;
    expect(state.detail.value).toBeNull();
    expect(state.detailOpen.value).toBe(false);
    mutation.resolve({ job });
    await action;
    expect(state.detail.value).toBeNull();
    expect(state.message.value).toBeNull();
    expect(state.busy.value).toBe(false);
    allowed.value = true;
    await nextTick();
    const response = pending<{ job: SyncJob }>();
    api.job.mockReturnValueOnce(response.promise);
    const detail = state.openDetail(job.id);
    allowed.value = false;
    response.resolve({ job });
    await detail;
    expect(state.detail.value).toBeNull();
  });

  it('ignores late responses and further actions after scope disposal', async () => {
    const { state, api, scope } = setup();
    const response = pending<{ job: SyncJob }>();
    api.job.mockReturnValueOnce(response.promise);
    const detail = state.openDetail(job.id);
    const signal = api.job.mock.calls[0]![1]!;
    scope.stop();
    response.resolve({ job });
    await detail;
    expect(signal.aborted).toBe(true);
    expect(state.detail.value).toBeNull();
    await state.runReconciliation();
    expect(api.runReconciliation).not.toHaveBeenCalled();
  });

  it('keeps reconciliation idempotency keys scoped to the selected target', async () => {
    const { state, api } = setup();
    api.runReconciliation.mockRejectedValue(new TypeError('Network interrupted'));
    await state.runReconciliation();
    await state.runReconciliation();
    expect(api.runReconciliation.mock.calls[0]![1]).toBe(api.runReconciliation.mock.calls[1]![1]);
    state.target.value = 'RING_BASE';
    await state.runReconciliation();
    expect(api.runReconciliation.mock.calls[2]![0]).toEqual({ target: 'RING_BASE' });
    expect(api.runReconciliation.mock.calls[2]![1]).not.toBe(
      api.runReconciliation.mock.calls[0]![1],
    );
  });
});
