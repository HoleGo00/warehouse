<script setup lang="ts">
import { computed, onMounted, shallowRef, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { WarehouseEntriesResponse, WarehouseEntry } from '@glorychips/contracts';
import { warehouseCodeSchema } from '@glorychips/contracts';
import { Clock3, ClipboardList, Download, MapPinned, TriangleAlert } from '@lucide/vue';
import { createWarehousesApi } from './warehouses-api.js';

const route = useRoute();
const api = createWarehousesApi();
const entries = shallowRef<WarehouseEntriesResponse | null>(null);
const loading = shallowRef(true);
const errorMessage = shallowRef<string | null>(null);

const warehouseCode = computed(() => warehouseCodeSchema.safeParse(route.params.warehouseCode));
const entry = computed<WarehouseEntry | null>(() => {
  if (!warehouseCode.value.success || entries.value === null) return null;
  return entries.value.items.find((item) => item.code === warehouseCode.value.data) ?? null;
});

const load = async (): Promise<void> => {
  loading.value = true;
  errorMessage.value = null;
  try {
    entries.value = await api.listEntries();
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : '仓库入口读取失败';
  } finally {
    loading.value = false;
  }
};

watch(
  () => route.params.warehouseCode,
  () => {
    errorMessage.value = null;
  },
);

onMounted(load);
</script>

<template>
  <section class="entry-page" aria-labelledby="entry-title">
    <div v-if="!warehouseCode.success" class="invalid-state" role="alert">
      <TriangleAlert :size="28" aria-hidden="true" />
      <h1 id="entry-title">仓库入口无效</h1>
      <p>该二维码或链接不属于已配置的仓库。</p>
      <RouterLink class="primary-link" to="/inventory">返回库存查询</RouterLink>
    </div>

    <div v-else-if="loading" class="invalid-state" role="status">正在确认仓库入口</div>

    <div v-else-if="errorMessage" class="invalid-state" role="alert">
      <p>{{ errorMessage }}</p>
      <button class="secondary-button" type="button" @click="load">重新加载</button>
    </div>

    <div v-else-if="entry === null" class="invalid-state" role="alert">
      <TriangleAlert :size="28" aria-hidden="true" />
      <h1 id="entry-title">仓库当前不可用</h1>
      <p>入口对应的仓库不存在或已停用。</p>
    </div>

    <template v-else>
      <header class="entry-header">
        <div class="warehouse-icon" aria-hidden="true">
          <MapPinned :size="26" />
        </div>
        <div>
          <p class="page-kicker">扫码入口已锁定</p>
          <h1 id="entry-title" class="page-title">{{ entry.name }}</h1>
          <p class="entry-code">{{ entry.code }}</p>
        </div>
      </header>

      <div class="entry-grid">
        <RouterLink
          class="flow-option flow-option-link"
          :to="`/w/${entry.code}/apply/normal`"
          aria-labelledby="normal-title"
        >
          <ClipboardList :size="24" aria-hidden="true" />
          <div>
            <h2 id="normal-title">正常领用</h2>
            <p>按标准申请、审批和仓库发放流程办理。</p>
          </div>
          <span class="available-now">开始申请</span>
        </RouterLink>

        <section class="flow-option" aria-labelledby="temporary-title">
          <Clock3 :size="24" aria-hidden="true" />
          <div>
            <h2 id="temporary-title">临时领用</h2>
            <p>用于紧急线下发放后的补手续入口。</p>
          </div>
          <span class="coming-soon">后续任务开放</span>
        </section>
      </div>

      <aside class="entry-note">
        <div>
          <strong>正常领用已启用</strong>
          <p>提交申请不会立即扣减库存，审核通过后预占，确认发放时才生成库存流水。</p>
        </div>
        <a
          class="download-link"
          :href="api.qrDownloadUrl(entry.qrCodeUrl)"
          :download="`warehouse-${entry.code.toLowerCase()}-apply.svg`"
        >
          <Download :size="17" aria-hidden="true" />
          下载二维码
        </a>
      </aside>

      <p v-if="!entries?.productionReady" class="environment-note">
        本地二维码仅供功能验收，正式物料需等待生产 HTTPS 域名配置。
      </p>
    </template>
  </section>
</template>

<style scoped>
.entry-page {
  width: min(980px, 100%);
  margin: 0 auto;
}

.entry-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 0 1.5rem;
  border-bottom: 1px solid #d8ded9;
}

.warehouse-icon {
  width: 52px;
  height: 52px;
  display: grid;
  flex: 0 0 52px;
  place-items: center;
  border-radius: 8px;
  color: #ffffff;
  background: #1d684d;
}

.page-kicker,
.page-title,
.entry-code,
.flow-option h2,
.flow-option p,
.entry-note p,
.environment-note,
.invalid-state h1,
.invalid-state p {
  margin: 0;
}

.page-kicker {
  color: #a0522f;
  font-size: 0.74rem;
  font-weight: 800;
}

.page-title {
  margin-top: 0.2rem;
  color: #24312b;
  font-size: 1.55rem;
}

.entry-code {
  margin-top: 0.2rem;
  color: #76827b;
  font-size: 0.75rem;
  font-weight: 700;
}

.entry-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  padding: 1.5rem 0;
}

.flow-option {
  min-height: 190px;
  display: grid;
  grid-template-rows: auto 1fr auto;
  align-content: start;
  gap: 1rem;
  border: 1px solid #d4dad5;
  border-radius: 8px;
  padding: 1.35rem;
  color: #226148;
  background: #ffffff;
}

.flow-option-link {
  text-decoration: none;
}

.flow-option-link:hover {
  border-color: #7fa58f;
  background: #f8fbf9;
}

.flow-option h2 {
  color: #26332d;
  font-size: 1.05rem;
}

.flow-option p {
  margin-top: 0.45rem;
  color: #69766f;
  line-height: 1.6;
}

.coming-soon {
  width: fit-content;
  border-radius: 4px;
  padding: 0.28rem 0.5rem;
  color: #755119;
  background: #fff0d2;
  font-size: 0.74rem;
  font-weight: 700;
}

.available-now {
  width: fit-content;
  border-radius: 4px;
  padding: 0.28rem 0.5rem;
  color: #ffffff;
  background: #24684f;
  font-size: 0.74rem;
  font-weight: 700;
}

.entry-note {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.1rem;
  border-left: 3px solid #1e684d;
  background: #eaf3ed;
}

.entry-note strong {
  color: #244033;
}

.entry-note p {
  margin-top: 0.2rem;
  color: #607067;
  font-size: 0.84rem;
}

.download-link,
.primary-link,
.secondary-button {
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  border: 1px solid #bdc9c0;
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  color: #28533f;
  background: #ffffff;
  text-decoration: none;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
}

.environment-note {
  margin-top: 0.8rem;
  color: #8c5b24;
  font-size: 0.76rem;
}

.invalid-state {
  min-height: 420px;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 0.75rem;
  color: #7d4939;
  text-align: center;
}

.invalid-state p {
  color: #707b75;
}

@media (max-width: 680px) {
  .entry-grid {
    grid-template-columns: 1fr;
  }

  .entry-note {
    align-items: stretch;
    flex-direction: column;
  }

  .download-link {
    width: 100%;
  }
}
</style>
