<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue';
import type {
  InventoryProductProjection,
  InventoryVariantProjection,
  WarehouseCode,
} from '@glorychips/contracts';
import { Plus, Trash2 } from '@lucide/vue';
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
import { Textarea } from '@/components/ui/textarea';
import { useAuthenticatedSession } from '../auth/auth-context.js';
import { createInventoryApi } from '../inventory/inventory-api.js';
import { createIdempotencyKeyStore } from '../requests/request-api.js';
import { createInventoryOperationsApi } from './inventory-operations-api.js';
import { managedWarehouseCodes } from './inventory-operations-view-model.js';

type Mode = 'INBOUND' | 'TRANSFER' | 'STOCKTAKE';
interface EditableLine {
  id: string;
  variantId: string;
  quantity: string;
}
interface VariantOption {
  variant: InventoryVariantProjection;
  product: InventoryProductProjection;
}

const props = defineProps<{ mode: Mode }>();
const session = useAuthenticatedSession();
const inventoryApi = createInventoryApi();
const operationsApi = createInventoryOperationsApi();
const submissionKeys = createIdempotencyKeyStore();
const managedWarehouses = computed<readonly WarehouseCode[]>(() =>
  managedWarehouseCodes(session.value.access),
);
const title = computed(() =>
  props.mode === 'INBOUND' ? '入库登记' : props.mode === 'TRANSFER' ? '库存调拨' : '库存盘点',
);
const sourceWarehouse = shallowRef<WarehouseCode>(managedWarehouses.value[0] ?? 'YUHANG');
const destinationWarehouse = shallowRef<WarehouseCode>(
  managedWarehouses.value.find((item) => item !== sourceWarehouse.value) ?? 'XIHU',
);
const inboundType = shallowRef<'PURCHASE' | 'OTHER'>('PURCHASE');
const occurredAt = shallowRef(
  new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16),
);
const reason = shallowRef('');
const notes = shallowRef('');
const lines = ref<EditableLine[]>([
  { id: crypto.randomUUID(), variantId: '', quantity: props.mode === 'STOCKTAKE' ? '0' : '1' },
]);
const options = shallowRef<readonly VariantOption[]>([]);
const loading = shallowRef(true);
const submitting = shallowRef(false);
const errorMessage = shallowRef<string | null>(null);
const successMessage = shallowRef<string | null>(null);
const occurredAtIso = computed(() => {
  const value = new Date(occurredAt.value);
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
});

const warehouseName = (code: WarehouseCode): string => (code === 'XIHU' ? '西湖仓' : '余杭仓');
const quantityAt = (option: VariantOption, warehouse: WarehouseCode) =>
  option.variant.warehouses.find((item) => item.warehouse === warehouse) ?? null;
const visibleOptions = computed(() =>
  props.mode === 'INBOUND'
    ? options.value.filter(
        (option) => option.product.status === 'ACTIVE' && option.variant.isActive,
      )
    : options.value,
);
const optionLabel = (option: VariantOption): string => {
  const source = quantityAt(option, sourceWarehouse.value);
  if (props.mode === 'INBOUND') return option.variant.displayName;
  if (props.mode === 'STOCKTAKE') {
    return `${option.variant.displayName} · 账面 ${source?.effectiveOnHandQuantity ?? 0}`;
  }
  const destination = quantityAt(option, destinationWarehouse.value);
  return `${option.variant.displayName} · 可调 ${source?.availableQuantity ?? 0} / 目标 ${destination?.effectiveOnHandQuantity ?? 0}`;
};
const selectedOption = (variantId: string) =>
  options.value.find((option) => option.variant.id === variantId);
