<script setup lang="ts">
import type { InventoryWarehouseFilter, ProductCategoryCode } from '@glorychips/contracts';

const props = defineProps<{
  warehouse: InventoryWarehouseFilter;
  category: ProductCategoryCode;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  warehouseChange: [value: InventoryWarehouseFilter];
  categoryChange: [value: ProductCategoryCode];
}>();

const warehouseOptions: readonly { value: InventoryWarehouseFilter; label: string }[] = [
  { value: 'ALL', label: '全部仓库' },
  { value: 'XIHU', label: '西湖仓' },
  { value: 'YUHANG', label: '余杭仓' },
];

const categoryOptions: readonly { value: ProductCategoryCode; label: string }[] = [
  { value: 'SMART_RING', label: '智能指环' },
  { value: 'SMART_WATCH', label: '健康腕表' },
];
</script>

<template>
  <div class="filter-bar">
    <div class="filter-group" aria-label="仓库筛选">
      <span class="filter-label">仓库</span>
      <div class="segmented-control">
        <button
          v-for="option in warehouseOptions"
          :key="option.value"
          class="segment-button"
          :class="{ active: props.warehouse === option.value }"
          type="button"
          :aria-pressed="props.warehouse === option.value"
          :disabled="props.disabled"
          @click="emit('warehouseChange', option.value)"
        >
          {{ option.label }}
        </button>
      </div>
    </div>

    <div class="filter-group" aria-label="品类筛选">
      <span class="filter-label">品类</span>
      <div class="segmented-control">
        <button
          v-for="option in categoryOptions"
          :key="option.value"
          class="segment-button"
          :class="{ active: props.category === option.value }"
          type="button"
          :aria-pressed="props.category === option.value"
          :disabled="props.disabled"
          @click="emit('categoryChange', option.value)"
        >
          {{ option.label }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.filter-bar,
.filter-group,
.segmented-control {
  display: flex;
  align-items: center;
}

.filter-bar {
  flex-wrap: wrap;
  gap: 0.8rem 1.5rem;
  padding: 1rem 0;
  border-top: 1px solid #dce1dc;
  border-bottom: 1px solid #dce1dc;
}

.filter-group {
  min-width: 0;
  gap: 0.6rem;
}

.filter-label {
  flex: 0 0 auto;
  color: #6a766f;
  font-size: 0.78rem;
  font-weight: 700;
}

.segmented-control {
  min-width: 0;
  padding: 3px;
  border: 1px solid #d4dad5;
  border-radius: 7px;
  background: #ffffff;
}

.segment-button {
  min-height: 32px;
  border: 0;
  border-radius: 4px;
  padding: 0.35rem 0.7rem;
  color: #5a665f;
  background: transparent;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
}

.segment-button.active {
  color: #155f43;
  background: #e8f3ec;
}

.segment-button:disabled {
  cursor: wait;
  opacity: 0.65;
}

@media (max-width: 620px) {
  .filter-bar,
  .filter-group {
    align-items: stretch;
    flex-direction: column;
  }

  .filter-group {
    width: 100%;
    gap: 0.4rem;
  }

  .segmented-control {
    width: 100%;
  }

  .segment-button {
    min-width: 0;
    flex: 1;
    padding-inline: 0.45rem;
  }
}
</style>
