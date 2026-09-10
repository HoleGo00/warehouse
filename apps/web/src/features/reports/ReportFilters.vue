<script setup lang="ts">
import { computed, onScopeDispose, reactive, ref, watch } from 'vue';
import { Search, RotateCcw } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ringSizes, warehouseCodes } from '@glorychips/contracts';
import type { AuthMeResponse, CatalogProductResponse, ReportFilters } from '@glorychips/contracts';
import { createCatalogApi } from '../catalog/catalog-api.js';
import { createReportApi } from './report-api.js';
import {
  requestOriginLabels,
  requestStatusLabels,
  requestTypeLabels,
} from '../requests/request-view-model.js';
import ReportSelect from './ReportSelect.vue';
const props = defineProps<{ session: AuthMeResponse; busy: boolean; initial: ReportFilters }>();
const emit = defineEmits<{ search: [filters: Record<string, unknown>] }>();
const form = reactive<Record<string, string>>({
  from: '',
  to: '',
  warehouse: 'ALL',
  claimantId: 'ALL',
  category: 'ALL',
  productId: 'ALL',
  size: 'ALL',
  type: 'ALL',
  origin: 'ALL',
  status: 'ALL',
  syncStatus: 'ALL',
  finalDestination: '',
  ...props.initial,
});
const products = ref<CatalogProductResponse[]>([]);
const people = ref<{ id: string; name: string; status: string }[]>([]);
const personSearch = ref('');
const peopleCursor = ref<string | null>(null);
const candidateError = ref('');
let version = 0;
let controller: AbortController | undefined;
const options = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));
const warehouses = computed(() =>
  (props.session.access.roles.includes('SYSTEM_ADMIN')
    ? warehouseCodes
    : props.session.access.warehouses
  ).map((value) => ({ value, label: value === 'XIHU' ? '西湖仓' : '余杭仓' })),
);
const productOptions = computed(() =>
  products.value
    .filter((p) => form.category === 'ALL' || p.category === form.category)
    .map((p) => ({ value: p.id, label: p.name })),
);
async function loadPeople(more = false) {
  const current = ++version;
  controller?.abort();
  controller = new AbortController();
  candidateError.value = '';
  try {
    const response = await createReportApi().claimants(
      {
        query: personSearch.value,
        warehouse: form.warehouse === 'ALL' ? undefined : form.warehouse,
        cursor: more ? (peopleCursor.value ?? undefined) : undefined,
      },
      controller.signal,
    );
    if (current === version) {
      people.value = more ? [...people.value, ...response.items] : response.items;
      peopleCursor.value = response.nextCursor;
    }
  } catch (e) {
    if (current === version) candidateError.value = e instanceof Error ? e.message : '人员加载失败';
  }
}
watch(
  () => props.session.access,
  async (_access, previous) => {
    products.value = [];
    people.value = [];
    if (previous) {
      form.claimantId = 'ALL';
      form.warehouse = 'ALL';
    }
    const current = ++version;
    try {
      const response = await createCatalogApi().list();
      if (current === version) products.value = response.items;
    } catch (e) {
      if (current === version)
        candidateError.value = e instanceof Error ? e.message : '商品加载失败';
    }
    if (current === version) await loadPeople();
  },
  { immediate: true, deep: true },
);
watch(
  () => form.category,
  () => {
    form.productId = 'ALL';
    if (form.category === 'SMART_WATCH') form.size = 'ALL';
  },
);
watch(
  () => form.warehouse,
  () => {
    form.claimantId = 'ALL';
    void loadPeople();
  },
);
onScopeDispose(() => {
  version++;
  controller?.abort();
});
function search() {
  emit(
    'search',
    Object.fromEntries(Object.entries(form).filter(([, v]) => v !== 'ALL' && v !== '')),
  );
}
function reset() {
  for (const key of Object.keys(form))
    form[key] = ['from', 'to', 'finalDestination'].includes(key)
      ? ''
      : key === 'dateMode'
        ? 'SUBMITTED'
        : 'ALL';
  personSearch.value = '';
  search();
}
</script>
<template>
  <form class="grid gap-4 border-b border-border pb-4" @submit.prevent="search">
    <Tabs v-model="form.dateMode"
      ><TabsList aria-label="日期口径"
        ><TabsTrigger value="SUBMITTED">提交日期</TabsTrigger
        ><TabsTrigger value="FULFILLED">实际发放日期</TabsTrigger></TabsList
      ></Tabs
    >
    <div class="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <label class="grid gap-1.5 text-sm font-medium"
        >开始日期<Input v-model="form.from" type="date"
      /></label>
      <label class="grid gap-1.5 text-sm font-medium"
        >结束日期<Input v-model="form.to" type="date"
      /></label>
      <ReportSelect v-model="form.warehouse" label="仓库" :options="warehouses" />
      <ReportSelect
        v-model="form.category"
        label="商品大类"
        :options="options({ SMART_RING: '智能指环', SMART_WATCH: '智能腕表' })"
      />
      <ReportSelect v-model="form.productId" label="产品/款式" :options="productOptions" />
      <ReportSelect
        v-model="form.size"
        label="尺码"
        :options="ringSizes.map((value) => ({ value, label: value }))"
      />
      <ReportSelect v-model="form.type" label="领用类型" :options="options(requestTypeLabels)" />
      <ReportSelect
        v-model="form.origin"
        label="业务来源"
        :options="options(requestOriginLabels)"
      />
      <ReportSelect
        v-model="form.status"
        label="流程状态"
        :options="options(requestStatusLabels)"
      />
      <ReportSelect
        v-model="form.syncStatus"
        label="同步状态"
        :options="
          options({ NOT_REQUIRED: '不适用', PENDING: '待同步', SYNCED: '已同步', FAILED: '失败' })
        "
      />
      <label class="grid gap-1.5 text-sm font-medium"
        >最终去向<Input v-model="form.finalDestination" maxlength="500"
      /></label>
      <div class="grid gap-1.5">
        <span class="text-sm font-medium">查找领用人</span>
        <div class="flex gap-1">
          <Input v-model="personSearch" aria-label="查找领用人" maxlength="100" /><Button
            variant="outline"
            size="icon"
            type="button"
            title="查找人员"
            aria-label="查找人员"
            @click="loadPeople()"
            ><Search
          /></Button>
        </div>
      </div>
      <ReportSelect
        v-model="form.claimantId"
        label="领用人"
        :options="
          people.map((p) => ({
            value: p.id,
            label: p.name + (p.status === 'INACTIVE' ? '（已停用）' : ''),
          }))
        "
      />
      <Button v-if="peopleCursor" type="button" variant="outline" @click="loadPeople(true)"
        >更多人员</Button
      >
    </div>
    <p v-if="candidateError" role="alert" class="text-sm text-destructive">{{ candidateError }}</p>
    <div class="flex gap-2">
      <Button type="submit" :disabled="busy"><Search />查询</Button
      ><Button type="button" variant="outline" :disabled="busy" @click="reset"
        ><RotateCcw />重置</Button
      >
    </div>
  </form>
</template>
