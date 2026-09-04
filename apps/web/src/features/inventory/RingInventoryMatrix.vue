<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import type { InventoryProductProjection, InventoryVariantProjection } from '@glorychips/contracts';
import { catalogRingSizes } from '@glorychips/contracts';
import { ImageOff, TriangleAlert } from '@lucide/vue';
import { apiBaseUrl } from '../shared/api-client.js';
import { hasPendingSync, productStatusLabel, quantitySummary } from './inventory-view-model.js';

const props = defineProps<{
  products: readonly InventoryProductProjection[];
}>();

const failedImageIds = shallowRef<ReadonlySet<string>>(new Set());

interface RingRow {
  readonly product: InventoryProductProjection;
  readonly cells: readonly {
    readonly size: string;
    readonly variant: InventoryVariantProjection | null;
  }[];
}

const rows = computed<readonly RingRow[]>(() =>
  props.products.map((product) => {
    const variants = new Map(
      product.variants
        .filter((variant) => variant.size !== null)
        .map((variant) => [variant.size ?? '', variant]),
    );
    return {
      product,
      cells: catalogRingSizes.map((size) => ({ size, variant: variants.get(size) ?? null })),
    };
  }),
);

const imageUrl = (path: string): string => new URL(path, apiBaseUrl).toString();

const markImageFailed = (productId: string): void => {
  failedImageIds.value = new Set([...failedImageIds.value, productId]);
};

const imageFailureLabel = (product: InventoryProductProjection): string =>
  product.imageReady ? '主图加载失败' : '未配置主图';
</script>

<template>
  <div class="matrix-scroll" tabindex="0" aria-label="智能指环尺码库存矩阵">
    <table class="ring-matrix">
      <thead>
        <tr>
          <th class="product-column" scope="col">商品</th>
          <th v-for="size in catalogRingSizes" :key="size" scope="col">{{ size }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.product.id">
          <th class="product-column" scope="row">
            <div class="product-cell">
              <!-- eslint-disable vue/html-self-closing -->
              <img
                v-if="row.product.mainImage && !failedImageIds.has(row.product.id)"
                class="product-image"
                :src="imageUrl(row.product.mainImage.url)"
                :alt="row.product.name"
                @error="markImageFailed(row.product.id)"
              />
              <!-- eslint-enable vue/html-self-closing -->
              <span v-else class="missing-image" :title="imageFailureLabel(row.product)">
                <ImageOff :size="19" aria-hidden="true" />
              </span>
              <span class="product-copy">
                <strong>{{ row.product.name }}</strong>
                <span class="product-meta">
                  {{ productStatusLabel(row.product.status) }}
                  <span v-if="!row.product.imageReady">· 未配置主图</span>
                  <span v-else-if="failedImageIds.has(row.product.id)">· 主图加载失败</span>
                </span>
                <span v-if="hasPendingSync(row.product)" class="pending-label">
                  <TriangleAlert :size="13" aria-hidden="true" />
                  含待同步变动
                </span>
              </span>
            </div>
          </th>
          <td v-for="cell in row.cells" :key="cell.size">
            <template v-if="cell.variant">
              <strong class="quantity-value" :title="quantitySummary(cell.variant.total)">
                {{ cell.variant.total.availableQuantity }}
              </strong>
              <span class="quantity-label">可用</span>
              <span
                v-for="quantity in cell.variant.warehouses"
                :key="quantity.warehouse"
                class="warehouse-quantity"
              >
                {{ quantity.warehouse === 'XIHU' ? '西' : '余' }} {{ quantity.availableQuantity }}
              </span>
            </template>
            <span v-else class="empty-variant">—</span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.matrix-scroll {
  margin-top: 1.1rem;
  overflow-x: auto;
  border: 1px solid #d8ded9;
  border-radius: 7px;
  background: #ffffff;
}

.ring-matrix {
  width: 100%;
  min-width: 1160px;
  border-collapse: collapse;
  table-layout: fixed;
}

.ring-matrix th,
.ring-matrix td {
  width: 108px;
  min-width: 108px;
  height: 94px;
  padding: 0.7rem;
  border-right: 1px solid #e3e7e3;
  border-bottom: 1px solid #e3e7e3;
  text-align: center;
  vertical-align: middle;
}

.ring-matrix thead th {
  height: 44px;
  color: #66736c;
  background: #f7f8f6;
  font-size: 0.78rem;
}

.ring-matrix .product-column {
  position: sticky;
  z-index: 1;
  left: 0;
  width: 264px;
  min-width: 264px;
  text-align: left;
  background: #ffffff;
}

.ring-matrix thead .product-column {
  z-index: 2;
  background: #f7f8f6;
}

.product-cell {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.product-image,
.missing-image {
  width: 48px;
  height: 48px;
  flex: 0 0 48px;
  border-radius: 6px;
}

.product-image {
  object-fit: cover;
}

.missing-image {
  display: grid;
  place-items: center;
  border: 1px dashed #bdc6bf;
  color: #77827c;
  background: #f6f7f5;
}

.product-copy {
  min-width: 0;
  display: grid;
  gap: 0.2rem;
}

.product-copy strong {
  color: #27342e;
  line-height: 1.35;
}

.product-meta,
.quantity-label,
.warehouse-quantity {
  color: #77827c;
  font-size: 0.7rem;
}

.pending-label {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  color: #985619;
  font-size: 0.7rem;
}

.quantity-value,
.quantity-label,
.warehouse-quantity {
  display: block;
}

.quantity-value {
  color: #1c6046;
  font-size: 1.2rem;
}

.warehouse-quantity {
  margin-top: 0.15rem;
}

.empty-variant {
  color: #a8b0aa;
}
</style>
