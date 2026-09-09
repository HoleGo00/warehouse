import { effectScope, nextTick, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type { AuthMeResponse } from '@glorychips/contracts';
import { useReports } from './useReports.js';
import { createReportApi } from './report-api.js';
import { ApiClientError } from '../shared/api-client.js';
const sessionValue: AuthMeResponse = {
  authenticated: true,
  user: {
    id: '11111111-1111-4111-8111-111111111111',
    feishuUserId: 'u',
    name: 'Test',
    avatarUrl: null,
  },
  access: { roles: ['SYSTEM_ADMIN'], warehouses: [] },
  expiresAt: '2030-01-01T00:00:00.000Z',
};
describe('report state', () => {
  it('does not restore a late response after permissions have been revoked', async () => {
    const session = ref<AuthMeResponse>(structuredClone(sessionValue));
    let respond!: (value: { items: []; nextCursor: string }) => void;
    const api = {
      ...createReportApi(),
      query: vi.fn(
        () =>
          new Promise<{ items: []; nextCursor: string }>((resolve) => {
            respond = resolve;
          }),
      ),
      exports: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    };
    const scope = effectScope();
    const state = scope.run(() => useReports(session, api))!;
    session.value.access = { roles: ['CLAIMANT'], warehouses: [] };
    await nextTick();
    respond({ items: [], nextCursor: 'stale' });
    await nextTick();
    await nextTick();
    expect(state.nextCursor.value).toBeNull();
    expect(state.rows.value).toEqual([]);
    scope.stop();
  });
  it('clears a denied page and stops export polling until the session changes', async () => {
    const session = ref<AuthMeResponse>(structuredClone(sessionValue));
    const api = {
      ...createReportApi(),
      query: vi.fn().mockRejectedValue(new ApiClientError('FORBIDDEN_ROLE', '权限已撤销')),
      exports: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    };
    const scope = effectScope();
    const state = scope.run(() => useReports(session, api))!;
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.allowed.value).toBe(false);
    expect(state.loading.value).toBe(false);
    await state.loadJobs();
    expect(api.exports).not.toHaveBeenCalled();
    scope.stop();
  });
  it('reuses an uncertain export key and clears data on permission revocation', async () => {
    const session = ref<AuthMeResponse>(structuredClone(sessionValue));
    const api = {
      ...createReportApi(),
      query: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      exports: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      createExport: vi.fn().mockRejectedValue(new Error('network lost')),
    };
    const scope = effectScope();
    const state = scope.run(() => useReports(session, api))!;
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await state.createExport();
    await state.createExport();
    expect(api.createExport.mock.calls[0]?.[1]).toBe(api.createExport.mock.calls[1]?.[1]);
    session.value.access = { roles: ['CLAIMANT'], warehouses: [] };
    await nextTick();
    expect(state.allowed.value).toBe(false);
    expect(state.rows.value).toEqual([]);
    expect(state.jobs.value).toEqual([]);
    scope.stop();
  });
});
