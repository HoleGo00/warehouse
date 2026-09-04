<script setup lang="ts">
import { RefreshCw } from '@lucide/vue';
import InventoryFilters from './InventoryFilters.vue';
import RingInventoryMatrix from './RingInventoryMatrix.vue';
import WatchInventoryList from './WatchInventoryList.vue';
import { useInventoryQuery } from './useInventoryQuery.js';

const { warehouse, category, status, result, errorMessage, reload } = useInventoryQuery();
</script>

<template>
  <section class="inventory-page" aria-labelledby="inventory-title">
    <header class="page-header">
      <div>
        <p class="page-kicker">实时台账投影</p>
        <h1 id="inventory-title" class="page-title">库存查询</h1>
        <p class="page-description">显示飞书确认数量、待同步变动和活动预占后的可用库存。</p>
      </div>
      <button
        class="icon-command"
        type="button"
        title="刷新库存"
        aria-label="刷新库存"
        @click="reload()"
      >
        <RefreshCw :size="18" aria-hidden="true" />
      </button>
    </header>

    <InventoryFilters
      :warehouse="warehouse"
      :category="category"
      :disabled="status === 'loading'"
      @warehouse-change="warehouse = $event"
      @category-change="category = $event"
    />

    <div v-if="status === 'loading' && result === null" class="state-panel" role="status">
      正在读取库存
    </div>
    <div v-else-if="status === 'error'" class="state-panel error" role="alert">
      <p>{{ errorMessage }}</p>
      <button class="retry-button" type="button" @click="reload()">重新加载</button>
    </div>
    <div v-else-if="result !== null && result.products.length === 0" class="state-panel">
      当前筛选条件下暂无商品。
    </div>
    <template v-else-if="result !== null">
      <div class="result-summary" role="status">
        <span>{{ result.products.length }} 个商品</span>
        <span v-if="status === 'loading'">正在更新</span>
      </div>
      <RingInventoryMatrix v-if="category === 'SMART_RING'" :products="result.products" />
      <WatchInventoryList v-else :products="result.products" />
    </template>
  </section>
</template>

<style scoped>
.inventory-page {
  width: min(1480px, 100%);
  margin: 0 auto;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 1rem;
}

.page-kicker,
.page-title,
.page-description,
.state-panel p {
  margin: 0;
}

.page-kicker {
  color: #a0522f;
  font-size: 0.75rem;
  font-weight: 800;
}

.page-title {
  margin-top: 0.25rem;
  color: #24312b;
  font-size: 1.5rem;
}

.page-description {
  margin-top: 0.45rem;
  color: #68756e;
  font-size: 0.86rem;
  line-height: 1.55;
}

.icon-command {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border: 1px solid #d2d9d3;
  border-radius: 6px;
  color: #44524b;
  background: #ffffff;
  cursor: pointer;
}

.state-panel {
  min-height: 240px;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 0.8rem;
  color: #68746e;
}

.state-panel.error {
  color: #913d2c;
}

.retry-button {
  min-height: 38px;
  border: 1px solid #d4dad5;
  border-radius: 6px;
  padding: 0.45rem 0.8rem;
  color: #334139;
  background: #ffffff;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.result-summary {
  display: flex;
  justify-content: space-between;
  padding-top: 0.8rem;
  color: #738078;
  font-size: 0.76rem;
}
</style>
