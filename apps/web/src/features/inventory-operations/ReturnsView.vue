<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue';
import type { RequestDetail, ReturnQueueItem, WarehouseCode } from '@glorychips/contracts';
import { RefreshCw } from '@lucide/vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
import { useAuthenticatedSession } from '../auth/auth-context.js';
import { createIdempotencyKeyStore, createRequestApi } from '../requests/request-api.js';
import { createInventoryOperationsApi } from './inventory-operations-api.js';
import { managedWarehouseCodes, validReturnQuantities } from './inventory-operations-view-model.js';

const session = useAuthenticatedSession();
const api = createInventoryOperationsApi();
const requestApi = createRequestApi();
const keys = createIdempotencyKeyStore();
const managedWarehouses = computed<readonly WarehouseCode[]>(() =>
  managedWarehouseCodes(session.value.access),
);
const warehouseFilter = shallowRef<'ALL' | WarehouseCode>('ALL');
const statusFilter = shallowRef<'ALL' | 'PENDING' | 'PARTIAL' | 'DUE' | 'OVERDUE'>('ALL');
const items = shallowRef<readonly ReturnQueueItem[]>([]);
const selected = shallowRef<ReturnQueueItem | null>(null);
const detail = shallowRef<RequestDetail | null>(null);
const returnWarehouse = shallowRef<WarehouseCode>(managedWarehouses.value[0] ?? 'YUHANG');
const quantities = ref<Record<string, string>>({});
const loading = shallowRef(true);
const detailLoading = shallowRef(false);
const submitting = shallowRef(false);
const errorMessage = shallowRef<string | null>(null);
const successMessage = shallowRef<string | null>(null);

const warehouseName = (code: WarehouseCode): string => (code === 'XIHU' ? '西湖仓' : '余杭仓');
const openObligations = computed(
  () =>
    detail.value?.returnObligations.filter(
      (item) => item.status === 'PENDING' || item.status === 'PARTIAL',
    ) ?? [],
);
const canSubmit = computed(
  () =>
    !submitting.value &&
    !detailLoading.value &&
    detail.value !== null &&
    validReturnQuantities(openObligations.value, quantities.value),
);

const load = async (): Promise<void> => {
  loading.value = true;
  errorMessage.value = null;
  selected.value = null;
  detail.value = null;
  try {
    const response = await api.returns({
      ...(warehouseFilter.value === 'ALL' ? {} : { warehouse: warehouseFilter.value }),
      ...(statusFilter.value === 'ALL' ? {} : { status: statusFilter.value }),
    });
    items.value = response.items;
  } catch (error: unknown) {
    items.value = [];
    errorMessage.value = error instanceof Error ? error.message : '待归还记录读取失败';
  } finally {
    loading.value = false;
  }
};

const choose = async (item: ReturnQueueItem): Promise<void> => {
  detailLoading.value = true;
  selected.value = item;
  detail.value = null;
  quantities.value = {};
  errorMessage.value = null;
  returnWarehouse.value = item.allowedWarehouses[0] ?? managedWarehouses.value[0] ?? 'YUHANG';
  try {
    detail.value = (await requestApi.detail(item.requestId)).request;
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : '归还明细读取失败';
  } finally {
    detailLoading.value = false;
  }
};

const confirmReturn = async (): Promise<void> => {
  if (detail.value === null || !canSubmit.value) return;
  const lines = openObligations.value.flatMap((item) => {
    const quantity = Number(quantities.value[item.id] ?? '0');
    return Number.isSafeInteger(quantity) && quantity > 0
      ? [{ obligationId: item.id, quantity }]
      : [];
  });
  const command = {
    requestId: detail.value.id,
    warehouse: returnWarehouse.value,
    occurredAt: new Date().toISOString(),
    lines,
  };
  submitting.value = true;
  errorMessage.value = null;
  successMessage.value = null;
  try {
    detail.value = (await api.confirmReturn(command, keys.keyFor(command))).request;
    quantities.value = {};
    successMessage.value = '归还已登记';
    await load();
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : '归还登记失败';
  } finally {
    submitting.value = false;
  }
};

onMounted(load);
</script>

