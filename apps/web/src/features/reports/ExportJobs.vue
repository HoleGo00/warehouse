<script setup lang="ts">
import { Download, RefreshCw } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ExportJob } from '@glorychips/contracts';
defineProps<{ jobs: ExportJob[]; busy: boolean; more: boolean }>();
defineEmits<{ download: [id: string]; refresh: []; more: [] }>();
const labels = {
  QUEUED: '排队中',
  RUNNING: '生成中',
  SUCCEEDED: '可下载',
  FAILED: '失败',
  EXPIRED: '已过期',
};
const errors: Record<string, string> = {
  EXPORT_TOO_LARGE: '超出导出上限，请缩小范围',
  EXPORT_TIMEOUT: '生成超时',
  EXPORT_INVALID_TEXT: '内容超过 Excel 限制',
  FORBIDDEN_WAREHOUSE: '仓库授权已撤销',
  USER_INACTIVE: '账号已停用',
  EXPORT_STORAGE: '存储不可用',
  EXPORT_FAILED: '生成失败',
};
const date = (v: string | null) =>
  v ? new Date(v).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—';
</script>
<template>
  <section class="grid min-w-0 gap-3">
    <header class="flex items-center justify-between">
      <h2 class="font-semibold">我的导出</h2>
      <Button
        variant="outline"
        size="icon"
        title="刷新导出"
        aria-label="刷新导出"
        @click="$emit('refresh')"
        ><RefreshCw
      /></Button>
    </header>
    <div class="min-w-0 overflow-x-auto">
      <Table
        ><TableHeader
          ><TableRow
            ><TableHead>创建时间</TableHead><TableHead>状态</TableHead
            ><TableHead>单据 / 明细</TableHead><TableHead>数据截至</TableHead
            ><TableHead>下载到期</TableHead><TableHead>下载</TableHead></TableRow
          ></TableHeader
        ><TableBody>
          <TableRow v-for="job in jobs" :key="job.id"
            ><TableCell class="whitespace-nowrap">{{ date(job.createdAt) }}</TableCell
            ><TableCell
              >{{ labels[job.status] }}
              <p v-if="job.errorCode" class="max-w-56 break-words text-xs text-destructive">
                {{ errors[job.errorCode] ?? '任务执行失败' }}
              </p></TableCell
            ><TableCell>{{ job.summaryCount }} / {{ job.detailCount }}</TableCell
            ><TableCell class="whitespace-nowrap">{{ date(job.snapshotAt) }}</TableCell
            ><TableCell class="whitespace-nowrap">{{ date(job.expiresAt) }}</TableCell
            ><TableCell
              ><Button
                variant="outline"
                size="icon"
                title="下载 Excel"
                aria-label="下载 Excel"
                :disabled="busy || job.status !== 'SUCCEEDED'"
                @click="$emit('download', job.id)"
                ><Download /></Button></TableCell
          ></TableRow>
          <TableRow v-if="!jobs.length"
            ><TableCell :colspan="6" class="py-10 text-center">暂无导出任务</TableCell></TableRow
          >
        </TableBody></Table
      >
    </div>
    <Button v-if="more" variant="outline" @click="$emit('more')">更多任务</Button>
  </section>
</template>
