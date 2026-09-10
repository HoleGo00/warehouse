<script setup lang="ts">
import { onScopeDispose, ref, watch } from 'vue';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ReportMovementsResponse } from '@glorychips/contracts';
import { useAuthenticatedSession } from '../auth/auth-context.js';
import { createReportApi } from './report-api.js';
const props = defineProps<{ requestId: string }>();
const session = useAuthenticatedSession();
const items = ref<ReportMovementsResponse['items']>([]);
const cursor = ref<string | null>(null);
const error = ref('');
const loading = ref(false);
let generation = 0;
let controller: AbortController | undefined;
const labels: Record<string, string> = {
  ISSUE: '发放出库',
  RETURN: '实物归还',
  INBOUND: '入库',
  TRANSFER_IN: '调入',
  TRANSFER_OUT: '调出',
  STOCKTAKE_GAIN: '盘盈',
  STOCKTAKE_LOSS: '盘亏',
  MIGRATION_OPENING: '迁移期初',
};
async function load(more = false) {
  const version = ++generation;
  controller?.abort();
  controller = new AbortController();
  loading.value = true;
  try {
    const result = await createReportApi().movements(
      props.requestId,
      more ? (cursor.value ?? undefined) : undefined,
      controller.signal,
    );
    if (version === generation) {
      items.value = more ? [...items.value, ...result.items] : result.items;
      cursor.value = result.nextCursor;
    }
  } catch (e) {
    if (version === generation) {
      items.value = [];
      error.value = e instanceof Error ? e.message : '流水加载失败';
    }
  } finally {
    if (version === generation) loading.value = false;
  }
}
watch(
  () => [props.requestId, session.value.user.id, JSON.stringify(session.value.access)],
  () => {
    items.value = [];
    cursor.value = null;
    error.value = '';
    void load();
  },
  { immediate: true },
);
onScopeDispose(() => {
  generation++;
  controller?.abort();
});
</script>
<template>
  <section class="mt-5 min-w-0 border-t border-border pt-4">
    <h2 class="mb-3 font-semibold">关联库存流水</h2>
    <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
    <div class="min-w-0 overflow-x-auto">
      <Table
        ><TableHeader
          ><TableRow
            ><TableHead>类型 / 商品</TableHead><TableHead>数量变动</TableHead
            ><TableHead>变更前 / 后</TableHead><TableHead>操作人</TableHead
            ><TableHead>时间</TableHead></TableRow
          ></TableHeader
        ><TableBody>
          <TableRow v-for="item in items" :key="item.id"
            ><TableCell
              >{{ labels[item.type] }}<br />{{ item.productName }} {{ item.size }}</TableCell
            ><TableCell>{{ item.quantityDelta }}</TableCell
            ><TableCell>{{ item.effectiveBefore }} / {{ item.effectiveAfter }}</TableCell
            ><TableCell>{{ item.actorName || '历史未填写' }}</TableCell
            ><TableCell class="whitespace-nowrap">{{
              new Date(item.occurredAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
            }}</TableCell></TableRow
          >
          <TableRow v-if="!items.length && !loading"
            ><TableCell :colspan="5" class="py-6 text-center">暂无库存流水</TableCell></TableRow
          >
        </TableBody></Table
      >
    </div>
    <Button v-if="cursor" variant="outline" :disabled="loading" @click="load(true)"
      >更多流水</Button
    >
  </section>
</template>
