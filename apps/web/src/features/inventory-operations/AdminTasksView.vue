<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue';
import type {
  AdminTaskItem,
  AdminTaskStatus,
  AdminTaskType,
  TaskSeverity,
  WarehouseCode,
} from '@glorychips/contracts';
import { RefreshCw } from '@lucide/vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuthenticatedSession } from '../auth/auth-context.js';
import { createInventoryOperationsApi } from './inventory-operations-api.js';
import { managedWarehouseCodes } from './inventory-operations-view-model.js';

const session = useAuthenticatedSession();
const api = createInventoryOperationsApi();
const managedWarehouses = computed(() => managedWarehouseCodes(session.value.access));
const warehouse = shallowRef<'ALL' | WarehouseCode>('ALL');
const type = shallowRef<'ALL' | AdminTaskType>('ALL');
const status = shallowRef<'ALL' | AdminTaskStatus>('OPEN');
const severity = shallowRef<'ALL' | TaskSeverity>('ALL');
const items = shallowRef<readonly AdminTaskItem[]>([]);
const loading = shallowRef(true);
const errorMessage = shallowRef<string | null>(null);
const typeLabels: Record<AdminTaskType, string> = {
  PAPERWORK_REQUIRED: '待补手续',
  PAPERWORK_OVERDUE: '补手续超期',
  RETURN_DUE: '待归还',
  RETURN_OVERDUE: '归还超期',
  SYNC_EXCEPTION: '同步异常',
};
const severityLabels: Record<TaskSeverity, string> = {
  INFO: '普通',
  WARNING: '提醒',
  CRITICAL: '紧急',
};

const load = async (): Promise<void> => {
  loading.value = true;
  errorMessage.value = null;
  try {
    const response = await api.tasks({
      ...(warehouse.value === 'ALL' ? {} : { warehouse: warehouse.value }),
      ...(type.value === 'ALL' ? {} : { type: type.value }),
      ...(status.value === 'ALL' ? {} : { status: status.value }),
      ...(severity.value === 'ALL' ? {} : { severity: severity.value }),
    });
    items.value = response.items;
  } catch (error: unknown) {
    items.value = [];
    errorMessage.value = error instanceof Error ? error.message : '管理员任务读取失败';
  } finally {
    loading.value = false;
  }
};

onMounted(load);
</script>

<template>
  <section class="mx-auto grid w-full max-w-6xl gap-5" aria-labelledby="tasks-title">
    <header class="flex items-center justify-between border-b border-border pb-3">
      <h1 id="tasks-title" class="text-xl font-semibold">管理员任务</h1>
      <Button
        type="button"
        variant="outline"
        size="icon"
        title="刷新"
        aria-label="刷新"
        @click="load"
      >
        <RefreshCw aria-hidden="true" />
      </Button>
    </header>
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div class="grid gap-1.5">
        <Label for="task-warehouse">仓库</Label
        ><Select v-model="warehouse" @update:model-value="load">
          <SelectTrigger id="task-warehouse"><SelectValue /></SelectTrigger
          ><SelectContent>
            <SelectItem value="ALL">全部</SelectItem
            ><SelectItem v-for="code in managedWarehouses" :key="code" :value="code">
              {{ code === 'XIHU' ? '西湖仓' : '余杭仓' }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="grid gap-1.5">
        <Label for="task-type">类型</Label
        ><Select v-model="type" @update:model-value="load">
          <SelectTrigger id="task-type"><SelectValue /></SelectTrigger
          ><SelectContent>
            <SelectItem value="ALL">全部</SelectItem
            ><SelectItem v-for="(label, value) in typeLabels" :key="value" :value="value">
              {{ label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="grid gap-1.5">
        <Label for="task-status">状态</Label
        ><Select v-model="status" @update:model-value="load">
          <SelectTrigger id="task-status"><SelectValue /></SelectTrigger
          ><SelectContent>
            <SelectItem value="ALL">全部</SelectItem><SelectItem value="OPEN">待处理</SelectItem
            ><SelectItem value="COMPLETED">已完成</SelectItem
            ><SelectItem value="DISMISSED">已关闭</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="grid gap-1.5">
        <Label for="task-severity">级别</Label
        ><Select v-model="severity" @update:model-value="load">
          <SelectTrigger id="task-severity"><SelectValue /></SelectTrigger
          ><SelectContent>
            <SelectItem value="ALL">全部</SelectItem><SelectItem value="INFO">普通</SelectItem
            ><SelectItem value="WARNING">提醒</SelectItem
            ><SelectItem value="CRITICAL">紧急</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
    <Alert v-if="errorMessage" variant="destructive">
      <AlertDescription>{{ errorMessage }}</AlertDescription>
    </Alert>
    <div v-if="loading" class="py-16 text-center text-sm text-muted-foreground" role="status">
      正在读取
    </div>
    <div v-else-if="items.length === 0" class="py-16 text-center text-sm text-muted-foreground">
      暂无任务
    </div>
    <div v-else class="grid gap-1">
      <div
        v-for="item in items"
        :key="item.id"
        class="grid gap-2 border-b border-border py-3 md:grid-cols-[120px_120px_1fr_160px_auto] md:items-center"
      >
        <Badge :variant="item.severity === 'CRITICAL' ? 'destructive' : 'outline'">
          {{ severityLabels[item.severity] }}
        </Badge>
        <strong>{{ typeLabels[item.type] }}</strong>
        <span class="grid gap-1"
          ><span>{{ item.title }}</span
          ><span class="text-sm text-muted-foreground"
            >{{ item.claimantName ?? '全局任务' }} · {{ item.warehouseName ?? '全局' }}</span
          ></span
        >
        <span class="text-sm text-muted-foreground">{{
          item.dueAt ? new Date(item.dueAt).toLocaleString('zh-CN') : '无截止时间'
        }}</span>
        <Button v-if="item.requestId" as-child variant="outline" size="sm">
          <RouterLink
            :to="
              item.allowedAction === 'CONFIRM_RETURN'
                ? '/admin/returns'
                : `/requests/${item.requestId}`
            "
          >
            处理
          </RouterLink>
        </Button>
      </div>
    </div>
  </section>
</template>