<template>
  <section class="mx-auto grid w-full max-w-6xl gap-5" aria-labelledby="returns-title">
    <header class="flex items-center justify-between border-b border-border pb-3">
      <h1 id="returns-title" class="text-xl font-semibold">实物归还</h1>
      <Button
        type="button"
        variant="outline"
        size="icon"
        title="刷新"
        aria-label="刷新"
        :disabled="loading || detailLoading || submitting"
        @click="load"
      >
        <RefreshCw aria-hidden="true" />
      </Button>
    </header>
    <div class="grid gap-3 sm:grid-cols-2">
      <div class="grid gap-1.5">
        <Label for="return-warehouse-filter">原出库仓库</Label>
        <Select v-model="warehouseFilter" @update:model-value="load">
          <SelectTrigger id="return-warehouse-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部</SelectItem>
            <SelectItem v-for="code in managedWarehouses" :key="code" :value="code">
              {{ warehouseName(code) }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="grid gap-1.5">
        <Label for="return-status-filter">状态</Label>
        <Select v-model="statusFilter" @update:model-value="load">
          <SelectTrigger id="return-status-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部</SelectItem>
            <SelectItem value="PENDING">待归还</SelectItem>
            <SelectItem value="PARTIAL">部分归还</SelectItem>
            <SelectItem value="DUE">今日到期</SelectItem>
            <SelectItem value="OVERDUE">已超期</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
    <Alert v-if="errorMessage" variant="destructive">
      <AlertDescription>{{ errorMessage }}</AlertDescription>
    </Alert>
    <Alert v-if="successMessage">
      <AlertDescription>{{ successMessage }}</AlertDescription>
    </Alert>
    <div v-if="loading" class="py-16 text-center text-sm text-muted-foreground" role="status">
      正在读取
    </div>
    <div v-else-if="items.length === 0" class="py-16 text-center text-sm text-muted-foreground">
      暂无待归还记录
    </div>
    <div v-else class="grid gap-2">
      <button
        v-for="item in items"
        :key="item.requestId"
        type="button"
        :disabled="detailLoading || submitting"
        class="grid w-full gap-2 border-b border-border px-1 py-3 text-left sm:grid-cols-[1fr_auto_auto] sm:items-center"
        @click="choose(item)"
      >
        <span class="grid gap-1"
          ><strong>{{ item.requestNumber }}</strong
          ><span class="text-sm text-muted-foreground"
            >{{ item.claimantName }} · {{ item.sourceWarehouseName }}</span
          ></span
        >
        <Badge variant="outline">剩余 {{ item.remainingQuantity }}</Badge>
        <span
          class="text-sm"
          :class="statusFilter === 'OVERDUE' ? 'text-destructive' : 'text-muted-foreground'"
          >{{ item.dueDate ?? '离职触发' }}</span
        >
      </button>
    </div>

    <div v-if="detailLoading" class="py-8 text-center text-sm text-muted-foreground" role="status">
      正在读取归还明细
    </div>

    <section
      v-if="selected && detail"
      class="grid gap-4 border-t border-border pt-5"
      aria-labelledby="return-confirm-title"
    >
      <h2 id="return-confirm-title" class="text-base font-semibold">
        {{ selected.requestNumber }}
      </h2>
      <div class="grid gap-1.5 sm:max-w-xs">
        <Label for="return-target-warehouse">回库仓库</Label>
        <Select v-model="returnWarehouse" :disabled="submitting">
          <SelectTrigger id="return-target-warehouse"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem v-for="code in selected.allowedWarehouses" :key="code" :value="code">
              {{ warehouseName(code) }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="grid gap-2">
        <div
          v-for="obligation in openObligations"
          :key="obligation.id"
          class="grid gap-2 border-b border-border py-3 sm:grid-cols-[1fr_160px] sm:items-end"
        >
          <div>
            <strong>{{
              detail.items.find((item) => item.variantId === obligation.variantId)?.variantName ??
              obligation.variantId
            }}</strong>
            <p class="mt-1 text-sm text-muted-foreground">
              应还 {{ obligation.requiredQuantity }} · 已还 {{ obligation.returnedQuantity }} · 剩余
              {{ obligation.remainingQuantity }}
            </p>
          </div>
          <div class="grid gap-1.5">
            <Label :for="`return-quantity-${obligation.id}`">本次归还</Label>
            <Input
              :id="`return-quantity-${obligation.id}`"
              v-model="quantities[obligation.id]"
              type="number"
              min="0"
              :max="obligation.remainingQuantity"
              step="1"
              :disabled="submitting"
            />
          </div>
        </div>
      </div>
      <div class="flex justify-end">
        <Button type="button" :disabled="!canSubmit" @click="confirmReturn">
          {{ submitting ? '提交中' : '确认回库' }}
        </Button>
      </div>
    </section>
  </section>
</template>
