<script setup lang="ts">
import { shallowRef } from 'vue';
import type { InventoryProductProjection } from '@glorychips/contracts';
import { ImageOff, TriangleAlert } from '@lucide/vue';
import { apiBaseUrl } from '../shared/api-client.js';
import { hasPendingSync, productStatusLabel, quantitySummary } from './inventory-view-model.js';

defineProps<{
  products: readonly InventoryProductProjection[];
}>();

const failedImageIds = shallowRef<ReadonlySet<string>>(new Set());

const imageUrl = (path: string): string => new URL(path, apiBaseUrl).toString();

const markImageFailed = (productId: string): void => {
  failedImageIds.value = new Set([...failedImageIds.value, productId]);
};

const imageFailureLabel = (product: InventoryProductProjection): string =>
  product.imageReady ? '主图加载失败' : '未配置主图';
</script>

<template>
  <div class="watch-list">
    <article v-for="product in products" :key="product.id" class="watch-row">
      <div class="product-identity">
        <!-- eslint-disable vue/html-self-closing -->
        <img
          v-if="product.mainImage && !failedImageIds.has(product.id)"
          class="product-image"
          :src="imageUrl(product.mainImage.url)"
          :alt="product.name"
          @error="markImageFailed(product.id)"
        />
        <!-- eslint-enable vue/html-self-closing -->
        <span v-else class="missing-image" :title="imageFailureLabel(product)">
          <ImageOff :size="22" aria-hidden="true" />
        </span>
        <div class="product-copy">
          <h2 class="product-name">{{ product.name }}</h2>
          <div class="status-line">
            <span class="status-tag" :data-status="product.status">
              {{ productStatusLabel(product.status) }}
            </span>
            <span v-if="!product.imageReady" class="missing-label">未配置主图</span>
            <span v-else-if="failedImageIds.has(product.id)" class="missing-label">
              主图加载失败
            </span>
            <span v-if="hasPendingSync(product)" class="pending-label">
              <TriangleAlert :size="14" aria-hidden="true" />
              含待同步变动
            </span>
          </div>
        </div>
      </div>

      <div v-if="product.variants[0]" class="quantity-grid">
        <div
          v-for="quantity in product.variants[0].warehouses"
          :key="quantity.warehouse"
          class="quantity-block"
          :title="quantitySummary(quantity)"
        >
          <span class="quantity-heading">
            {{ quantity.warehouse === 'XIHU' ? '西湖仓' : '余杭仓' }}
          </span>
          <strong>{{ quantity.availableQuantity }}</strong>
          <span>可用</span>
        </div>
        <div class="quantity-block total" :title="quantitySummary(product.variants[0].total)">
          <span class="quantity-heading">合计</span>
          <strong>{{ product.variants[0].total.availableQuantity }}</strong>
          <span>可用</span>
        </div>
      </div>
    </article>
  </div>
</template>

<style scoped>
.watch-list {
  margin-top: 1.1rem;
  border-top: 1px solid #d9dfda;
}

.watch-row {
  min-height: 118px;
  display: grid;
  grid-template-columns: minmax(260px, 1fr) minmax(330px, 0.9fr);
  gap: 1rem;
  align-items: center;
  padding: 1rem 0;
  border-bottom: 1px solid #d9dfda;
}

.product-identity,
.status-line {
  display: flex;
  align-items: center;
}

.product-identity {
  min-width: 0;
  gap: 0.9rem;
}

.product-image,
.missing-image {
  width: 68px;
  height: 68px;
  flex: 0 0 68px;
  border-radius: 7px;
}

.product-image {
  object-fit: cover;
}

.missing-image {
  display: grid;
  place-items: center;
  border: 1px dashed #bac4bd;
  color: #78847d;
  background: #ffffff;
}

.product-copy {
  min-width: 0;
}

.product-name {
  margin: 0 0 0.55rem;
  color: #26332d;
  font-size: 1rem;
  line-height: 1.4;
}

.status-line {
  flex-wrap: wrap;
  gap: 0.4rem;
}

.status-tag,
.missing-label,
.pending-label {
  min-height: 24px;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: 4px;
  padding: 0.2rem 0.45rem;
  font-size: 0.72rem;
  font-weight: 700;
}

.status-tag {
  color: #216346;
  background: #e7f3eb;
}

.status-tag[data-status='INACTIVE'],
.status-tag[data-status='INACTIVE_HISTORICAL'] {
  color: #6b5144;
  background: #eee9e5;
}

.missing-label {
  color: #606d66;
  background: #e9ece9;
}

.pending-label {
  color: #945719;
  background: #fff0d7;
}

.quantity-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(88px, 1fr));
  border: 1px solid #d8ded9;
  border-radius: 7px;
  background: #ffffff;
}

.quantity-block {
  min-height: 76px;
  display: grid;
  place-content: center;
  justify-items: center;
  border-right: 1px solid #e2e6e2;
}

.quantity-block:last-child {
  border-right: 0;
}

.quantity-block strong {
  color: #245f49;
  font-size: 1.2rem;
}

.quantity-heading,
.quantity-block span:last-child {
  color: #76817b;
  font-size: 0.7rem;
}

.quantity-block.total {
  background: #f4f7f4;
}

@media (max-width: 820px) {
  .watch-row {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 480px) {
  .quantity-grid {
    overflow-x: auto;
    grid-template-columns: repeat(3, minmax(92px, 1fr));
  }
}
</style>
