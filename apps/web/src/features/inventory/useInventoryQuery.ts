import { computed, readonly, shallowRef, watch } from 'vue';
import type {
  InventoryQueryResponse,
  InventoryWarehouseFilter,
  ProductCategoryCode,
} from '@glorychips/contracts';
import { createInventoryApi } from './inventory-api.js';

type InventoryLoadStatus = 'loading' | 'ready' | 'error';

const api = createInventoryApi();

type InventoryApi = Pick<ReturnType<typeof createInventoryApi>, 'query'>;

export const useInventoryQuery = (inventoryApi: InventoryApi = api) => {
  const warehouse = shallowRef<InventoryWarehouseFilter>('ALL');
  const category = shallowRef<ProductCategoryCode>('SMART_RING');
  const status = shallowRef<InventoryLoadStatus>('loading');
  const result = shallowRef<InventoryQueryResponse | null>(null);
  const errorMessage = shallowRef<string | null>(null);
  let latestRequest = 0;

  const load = async (signal?: AbortSignal): Promise<void> => {
    const request = ++latestRequest;
    status.value = 'loading';
    errorMessage.value = null;
    try {
      const response = await inventoryApi.query(
        { warehouse: warehouse.value, category: category.value },
        signal,
      );
      if (request !== latestRequest || signal?.aborted) return;
      result.value = response;
      status.value = 'ready';
    } catch (error: unknown) {
      if (request !== latestRequest || signal?.aborted) return;
      status.value = 'error';
      errorMessage.value = error instanceof Error ? error.message : '库存读取失败';
    }
  };

  watch(
    [warehouse, category],
    (_value, _previous, onCleanup) => {
      const controller = new AbortController();
      onCleanup(() => controller.abort());
      void load(controller.signal);
    },
    { immediate: true },
  );

  return {
    warehouse,
    category,
    status: readonly(status),
    result: computed(() => result.value),
    errorMessage: readonly(errorMessage),
    reload: load,
  };
};
