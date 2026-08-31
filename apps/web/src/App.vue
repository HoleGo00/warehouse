<script setup lang="ts">
import { computed, ref } from 'vue';
import type { HealthResponse } from '@glorychips/contracts';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';
const health = ref<HealthResponse | null>(null);
const healthError = ref<string | null>(null);
const loading = ref(false);

const healthLabel = computed(() => {
  if (loading.value) return '检查中';
  if (health.value?.status === 'ok') return 'API 正常';
  return healthError.value === null ? '尚未检查' : 'API 不可用';
});

const checkHealth = async (): Promise<void> => {
  loading.value = true;
  healthError.value = null;
  try {
    const response = await fetch(`${apiBaseUrl}/health`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    health.value = (await response.json()) as HealthResponse;
  } catch (error: unknown) {
    health.value = null;
    healthError.value = error instanceof Error ? error.message : '网络请求失败';
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <main class="shell">
    <section class="hero" aria-labelledby="title">
      <p class="eyebrow">GLORYCHIPS WAREHOUSE</p>
      <h1 id="title">仓储基础服务</h1>
      <p class="lead">西湖仓与余杭仓的库存底账、流水和后续领用流程共用同一套领域内核。</p>
      <button type="button" :disabled="loading" @click="checkHealth">
        {{ loading ? '检查中…' : '检查 API 健康状态' }}
      </button>
      <p class="status" :class="{ error: healthError !== null }" role="status">
        {{ healthLabel }}<span v-if="healthError">：{{ healthError }}</span>
      </p>
    </section>
  </main>
</template>