const difference = (line: EditableLine): number | null => {
  if (props.mode !== 'STOCKTAKE' || line.variantId.length === 0) return null;
  const option = selectedOption(line.variantId);
  const counted = Number(line.quantity);
  if (option === undefined || !Number.isSafeInteger(counted) || counted < 0) return null;
  return counted - (quantityAt(option, sourceWarehouse.value)?.effectiveOnHandQuantity ?? 0);
};
const validLines = computed(() => {
  const ids = lines.value.map((line) => line.variantId);
  return (
    ids.every((id) => id.length > 0) &&
    new Set(ids).size === ids.length &&
    lines.value.every((line) => {
      const value = Number(line.quantity);
      return Number.isSafeInteger(value) && (props.mode === 'STOCKTAKE' ? value >= 0 : value > 0);
    })
  );
});
const canSubmit = computed(
  () =>
    !loading.value &&
    !submitting.value &&
    managedWarehouses.value.length > 0 &&
    occurredAtIso.value !== null &&
    reason.value.trim().length > 0 &&
    validLines.value &&
    (props.mode !== 'TRANSFER' || sourceWarehouse.value !== destinationWarehouse.value),
);

const loadOptions = async (): Promise<void> => {
  loading.value = true;
  errorMessage.value = null;
  try {
    const response = await inventoryApi.query({ warehouse: 'ALL' });
    options.value = response.products.flatMap((product) =>
      product.variants.map((variant) => ({ product, variant })),
    );
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : '库存商品读取失败';
  } finally {
    loading.value = false;
  }
};

const addLine = (): void => {
  lines.value = [
    ...lines.value,
    { id: crypto.randomUUID(), variantId: '', quantity: props.mode === 'STOCKTAKE' ? '0' : '1' },
  ];
};
const removeLine = (id: string): void => {
  if (lines.value.length === 1) return;
  lines.value = lines.value.filter((line) => line.id !== id);
};

const submit = async (): Promise<void> => {
  if (!canSubmit.value) return;
  if (occurredAtIso.value === null) {
    errorMessage.value = '发生时间无效';
    return;
  }
  const common = {
    occurredAt: occurredAtIso.value,
    reason: reason.value.trim(),
    ...(notes.value.trim().length === 0 ? {} : { notes: notes.value.trim() }),
  };
  const quantityLines = lines.value.map((line) => ({
    variantId: line.variantId,
    quantity: Number(line.quantity),
  }));
  submitting.value = true;
  errorMessage.value = null;
  successMessage.value = null;
  try {
    let result;
    if (props.mode === 'INBOUND') {
      const command = {
        ...common,
        warehouse: sourceWarehouse.value,
        inboundType: inboundType.value,
        lines: quantityLines,
      };
      result = await operationsApi.inbound(command, submissionKeys.keyFor(command));
    } else if (props.mode === 'TRANSFER') {
      const command = {
        ...common,
        sourceWarehouse: sourceWarehouse.value,
        destinationWarehouse: destinationWarehouse.value,
        lines: quantityLines,
      };
      result = await operationsApi.transfer(command, submissionKeys.keyFor(command));
    } else {
      const command = {
        ...common,
        warehouse: sourceWarehouse.value,
        lines: quantityLines.map((line) => ({
          variantId: line.variantId,
          countedQuantity: line.quantity,
        })),
      };
      result = await operationsApi.stocktake(command, submissionKeys.keyFor(command));
    }
    successMessage.value = `${result.operation.operationNumber} 已完成`;
    await loadOptions();
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : '库存操作失败';
  } finally {
    submitting.value = false;
  }
};

onMounted(loadOptions);
</script>

