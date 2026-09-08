<script setup lang="ts">
import type { SyncJob } from '@glorychips/contracts';
import { Eye } from '@lucide/vue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { jobStatusLabel, statusLabels, syncDate, targetLabels } from './sync-view-model.js';
defineProps<{ jobs: readonly SyncJob[] }>();
defineEmits<{ detail: [id: string] }>();
</script>

<template>
  <Table class="min-w-[800px]">
    <TableHeader
      ><TableRow>
        <TableHead>业务单号</TableHead><TableHead>状态</TableHead><TableHead>商品大类</TableHead>
        <TableHead>尝试次数</TableHead><TableHead>下次重试</TableHead
        ><TableHead class="w-14">详情</TableHead>
      </TableRow></TableHeader
    >
    <TableBody
      ><TableRow v-for="job in jobs" :key="job.id">
        <TableCell class="max-w-60 whitespace-normal break-all font-medium">
          {{ job.businessNumber || '库存对账' }}
        </TableCell>
        <TableCell
          ><Badge :variant="job.status === 'MANUAL_REVIEW' ? 'destructive' : 'outline'">
            {{ jobStatusLabel(job) }}
          </Badge></TableCell
        >
        <TableCell
          ><div class="grid gap-1 text-xs">
            <span v-for="step in job.steps" :key="step.id"
              >{{ targetLabels[step.target] }} · {{ statusLabels[step.status] }}</span
            >
          </div></TableCell
        >
        <TableCell class="tabular-nums">{{ job.attempts }}</TableCell>
        <TableCell class="text-xs text-muted-foreground">{{
          job.status === 'RETRY' ? syncDate(job.availableAt) : '—'
        }}</TableCell>
        <TableCell
          ><Button
            variant="ghost"
            size="icon"
            title="查看同步详情"
            aria-label="查看同步详情"
            @click="$emit('detail', job.id)"
          >
            <Eye aria-hidden="true" /> </Button
        ></TableCell> </TableRow
    ></TableBody>
  </Table>
</template>
