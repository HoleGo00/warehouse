<script setup lang="ts">
import { onMounted, shallowRef } from 'vue';
import type { WorkCalendarDay } from '@glorychips/contracts';
import { Trash2 } from '@lucide/vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createIdempotencyKeyStore } from '../requests/request-api.js';
import { createInventoryOperationsApi } from './inventory-operations-api.js';
import { shanghaiCalendarDefaults } from './inventory-operations-view-model.js';

const api = createInventoryOperationsApi();
const keys = createIdempotencyKeyStore();
const initialCalendar = shanghaiCalendarDefaults();
const from = shallowRef(initialCalendar.from);
const to = shallowRef(initialCalendar.to);
const date = shallowRef(initialCalendar.date);
const dayType = shallowRef<'WORKING' | 'REST'>('REST');
const description = shallowRef('');
const items = shallowRef<readonly WorkCalendarDay[]>([]);
const loading = shallowRef(true);
const submitting = shallowRef(false);
const errorMessage = shallowRef<string | null>(null);
const successMessage = shallowRef<string | null>(null);

const load = async (): Promise<void> => {
  loading.value = true;
  errorMessage.value = null;
  try {
    items.value = (await api.calendar(from.value, to.value)).items;
  } catch (error: unknown) {
    items.value = [];
    errorMessage.value = error instanceof Error ? error.message : '工作日历读取失败';
  } finally {
    loading.value = false;
  }
};

const submit = async (): Promise<void> => {
  const command = {
    isWorkingDay: dayType.value === 'WORKING',
    ...(description.value.trim() ? { description: description.value.trim() } : {}),
  };
  submitting.value = true;
  errorMessage.value = null;
  successMessage.value = null;
  try {
    await api.upsertCalendar(date.value, command, keys.keyFor({ date: date.value, command }));
    successMessage.value = '日历覆盖已保存';
    await load();
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : '日历保存失败';
  } finally {
    submitting.value = false;
  }
};

const remove = async (item: WorkCalendarDay): Promise<void> => {
  submitting.value = true;
  errorMessage.value = null;
  try {
    await api.deleteCalendar(item.date, keys.keyFor({ delete: item.date }));
    await load();
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : '日历删除失败';
  } finally {
    submitting.value = false;
  }
};

onMounted(load);
</script>

<template>
  <section class="mx-auto grid w-full max-w-5xl gap-5" aria-labelledby="calendar-title">
    <header class="border-b border-border pb-3">
      <h1 id="calendar-title" class="text-xl font-semibold">工作日历</h1>
    </header>
    <section class="grid gap-3 border-b border-border pb-5">
      <h2 class="text-base font-semibold">日期范围</h2>
      <div class="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div class="grid gap-1.5">
          <Label for="calendar-from">开始日期</Label
          ><Input id="calendar-from" v-model="from" type="date" />
        </div>
        <div class="grid gap-1.5">
          <Label for="calendar-to">结束日期</Label
          ><Input id="calendar-to" v-model="to" type="date" />
        </div>
        <Button type="button" variant="outline" @click="load">查询</Button>
      </div>
    </section>
    <form class="grid gap-3 border-b border-border pb-5" @submit.prevent="submit">
      <h2 class="text-base font-semibold">新增或修改</h2>
      <div class="grid gap-3 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end">
        <div class="grid gap-1.5">
          <Label for="calendar-date">日期</Label
          ><Input id="calendar-date" v-model="date" type="date" required />
        </div>
        <div class="grid gap-1.5">
          <Label for="calendar-type">日期类型</Label
          ><Select v-model="dayType">
            <SelectTrigger id="calendar-type"><SelectValue /></SelectTrigger
            ><SelectContent>
              <SelectItem value="WORKING">工作日</SelectItem
              ><SelectItem value="REST">休息日</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="grid gap-1.5">
          <Label for="calendar-description">说明</Label
          ><Input id="calendar-description" v-model="description" maxlength="200" />
        </div>
        <Button type="submit" :disabled="submitting">保存</Button>
      </div>
    </form>
    <Alert v-if="errorMessage" variant="destructive">
      <AlertDescription>{{ errorMessage }}</AlertDescription>
    </Alert>
    <Alert v-if="successMessage">
      <AlertDescription>{{ successMessage }}</AlertDescription>
    </Alert>
    <div v-if="loading" class="py-12 text-center text-sm text-muted-foreground" role="status">
      正在读取
    </div>
    <div v-else-if="items.length === 0" class="py-12 text-center text-sm text-muted-foreground">
      当前范围无显式覆盖
    </div>
    <div v-else class="grid gap-1">
      <div
        v-for="item in items"
        :key="item.date"
        class="grid gap-2 border-b border-border py-3 sm:grid-cols-[140px_100px_1fr_42px] sm:items-center"
      >
        <strong>{{ item.date }}</strong
        ><span>{{ item.isWorkingDay ? '工作日' : '休息日' }}</span
        ><span class="text-sm text-muted-foreground">{{ item.description ?? '无说明' }}</span
        ><Button
          type="button"
          variant="ghost"
          size="icon"
          title="删除覆盖"
          aria-label="删除覆盖"
          :disabled="submitting"
          @click="remove(item)"
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
    </div>
  </section>
</template>
