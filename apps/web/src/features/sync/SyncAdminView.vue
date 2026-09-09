<script setup lang="ts">
import { computed } from 'vue';
import { ListChecks, RefreshCw } from '@lucide/vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuthenticatedSession } from '../auth/auth-context.js';
import SyncBindingsTable from './SyncBindingsTable.vue';
import SyncJobDialog from './SyncJobDialog.vue';
import SyncJobsTable from './SyncJobsTable.vue';
import SyncReconciliationsTable from './SyncReconciliationsTable.vue';
import { statusLabels, targetLabels } from './sync-view-model.js';
import { useSyncAdmin } from './useSyncAdmin.js';
const session = useAuthenticatedSession();
const allowed = computed(() => session.value.access.roles.includes('SYSTEM_ADMIN'));
const {
  view,
  target,
  status,
  jobs,
  reconciliations,
  bindings,
  detail,
  detailOpen,
  detailLoading,
  loading,
  busy,
  error,
  detailError,
  message,
  load,
  openDetail,
  retry,
  runReconciliation,
} = useSyncAdmin(allowed);
</script>

<template>
  <section class="mx-auto grid w-full min-w-0 max-w-7xl gap-4" aria-labelledby="sync-title">
    <header class="flex items-center justify-between gap-3 border-b border-border pb-3">
      <h1 id="sync-title" class="text-xl font-semibold">同步管理</h1>
      <Button
        v-if="allowed"
        variant="outline"
        size="icon"
        title="刷新"
        aria-label="刷新"
        :disabled="loading"
        @click="load"
      >
        <RefreshCw aria-hidden="true" :class="{ 'animate-spin': loading }" />
      </Button>
    </header>
    <Alert v-if="!allowed" variant="destructive"
      ><AlertDescription>仅系统管理员可访问</AlertDescription></Alert
    >
    <template v-else>
      <Tabs v-model="view" class="min-w-0">
        <TabsList variant="line" aria-label="同步视图" class="mb-4">
          <TabsTrigger value="jobs">任务</TabsTrigger
          ><TabsTrigger value="reconciliations">对账</TabsTrigger
          ><TabsTrigger value="bindings">绑定</TabsTrigger>
        </TabsList>
        <div class="mb-4 flex flex-wrap items-end gap-3">
          <div class="grid w-36 gap-1.5">
            <Label for="sync-target">商品大类</Label>
            <Select v-model="target"
              ><SelectTrigger id="sync-target"><SelectValue /></SelectTrigger
              ><SelectContent>
                <SelectItem value="ALL">全部</SelectItem
                ><SelectItem v-for="(label, value) in targetLabels" :key="value" :value="value">{{
                  label
                }}</SelectItem>
              </SelectContent></Select
            >
          </div>
          <div v-if="view === 'jobs'" class="grid w-44 gap-1.5">
            <Label for="sync-status">任务状态</Label>
            <Select v-model="status"
              ><SelectTrigger id="sync-status"><SelectValue /></SelectTrigger
              ><SelectContent>
                <SelectItem value="ALL">全部</SelectItem
                ><SelectItem v-for="(label, value) in statusLabels" :key="value" :value="value">{{
                  label
                }}</SelectItem>
              </SelectContent></Select
            >
          </div>
          <Button v-if="view === 'reconciliations'" :disabled="busy" @click="runReconciliation">
            <ListChecks aria-hidden="true" />{{ busy ? '正在提交' : '运行对账' }}
          </Button>
        </div>
        <Alert v-if="error" variant="destructive" class="mb-3"
          ><AlertDescription>{{ error }}</AlertDescription></Alert
        >
        <div v-if="message" role="status" class="mb-3 text-sm text-primary">{{ message }}</div>
        <div v-if="loading" class="py-12 text-center text-sm text-muted-foreground" role="status">
          正在读取
        </div>
        <template v-else>
          <TabsContent value="jobs" class="min-w-0">
            <SyncJobsTable v-if="jobs.length" :jobs="jobs" @detail="openDetail" />
            <div v-else-if="!error" class="py-12 text-center text-sm text-muted-foreground">
              暂无同步任务
            </div>
          </TabsContent>
          <TabsContent value="reconciliations" class="min-w-0">
            <SyncReconciliationsTable v-if="reconciliations.length" :items="reconciliations" />
            <div v-else-if="!error" class="py-12 text-center text-sm text-muted-foreground">
              暂无对账记录
            </div>
          </TabsContent>
          <TabsContent value="bindings" class="min-w-0">
            <SyncBindingsTable v-if="bindings.length" :items="bindings" />
            <div v-else-if="!error" class="py-12 text-center text-sm text-muted-foreground">
              暂无表绑定
            </div>
          </TabsContent>
        </template>
      </Tabs>
      <SyncJobDialog
        v-model:open="detailOpen"
        :job="detail"
        :loading="detailLoading"
        :busy="busy"
        :error="detailError"
        @retry="retry"
      />
    </template>
  </section>
</template>
