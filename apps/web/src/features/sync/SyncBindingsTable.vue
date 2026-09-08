<script setup lang="ts">
import type { SyncBindingsResponse } from '@glorychips/contracts';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { syncDate, targetLabels } from './sync-view-model.js';
defineProps<{ items: SyncBindingsResponse['items'] }>();
const kindLabels = { PRODUCT: '产品资料', BALANCE: '库存余额', MOVEMENT: '库存流水' };
const bindingLabels = { PREPARED: '待激活', ACTIVE: '已激活', ROLLED_BACK: '已回滚' };
</script>

<template>
  <Table class="min-w-[650px]">
    <TableHeader
      ><TableRow
        ><TableHead>商品大类</TableHead><TableHead>数据表</TableHead> <TableHead>环境</TableHead
        ><TableHead>版本</TableHead><TableHead>状态</TableHead><TableHead>准备时间</TableHead>
      </TableRow></TableHeader
    >
    <TableBody
      ><TableRow v-for="item in items" :key="item.id">
        <TableCell>{{ targetLabels[item.target] }}</TableCell
        ><TableCell>{{ kindLabels[item.kind] }}</TableCell>
        <TableCell>{{ item.environment === 'FORMAL' ? '正式' : '测试' }}</TableCell
        ><TableCell>V{{ item.schemaVersion }}</TableCell>
        <TableCell
          ><Badge variant="outline">{{ bindingLabels[item.status] }}</Badge></TableCell
        >
        <TableCell class="text-xs">{{ syncDate(item.preparedAt) }}</TableCell>
      </TableRow></TableBody
    >
  </Table>
</template>
