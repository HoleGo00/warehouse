<script setup lang="ts">
import type { SyncReconciliationsResponse } from '@glorychips/contracts';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { syncDate } from './sync-view-model.js';
defineProps<{ items: SyncReconciliationsResponse['items'] }>();
const remoteStateLabels = { MISSING: '缺失', DUPLICATE: '重复', INVALID: '无效' } as const;
</script>

<template>
  <Table class="min-w-[850px]">
    <TableHeader
      ><TableRow>
        <TableHead>商品 / 规格</TableHead><TableHead>仓库</TableHead><TableHead>飞书数量</TableHead>
        <TableHead>本地已确认</TableHead><TableHead>待同步变化</TableHead
        ><TableHead>有效库存</TableHead> <TableHead>差额</TableHead><TableHead>结果</TableHead
        ><TableHead>检查时间</TableHead>
      </TableRow></TableHeader
    >
    <TableBody
      ><TableRow v-for="item in items" :key="item.id">
        <TableCell class="max-w-64 whitespace-normal"
          ><strong class="font-medium">{{ item.productName }}</strong>
          <span class="ml-2 text-muted-foreground">{{ item.variantName }}</span></TableCell
        >
        <TableCell>{{ item.warehouseName }}</TableCell
        ><TableCell>{{
          item.remoteRecordState === 'PRESENT'
            ? (item.feishuQuantity ?? '—')
            : remoteStateLabels[item.remoteRecordState]
        }}</TableCell>
        <TableCell>{{ item.confirmedFeishuQuantity }}</TableCell
        ><TableCell>{{ item.pendingMovementDelta }}</TableCell>
        <TableCell>{{ item.localEffectiveQuantity }}</TableCell
        ><TableCell class="font-medium">{{ item.difference ?? '—' }}</TableCell>
        <TableCell
          ><Badge :variant="item.status === 'MISMATCH' ? 'destructive' : 'outline'">
            {{
              item.status === 'MATCHED' ? '一致' : item.status === 'MISMATCH' ? '有差异' : '已解决'
            }}
          </Badge></TableCell
        ><TableCell class="text-xs">{{ syncDate(item.checkedAt) }}</TableCell>
      </TableRow></TableBody
    >
  </Table>
</template>
