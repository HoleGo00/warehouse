<script setup lang="ts">
import { onMounted, shallowRef } from 'vue';
import type { NormalRequestSummary } from '@glorychips/contracts';
import { ClipboardList, RefreshCw } from '@lucide/vue';
import { createRequestApi } from './request-api.js';
import { requestStatusLabels, requestTypeLabels } from './request-view-model.js';

const api = createRequestApi();
const items = shallowRef<readonly NormalRequestSummary[]>([]);
const loading = shallowRef(true);
const errorMessage = shallowRef<string | null>(null);

const load = async (): Promise<void> => {
  loading.value = true;
  errorMessage.value = null;
  try {
    items.value = (await api.listMine()).items;
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : '申请列表读取失败';
  } finally {
    loading.value = false;
  }
};

onMounted(load);
</script>

<template>
  <section class="page" aria-labelledby="my-requests-title">
    <header class="page-header">
      <div>
        <p>领用记录</p>
        <h1 id="my-requests-title">我的申请</h1>
      </div>
      <button type="button" title="刷新" aria-label="刷新" :disabled="loading" @click="load">
        <RefreshCw :size="18" aria-hidden="true" />
      </button>
    </header>

    <div v-if="loading" class="state" role="status">正在读取申请</div>
    <div v-else-if="errorMessage" class="state" role="alert">{{ errorMessage }}</div>
    <div v-else-if="items.length === 0" class="state">
      <ClipboardList :size="28" aria-hidden="true" />
      <strong>还没有正常领用申请</strong>
    </div>
    <div v-else class="request-list">
      <RouterLink
        v-for="item in items"
        :key="item.id"
        class="request-row"
        :to="`/requests/${item.id}`"
      >
        <div class="row-main">
          <span class="request-number">{{ item.requestNumber }}</span>
          <strong>{{ requestTypeLabels[item.type] }} · {{ item.purposeObject }}</strong>
          <!-- prettier-ignore -->
          <span>{{ item.warehouseName }} · {{ item.itemCount }} 个规格 · {{ item.totalQuantity }} 件</span>
        </div>
        <div class="row-state">
          <span :data-status="item.status">{{ requestStatusLabels[item.status] }}</span>
          <time :datetime="item.updatedAt">{{
            new Date(item.updatedAt).toLocaleString('zh-CN')
          }}</time>
        </div>
      </RouterLink>
    </div>
  </section>
</template>

<style scoped>
.page {
  width: min(980px, 100%);
  margin: 0 auto;
}

.page-header,
.request-row,
.row-main,
.row-state,
.state {
  display: flex;
}

.page-header {
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #d8ded9;
}

.page-header p,
.page-header h1 {
  margin: 0;
}

.page-header p {
  color: #9a542f;
  font-size: 0.75rem;
  font-weight: 800;
}

.page-header h1 {
  margin-top: 0.15rem;
  font-size: 1.45rem;
}

.page-header button {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border: 1px solid #c8d0ca;
  border-radius: 6px;
  color: #315744;
  background: #ffffff;
  cursor: pointer;
}

.state {
  min-height: 320px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 0.7rem;
  color: #6d7972;
}

.request-list {
  display: grid;
}

.request-row {
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 0.4rem;
  border-bottom: 1px solid #dde2de;
  color: inherit;
  text-decoration: none;
}

.request-row:hover {
  background: #f7f9f7;
}

.row-main,
.row-state {
  min-width: 0;
  flex-direction: column;
  gap: 0.25rem;
}

.row-main strong {
  overflow-wrap: anywhere;
}

.row-main span,
.row-state time {
  color: #6d7972;
  font-size: 0.78rem;
}

.request-number {
  font-family: ui-monospace, monospace;
}

.row-state {
  flex: 0 0 128px;
  align-items: flex-end;
}

.row-state > span {
  border-radius: 4px;
  padding: 0.25rem 0.45rem;
  color: #24523d;
  background: #e8f2ec;
  font-size: 0.76rem;
  font-weight: 800;
}

.row-state > span[data-status='REJECTED'],
.row-state > span[data-status='CANCELLED'] {
  color: #874334;
  background: #f9e9e5;
}

@media (max-width: 620px) {
  .request-row {
    align-items: flex-start;
    flex-direction: column;
  }

  .row-state {
    width: 100%;
    flex: none;
    align-items: flex-start;
  }
}
</style>
