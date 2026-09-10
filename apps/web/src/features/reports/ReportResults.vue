<script setup lang="ts">
import { ChevronLeft, ChevronRight, FileDown, ExternalLink } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ReportRow } from '@glorychips/contracts';
import { requestOriginLabels, requestStatusLabels } from '../requests/request-view-model.js';
defineProps<{
  rows: ReportRow[];
  page: number;
  hasNext: boolean;
  loading: boolean;
  busy: boolean;
}>();
defineEmits<{ previous: []; next: []; export: [] }>();
const date = (v: string | null) =>
  v ? new Date(v).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '未发放';
</script>
<template>
  <section class="grid min-w-0 gap-3">
    <div class="flex items-center justify-between gap-3">
      <h2 class="font-semibold">查询结果</h2>
      <Button :disabled="busy || loading" @click="$emit('export')"><FileDown />导出筛选结果</Button>
    </div>
    <div v-if="loading" class="py-10 text-center text-sm" role="status">正在查询</div>
    <div v-else class="min-w-0 overflow-x-auto">
      <Table
        ><TableHeader
          ><TableRow
            ><TableHead>业务单号</TableHead><TableHead>仓库 / 领用人</TableHead
            ><TableHead>来源 / 状态</TableHead><TableHead>筛选明细数量</TableHead
            ><TableHead>提交日期</TableHead><TableHead>实际发放日期</TableHead
            ><TableHead>详情</TableHead></TableRow
          ></TableHeader
        >
        <TableBody
          ><TableRow v-for="row in rows" :key="row.id"
            ><TableCell class="whitespace-nowrap">{{ row.requestNumber }}</TableCell
            ><TableCell>{{ row.warehouseName }}<br />{{ row.claimantName }}</TableCell
            ><TableCell class="whitespace-nowrap"
              >{{ requestOriginLabels[row.origin] }}<br />{{
                requestStatusLabels[row.status]
              }}</TableCell
            ><TableCell class="text-right tabular-nums">{{ row.matchedQuantity }}</TableCell
            ><TableCell class="whitespace-nowrap">{{ date(row.submittedAt) }}</TableCell
            ><TableCell class="whitespace-nowrap">{{ date(row.fulfilledAt) }}</TableCell
            ><TableCell
              ><RouterLink
                :to="`/requests/${row.id}`"
                title="查看完整单据"
                aria-label="查看完整单据"
                ><ExternalLink :size="18" /></RouterLink></TableCell
          ></TableRow>
          <TableRow v-if="!rows.length"
            ><TableCell :colspan="7" class="py-10 text-center">暂无匹配单据</TableCell></TableRow
          >
        </TableBody>
      </Table>
    </div>
    <div class="flex items-center justify-end gap-2">
      <span class="text-sm">第 {{ page + 1 }} 页</span
      ><Button
        variant="outline"
        size="icon"
        title="上一页"
        aria-label="上一页"
        :disabled="!page || loading"
        @click="$emit('previous')"
        ><ChevronLeft /></Button
      ><Button
        variant="outline"
        size="icon"
        title="下一页"
        aria-label="下一页"
        :disabled="!hasNext || loading"
        @click="$emit('next')"
        ><ChevronRight
      /></Button>
    </div>
  </section>
</template>
