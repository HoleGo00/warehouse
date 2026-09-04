<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { NormalRequestDraft } from '@glorychips/contracts';
import { warehouseCodeSchema } from '@glorychips/contracts';
import { ClipboardList, TriangleAlert } from '@lucide/vue';
import { createCatalogApi } from '../catalog/catalog-api.js';
import { createInventoryApi } from '../inventory/inventory-api.js';
import NormalRequestForm from './NormalRequestForm.vue';
import { createIdempotencyKeyStore, createRequestApi } from './request-api.js';
import { buildRequestVariantOptions, type RequestVariantOption } from './request-view-model.js';

const route = useRoute();
const router = useRouter();
const catalogApi = createCatalogApi();
const inventoryApi = createInventoryApi();
const requestApi = createRequestApi();
const submissionKeys = createIdempotencyKeyStore();
const warehouse = computed(() => warehouseCodeSchema.safeParse(route.params.warehouseCode));
const options = shallowRef<readonly RequestVariantOption[]>([]);
const loading = shallowRef(true);
const submitting = shallowRef(false);
const errorMessage = shallowRef<string | null>(null);
let latestLoad = 0;

const load = async (): Promise<void> => {
  const loadId = ++latestLoad;
  options.value = [];
  errorMessage.value = null;
  if (!warehouse.value.success) {
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const [catalog, inventory] = await Promise.all([
      catalogApi.listSelectable(),
      inventoryApi.query({ warehouse: warehouse.value.data }),
    ]);
    if (loadId !== latestLoad) return;
    options.value = buildRequestVariantOptions(catalog, inventory, warehouse.value.data);
  } catch (error: unknown) {
    if (loadId !== latestLoad) return;
    errorMessage.value = error instanceof Error ? error.message : '申请商品读取失败';
  } finally {
    if (loadId === latestLoad) loading.value = false;
  }
};

watch(() => route.params.warehouseCode, load, { immediate: true });

const submit = async (draft: NormalRequestDraft): Promise<void> => {
  if (!warehouse.value.success) return;
  const command = { warehouse: warehouse.value.data, ...draft };
  submitting.value = true;
  errorMessage.value = null;
  try {
    const result = await requestApi.create(command, submissionKeys.keyFor(command));
    await router.push(`/requests/${result.request.id}`);
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : '申请提交失败';
  } finally {
    submitting.value = false;
  }
};
</script>

<template>
  <section class="page" aria-labelledby="normal-request-title">
    <header class="page-header">
      <ClipboardList :size="26" aria-hidden="true" />
      <div>
        <p>正常领用</p>
        <h1 id="normal-request-title">提交领用申请</h1>
      </div>
    </header>

    <div v-if="!warehouse.success" class="state-panel" role="alert">
      <TriangleAlert :size="26" aria-hidden="true" />
      <strong>仓库入口无效</strong>
      <span>请从西湖仓或余杭仓固定二维码重新进入。</span>
    </div>
    <div v-else-if="loading" class="state-panel" role="status">正在读取可领用商品</div>
    <div v-else-if="errorMessage && options.length === 0" class="state-panel" role="alert">
      <span>{{ errorMessage }}</span>
      <button type="button" @click="load">重新加载</button>
    </div>
    <template v-else>
      <p v-if="errorMessage" class="inline-error" role="alert">{{ errorMessage }}</p>
      <NormalRequestForm
        :warehouse="warehouse.data"
        :options="options"
        :submitting="submitting"
        submit-label="提交审核"
        @submit="submit"
      />
    </template>
  </section>
</template>

<style scoped>
.page {
  width: min(980px, 100%);
  margin: 0 auto;
}

.page-header {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  padding-bottom: 1.25rem;
  border-bottom: 1px solid #d9ded9;
  color: #1d684d;
}

.page-header p,
.page-header h1 {
  margin: 0;
}

.page-header p {
  color: #9a542f;
  font-size: 0.75rem;
  font-weight: 800;
}

.page-header h1 {
  margin-top: 0.15rem;
  color: #26332d;
  font-size: 1.45rem;
}

.state-panel {
  min-height: 360px;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 0.7rem;
  color: #657169;
  text-align: center;
}

.state-panel button {
  min-height: 40px;
  border: 1px solid #c5cec7;
  border-radius: 6px;
  padding: 0.5rem 0.8rem;
  background: #ffffff;
  cursor: pointer;
}

.inline-error {
  padding: 0.75rem 1rem;
  border-left: 3px solid #b14d39;
  color: #8f3f30;
  background: #fff2ef;
}
</style>
