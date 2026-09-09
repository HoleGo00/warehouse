<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import type { OutboxStepTarget, RetrySyncJob, SyncJob } from '@glorychips/contracts';
import { RotateCw } from '@lucide/vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  jobStatusLabel,
  statusLabels,
  syncDate,
  syncErrorLabel,
  targetLabels,
} from './sync-view-model.js';
const props = defineProps<{
  job: SyncJob | null;
  loading: boolean;
  busy: boolean;
  error: string | null;
}>();
const open = defineModel<boolean>('open', { required: true });
const emit = defineEmits<{ retry: [command: RetrySyncJob] }>();
const reason = shallowRef('');
const target = shallowRef<'ALL' | OutboxStepTarget>('ALL');
const retryableSteps = computed(
  () => props.job?.steps.filter((step) => ['RETRY', 'MANUAL_REVIEW'].includes(step.status)) ?? [],
);
watch(
  () => props.job?.id,
  () => {
    reason.value = '';
    target.value = 'ALL';
  },
);
const submit = () => {
  if (!props.busy && reason.value.trim())
    emit('retry', {
      reason: reason.value.trim(),
      ...(target.value === 'ALL' ? {} : { target: target.value }),
    });
};
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      class="max-h-[85dvh] overflow-y-auto sm:max-w-xl"
      :aria-describedby="undefined"
      :show-close-button="!busy"
      @escape-key-down="busy && $event.preventDefault()"
      @pointer-down-outside="busy && $event.preventDefault()"
    >
      <DialogHeader><DialogTitle>同步任务详情</DialogTitle></DialogHeader>
      <Alert v-if="error" variant="destructive"
        ><AlertDescription>{{ error }}</AlertDescription></Alert
      >
      <div v-if="loading" class="py-8 text-center text-sm" role="status">正在读取</div>
      <template v-else-if="job">
        <dl class="grid grid-cols-[90px_minmax(0,1fr)] gap-2 text-sm">
          <dt class="text-muted-foreground">业务单号</dt>
          <dd class="break-all">{{ job.businessNumber || '库存对账' }}</dd>
          <dt class="text-muted-foreground">状态</dt>
          <dd>{{ jobStatusLabel(job) }}</dd>
          <dt class="text-muted-foreground">创建时间</dt>
          <dd>{{ syncDate(job.createdAt) }}</dd>
        </dl>
        <div
          v-for="step in job.steps"
          :key="step.id"
          class="grid gap-2 border-t border-border pt-3 text-sm"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <strong>{{ targetLabels[step.target] }}</strong>
            <span>{{ statusLabels[step.status] }}</span>
          </div>
          <dl class="grid grid-cols-[90px_minmax(0,1fr)] gap-1.5">
            <dt class="text-muted-foreground">尝试次数</dt>
            <dd>{{ step.attempts }}</dd>
            <dt class="text-muted-foreground">最近错误</dt>
            <dd>{{ syncErrorLabel(step.lastErrorCode) }}</dd>
            <dt class="text-muted-foreground">错误代码</dt>
            <dd class="break-all font-mono text-xs">{{ step.lastErrorCode ?? '—' }}</dd>
            <dt class="text-muted-foreground">下次重试</dt>
            <dd>{{ step.status === 'RETRY' ? syncDate(step.availableAt) : '—' }}</dd>
          </dl>
        </div>
        <form
          v-if="job.canRetry"
          class="grid gap-3 border-t border-border pt-4"
          @submit.prevent="submit"
        >
          <div class="grid gap-1.5">
            <Label for="sync-retry-target">重试范围</Label>
            <Select v-model="target" :disabled="busy"
              ><SelectTrigger id="sync-retry-target"><SelectValue /></SelectTrigger>
              <SelectContent
                ><SelectItem value="ALL">全部失败步骤</SelectItem>
                <SelectItem v-for="step in retryableSteps" :key="step.id" :value="step.target">{{
                  targetLabels[step.target]
                }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="grid gap-1.5">
            <Label for="sync-retry-reason">重试原因</Label>
            <Textarea
              id="sync-retry-reason"
              v-model="reason"
              required
              :maxlength="500"
              :disabled="busy"
            />
          </div>
          <Button type="submit" class="justify-self-end" :disabled="busy || !reason.trim()">
            <RotateCw aria-hidden="true" :class="{ 'animate-spin': busy }" />{{
              busy ? '正在提交' : '重试'
            }}
          </Button>
        </form>
      </template>
    </DialogContent>
  </Dialog>
</template>