<template>
  <section class="mx-auto grid w-full max-w-5xl gap-5" :aria-labelledby="`${mode}-title`">
    <header class="flex items-center justify-between border-b border-border pb-3">
      <h1 :id="`${mode}-title`" class="text-xl font-semibold">{{ title }}</h1>
      <Button
        type="button"
        variant="outline"
        :disabled="loading || submitting"
        @click="loadOptions"
      >
        刷新
      </Button>
    </header>

    <Alert v-if="managedWarehouses.length === 0" variant="destructive">
      <AlertDescription>没有可管理的仓库</AlertDescription>
    </Alert>
    <Alert v-if="errorMessage" variant="destructive">
      <AlertDescription>{{ errorMessage }}</AlertDescription>
    </Alert>
    <Alert v-if="successMessage">
      <AlertDescription>{{ successMessage }}</AlertDescription>
    </Alert>

    <form v-if="managedWarehouses.length > 0" class="grid gap-5" @submit.prevent="submit">
      <section class="grid gap-3 border-b border-border pb-5">
        <h2 class="text-base font-semibold">业务信息</h2>
        <div class="grid gap-3 md:grid-cols-2">
          <div class="grid gap-1.5">
            <Label for="operation-source">{{ mode === 'TRANSFER' ? '来源仓库' : '仓库' }}</Label>
            <Select v-model="sourceWarehouse" :disabled="submitting">
              <SelectTrigger id="operation-source"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="code in managedWarehouses" :key="code" :value="code">
                  {{ warehouseName(code) }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div v-if="mode === 'TRANSFER'" class="grid gap-1.5">
            <Label for="operation-destination">目标仓库</Label>
            <Select v-model="destinationWarehouse" :disabled="submitting">
              <SelectTrigger id="operation-destination"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="code in managedWarehouses" :key="code" :value="code">
                  {{ warehouseName(code) }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div v-if="mode === 'INBOUND'" class="grid gap-1.5">
            <Label for="inbound-type">入库类型</Label>
            <Select v-model="inboundType" :disabled="submitting">
              <SelectTrigger id="inbound-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="PURCHASE">采购入库</SelectItem>
                <SelectItem value="OTHER">其他入库</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="grid gap-1.5">
            <Label for="operation-time">发生时间</Label>
            <Input
              id="operation-time"
              v-model="occurredAt"
              type="datetime-local"
              required
              :disabled="submitting"
            />
          </div>
          <div class="grid gap-1.5 md:col-span-2">
            <Label for="operation-reason">{{
              mode === 'STOCKTAKE' ? '差异原因' : '来源 / 原因'
            }}</Label>
            <Textarea
              id="operation-reason"
              v-model="reason"
              rows="3"
              maxlength="1000"
              :disabled="submitting"
            />
          </div>
          <div class="grid gap-1.5 md:col-span-2">
            <Label for="operation-notes">备注</Label>
            <Textarea
              id="operation-notes"
              v-model="notes"
              rows="2"
              maxlength="1000"
              :disabled="submitting"
            />
          </div>
        </div>
      </section>

      <section class="grid gap-3">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-base font-semibold">商品明细</h2>
          <Button type="button" variant="outline" size="sm" :disabled="submitting" @click="addLine">
            <Plus aria-hidden="true" />新增明细
          </Button>
        </div>
        <div class="grid gap-2">
          <div
            v-for="(line, index) in lines"
            :key="line.id"
            class="grid gap-2 border-b border-border py-3 md:grid-cols-[minmax(0,1fr)_140px_42px] md:items-end"
          >
            <div class="grid gap-1.5">
              <Label :for="`operation-variant-${line.id}`">商品 {{ index + 1 }}</Label>
              <Select v-model="line.variantId" :disabled="loading || submitting">
                <SelectTrigger :id="`operation-variant-${line.id}`">
                  <SelectValue placeholder="请选择" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="option in visibleOptions"
                    :key="option.variant.id"
                    :value="option.variant.id"
                  >
                    {{ optionLabel(option) }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="grid gap-1.5">
              <Label :for="`operation-quantity-${line.id}`">{{
                mode === 'STOCKTAKE' ? '实盘数量' : '数量'
              }}</Label>
              <Input
                :id="`operation-quantity-${line.id}`"
                v-model="line.quantity"
                type="number"
                :min="mode === 'STOCKTAKE' ? 0 : 1"
                step="1"
                :disabled="submitting"
              />
              <span v-if="difference(line) !== null" class="text-xs text-muted-foreground">
                差异 {{ (difference(line) ?? 0) > 0 ? '+' : '' }}{{ difference(line) }}
              </span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              title="删除明细"
              aria-label="删除明细"
              :disabled="submitting || lines.length === 1"
              @click="removeLine(line.id)"
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        </div>
      </section>

      <div class="flex justify-end">
        <Button type="submit" :disabled="!canSubmit">
          {{ submitting ? '提交中' : '确认提交' }}
        </Button>
      </div>
    </form>
  </section>
</template>
