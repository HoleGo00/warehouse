<script setup lang="ts">
import { computed, onMounted, shallowRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { ClaimantCandidate, NormalRequestDraft, WarehouseCode } from '@glorychips/contracts';
import { Search } from '@lucide/vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthenticatedSession } from '../auth/auth-context.js';
import { createCatalogApi } from '../catalog/catalog-api.js';
import { createInventoryApi } from '../inventory/inventory-api.js';
import NormalRequestForm from './NormalRequestForm.vue';
import { createIdempotencyKeyStore, createRequestApi } from './request-api.js';
import { buildRequestVariantOptions, type RequestVariantOption } from './request-view-model.js';

const router = useRouter();
const session = useAuthenticatedSession();
const catalogApi = createCatalogApi();
const inventoryApi = createInventoryApi();
const requestApi = createRequestApi();
const submissionKeys = createIdempotencyKeyStore();
const managedWarehouses = computed<readonly WarehouseCode[]>(() =>
  session.value.access.roles.includes('SYSTEM_ADMIN')
    ? ['XIHU', 'YUHANG']
    : session.value.access.warehouses,
);
const warehouse = shallowRef<WarehouseCode>(managedWarehouses.value[0] ?? 'XIHU');
const options = shallowRef<readonly RequestVariantOption[]>([]);
const candidates = shallowRef<readonly ClaimantCandidate[]>([]);
const claimantQuery = shallowRef('');
const claimantId = shallowRef('');
const loadingOptions = shallowRef(true);
const searching = shallowRef(false);
const submitting = shallowRef(false);
const errorMessage = shallowRef<string | null>(null);
const claimantError = shallowRef<string | null>(null);
let latestOptionLoad = 0;
let latestClaimantSearch = 0;

const loadOptions = async (): Promise<void> => {
  const loadId = ++latestOptionLoad;
  options.value = [];
  errorMessage.value = null;
  loadingOptions.value = true;
  try {
    const [catalog, inventory] = await Promise.all([
      catalogApi.listSelectable(),
      inventoryApi.query({ warehouse: warehouse.value }),
    ]);
    if (loadId !== latestOptionLoad) return;
    options.value = buildRequestVariantOptions(catalog, inventory, warehouse.value);
  } catch (error: unknown) {
    if (loadId !== latestOptionLoad) return;
    errorMessage.value = error instanceof Error ? error.message : '申请商品读取失败';
  } finally {
    if (loadId === latestOptionLoad) loadingOptions.value = false;
  }
};

const searchClaimants = async (): Promise<void> => {
  const searchId = ++latestClaimantSearch;
  claimantError.value = null;
  searching.value = true;
  try {
    const response = await requestApi.searchClaimants(claimantQuery.value.trim());
    if (searchId !== latestClaimantSearch) return;
    candidates.value = response.items;
    if (!candidates.value.some((candidate) => candidate.id === claimantId.value)) {
      claimantId.value = '';
    }
  } catch (error: unknown) {
    if (searchId !== latestClaimantSearch) return;
    candidates.value = [];
    claimantId.value = '';
    claimantError.value = error instanceof Error ? error.message : '员工读取失败';
  } finally {
    if (searchId === latestClaimantSearch) searching.value = false;
  }
};

watch(warehouse, loadOptions, { immediate: true });
onMounted(searchClaimants);

const submit = async (draft: NormalRequestDraft): Promise<void> => {
  if (claimantId.value.length === 0) {
    claimantError.value = '请选择实际领用人';
    return;
  }
  const command = {
    warehouse: warehouse.value,
    claimantId: claimantId.value,
    ...draft,
  };
  submitting.value = true;
  errorMessage.value = null;
  try {
    const result = await requestApi.createOffline(command, submissionKeys.keyFor(command));
    await router.push(`/requests/${result.request.id}`);
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : '线下登记失败';
  } finally {
    submitting.value = false;
  }
};
</script>

<template>
  <section class="page" aria-labelledby="offline-request-title">
    <header class="page-header">
      <h1 id="offline-request-title">线下领取登记</h1>
    </header>

    <Alert v-if="managedWarehouses.length === 0" variant="destructive">
      <AlertDescription>没有可管理的仓库</AlertDescription>
    </Alert>

    <template v-else>
      <section class="operator-fields" aria-labelledby="operator-fields-title">
        <h2 id="operator-fields-title">登记信息</h2>
        <div class="operator-grid">
          <div class="field">
            <Label for="offline-warehouse">领用仓库</Label>
            <Select v-model="warehouse" :disabled="loadingOptions || submitting">
              <SelectTrigger id="offline-warehouse"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="code in managedWarehouses" :key="code" :value="code">
                  {{ code === 'XIHU' ? '西湖仓' : '余杭仓' }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="field claimant-search">
            <Label for="claimant-query">员工搜索</Label>
            <div class="search-row">
              <Input
                id="claimant-query"
                v-model="claimantQuery"
                maxlength="100"
                :disabled="searching || submitting"
                @keydown.enter.prevent="searchClaimants"
              />
              <Button
                type="button"
                variant="outline"
                title="搜索员工"
                aria-label="搜索员工"
                :disabled="searching || submitting"
                @click="searchClaimants"
              >
                <Search aria-hidden="true" />
              </Button>
            </div>
          </div>

          <div class="field field-wide">
            <Label for="offline-claimant">实际领用人</Label>
            <Select v-model="claimantId" :disabled="searching || submitting">
              <SelectTrigger id="offline-claimant">
                <SelectValue placeholder="请选择" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="candidate in candidates"
                  :key="candidate.id"
                  :value="candidate.id"
                >
                  {{ candidate.name }}
                </SelectItem>
              </SelectContent>
            </Select>
            <span v-if="!searching && candidates.length === 0" class="empty-text"
              >未找到可选员工</span
            >
          </div>
        </div>
      </section>

      <Alert v-if="claimantError" variant="destructive">
        <AlertDescription>{{ claimantError }}</AlertDescription>
      </Alert>
      <Alert v-if="errorMessage" variant="destructive">
        <AlertDescription>{{ errorMessage }}</AlertDescription>
      </Alert>

      <div v-if="loadingOptions" class="loading-state" role="status">
        <Skeleton class="h-48 w-full" />
      </div>
      <div v-else-if="options.length === 0 && errorMessage" class="retry-row">
        <Button type="button" variant="outline" @click="loadOptions">重新加载</Button>
      </div>
      <NormalRequestForm
        v-else
        :key="warehouse"
        :warehouse="warehouse"
        :options="options"
        :submitting="submitting"
        submit-label="确认登记并出库"
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
  padding-bottom: 1rem;
  border-bottom: 1px solid #d9ded9;
}
.page-header h1,
.operator-fields h2 {
  margin: 0;
  color: #26332d;
}
.page-header h1 {
  font-size: 1.45rem;
}
.operator-fields {
  display: grid;
  gap: 1rem;
  padding: 1.1rem 0;
  border-bottom: 1px solid #d9ded9;
}
.operator-fields h2 {
  font-size: 1rem;
}
.operator-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}
.field {
  min-width: 0;
  display: grid;
  gap: 0.4rem;
}
.field-wide {
  grid-column: 1 / -1;
}
.search-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 32px;
  gap: 0.5rem;
}
.empty-text {
  color: #6d7972;
  font-size: 0.78rem;
}
.loading-state,
.retry-row {
  margin-top: 1rem;
}
.retry-row {
  display: flex;
  justify-content: flex-end;
}
@media (max-width: 680px) {
  .operator-grid {
    grid-template-columns: 1fr;
  }
  .field-wide {
    grid-column: auto;
  }
}
</style>
