import { effectScope, nextTick } from 'vue';
import { describe, expect, it } from 'vitest';
import type { InventoryQuery, InventoryQueryResponse } from '@glorychips/contracts';
import { useInventoryQuery } from './useInventoryQuery.js';

interface DeferredResponse {
  readonly query: InventoryQuery;
  resolve(response: InventoryQueryResponse): void;
  reject(error: Error): void;
}

const responseFor = (query: InventoryQuery): InventoryQueryResponse => ({
  warehouse: query.warehouse,
  category: query.category ?? null,
  warehouses: [],
  products: [],
});

const settle = async (): Promise<void> => {
  await Promise.resolve();
  await nextTick();
};

describe('useInventoryQuery', () => {
  it('keeps the newest filter response when an older request finishes last', async () => {
    const pending: DeferredResponse[] = [];
    const scope = effectScope();
    const state = scope.run(() =>
      useInventoryQuery({
        query: (query) =>
          new Promise<InventoryQueryResponse>((resolve, reject) => {
            pending.push({ query, resolve, reject });
          }),
      }),
    );
    if (state === undefined) throw new Error('The inventory query scope is required.');

    expect(pending[0]?.query.warehouse).toBe('ALL');
    state.warehouse.value = 'YUHANG';
    await nextTick();
    expect(pending[1]?.query.warehouse).toBe('YUHANG');

    pending[1]?.resolve(responseFor({ warehouse: 'YUHANG', category: 'SMART_RING' }));
    await settle();
    pending[0]?.resolve(responseFor({ warehouse: 'ALL', category: 'SMART_RING' }));
    await settle();

    expect(state.status.value).toBe('ready');
    expect(state.result.value?.warehouse).toBe('YUHANG');
    scope.stop();
  });

  it('exposes a stable error state and recovers on reload', async () => {
    let attempts = 0;
    const scope = effectScope();
    const state = scope.run(() =>
      useInventoryQuery({
        query: async (query) => {
          attempts += 1;
          if (attempts === 1) throw new Error('库存服务暂时不可用');
          return responseFor(query);
        },
      }),
    );
    if (state === undefined) throw new Error('The inventory query scope is required.');

    await settle();
    expect(state.status.value).toBe('error');
    expect(state.errorMessage.value).toBe('库存服务暂时不可用');

    await state.reload();
    expect(state.status.value).toBe('ready');
    expect(state.errorMessage.value).toBeNull();
    scope.stop();
  });
});
