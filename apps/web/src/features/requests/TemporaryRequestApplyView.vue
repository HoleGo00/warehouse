<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { RequestItemInput } from '@glorychips/contracts';
import { warehouseCodeSchema } from '@glorychips/contracts';
import { Clock3, Send, TriangleAlert } from '@lucide/vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthenticatedSession } from '../auth/auth-context.js';
import { createCatalogApi } from '../catalog/catalog-api.js';
import { createInventoryApi } from '../inventory/inventory-api.js';
import RequestItemEditor from './RequestItemEditor.vue';
import { createIdempotencyKeyStore, createRequestApi } from './request-api.js';
import {
  buildRequestVariantOptions,
  validateRequestItems,
  type RequestVariantOption,
} from './request-view-model.js';

const route = useRoute();
const router = useRouter();
const session = useAuthenticatedSession();
const catalogApi = createCatalogApi();
const inventoryApi = createInventoryApi();
const requestApi = createRequestApi();
const submissionKeys = createIdempotencyKeyStore();
const warehouse = computed(() => warehouseCodeSchema.safeParse(route.params.warehouseCode));
const options = shallowRef<readonly RequestVariantOption[]>([]);
const items = shallowRef<RequestItemInput[]>([]);
const attempted = shallowRef(false);
const loading = shallowRef(true);
const submitting = shallowRef(false);
const errorMessage = shallowRef<string | null>(null);
const errors = computed(() => validateRequestItems(items.value));
let latestLoad = 0;

const updateItems = (value: RequestItemInput[]): void => {
  items.value = value;
};

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

const submit = async (): Promise<void> => {
  attempted.value = true;
  if (!warehouse.value.success || errors.value.length > 0) return;
  const command = { warehouse: warehouse.value.data, items: items.value };
  submitting.value = true;
  errorMessage.value = null;
  try {
    const result = await requestApi.createTemporary(command, submissionKeys.keyFor(command));
    await router.push(`/requests/${result.request.id}`);
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : '临时领用提交失败';
  } finally {
    submitting.value = false;
  }
};
</script>

<template>
  <section class="page" aria-labelledby="temporary-request-title">
    <header class="page-header">
      <Clock3 :size="24" aria-hidden="true" />
      <h1 id="temporary-request-title">临时领用</h1>
    </header>

    <Alert v-if="!warehouse.success" variant="destructive">
      <TriangleAlert aria-hidden="true" />
      <AlertDescription>仓库入口无效，请从固定二维码重新进入。</AlertDescription>
    </Alert>

    <div v-else-if="loading" class="loading-state" role="status">
      <Skeleton class="h-12 w-full" />
      <Skeleton class="h-48 w-full" />
    </div>

    <Alert v-else-if="errorMessage && options.length === 0" variant="destructive">
      <AlertDescription>{{ errorMessage }}</AlertDescription>
      <Button type="button" variant="outline" @click="load">重新加载</Button>
    </Alert>

    <form v-else class="temporary-form" @submit.prevent="submit">
      <div class="locked-context">
        <div>
          <span>领用仓库</span
          ><strong>{{ warehouse.data === 'XIHU' ? '西湖仓' : '余杭仓' }}</strong>
        </div>
        <div>
          <span>领用人</span><strong>{{ session.user.name }}</strong>
        </div>
      </div>

      <Alert v-if="errorMessage" variant="destructive">
        <AlertDescription>{{ errorMessage }}</AlertDescription>
      </Alert>

      <RequestItemEditor
        :items="items"
        :options="options"
        :disabled="submitting"
        @update:items="updateItems"
      />

      <Alert v-if="attempted && errors.length > 0" variant="destructive">
        <AlertDescription>
          <p v-for="message in errors" :key="message">{{ message }}</p>
        </AlertDescription>
      </Alert>

      <div class="form-actions">
        <Button type="submit" size="lg" :disabled="submitting">
          <Send aria-hidden="true" />{{ submitting ? '正在出库' : '确认临时领用' }}
        </Button>
      </div>
    </form>
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
  gap: 0.7rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #d9ded9;
  color: #1d684d;
}
.page-header h1 {
  margin: 0;
  color: #26332d;
  font-size: 1.45rem;
}
.loading-state,
.temporary-form {
  display: grid;
  gap: 1rem;
  margin-top: 1rem;
}
.locked-context {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  background: #dbe1dc;
}
.locked-context > div {
  min-width: 0;
  display: grid;
  gap: 0.25rem;
  padding: 0.85rem 1rem;
  background: #fff;
}
.locked-context span {
  color: #6d7972;
  font-size: 0.78rem;
}
.locked-context strong {
  overflow-wrap: anywhere;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
}
@media (max-width: 680px) {
  .locked-context {
    grid-template-columns: 1fr;
  }
  .form-actions :deep(button) {
    width: 100%;
  }
}
</style>
