<script setup lang="ts">
import type { CatalogProductResponse } from '@glorychips/contracts';
import { ImageOff, Pencil } from '@lucide/vue';

defineProps<{
  products: readonly CatalogProductResponse[];
  selectedProductId: string | null;
}>();

const emit = defineEmits<{
  edit: [product: CatalogProductResponse];
}>();

const categoryLabel = (product: CatalogProductResponse): string =>
  product.category === 'SMART_RING' ? '智能指环' : '健康腕表';

const statusLabel = (product: CatalogProductResponse): string => {
  if (product.status === 'ACTIVE') return '启用';
  if (product.status === 'INACTIVE_HISTORICAL') return '历史停用';
  return '停用';
};
</script>

<template>
  <div class="catalog-table-wrap">
    <table class="catalog-table">
      <thead>
        <tr>
          <th scope="col">商品</th>
          <th scope="col">类别</th>
          <th scope="col">规格</th>
          <th scope="col">状态</th>
          <th scope="col">主图</th>
          <th scope="col"><span class="sr-only">操作</span></th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="product in products"
          :key="product.id"
          :class="{ selected: selectedProductId === product.id }"
        >
          <td>
            <strong class="product-name">{{ product.name }}</strong>
            <span class="product-code">{{ product.code }}</span>
          </td>
          <td>{{ categoryLabel(product) }}</td>
          <td>{{ product.specificationMode === 'RING_SIZE' ? '6# - 13#' : '无尺码' }}</td>
          <td>
            <span class="status-tag" :data-status="product.status">{{ statusLabel(product) }}</span>
          </td>
          <td>
            <span v-if="product.imageReady" class="image-ready">已配置</span>
            <span v-else class="image-missing">
              <ImageOff :size="14" aria-hidden="true" />
              未配置主图
            </span>
          </td>
          <td class="action-cell">
            <button
              class="icon-button"
              type="button"
              title="编辑商品"
              aria-label="编辑商品"
              @click="emit('edit', product)"
            >
              <Pencil :size="16" aria-hidden="true" />
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.catalog-table-wrap {
  overflow-x: auto;
  border: 1px solid #d7ddd8;
  border-radius: 8px;
  background: #ffffff;
}

.catalog-table {
  width: 100%;
  min-width: 780px;
  border-collapse: collapse;
}

.catalog-table th,
.catalog-table td {
  padding: 0.75rem 0.85rem;
  border-bottom: 1px solid #e1e5e1;
  color: #4f5c55;
  text-align: left;
  font-size: 0.8rem;
}

.catalog-table th {
  color: #6c7871;
  background: #f7f8f6;
  font-size: 0.72rem;
}

.catalog-table tbody tr:last-child td {
  border-bottom: 0;
}

.catalog-table tbody tr.selected td {
  background: #edf5f0;
}

.product-name,
.product-code {
  display: block;
}

.product-name {
  max-width: 260px;
  color: #28352f;
  line-height: 1.4;
}

.product-code {
  margin-top: 0.2rem;
  color: #879089;
  font-size: 0.68rem;
}

.status-tag,
.image-ready,
.image-missing {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: 4px;
  padding: 0.23rem 0.45rem;
  font-size: 0.7rem;
  font-weight: 700;
}

.status-tag,
.image-ready {
  color: #1d6748;
  background: #e8f4ec;
}

.status-tag[data-status='INACTIVE'],
.status-tag[data-status='INACTIVE_HISTORICAL'],
.image-missing {
  color: #6d5548;
  background: #eee9e5;
}

.action-cell {
  width: 52px;
  text-align: right;
}

.icon-button {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: 1px solid #d2d9d3;
  border-radius: 6px;
  color: #445149;
  background: #ffffff;
  cursor: pointer;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}
</style>
