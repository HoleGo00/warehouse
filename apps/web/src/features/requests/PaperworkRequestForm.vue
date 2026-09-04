<script setup lang="ts">
import { reactive } from 'vue';
import type {
  CompleteTemporaryPaperwork,
  NormalRequestDraft,
  RequestDetail,
} from '@glorychips/contracts';
import { Send } from '@lucide/vue';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import RequestBusinessFields from './RequestBusinessFields.vue';
import { useNormalRequestForm } from './useNormalRequestForm.js';

const props = defineProps<{
  detail: RequestDetail;
  submitting: boolean;
}>();

const emit = defineEmits<{
  submit: [command: CompleteTemporaryPaperwork];
}>();

const initial: NormalRequestDraft = {
  type: props.detail.type ?? 'INTERNAL',
  purposeObject: props.detail.purposeObject ?? '',
  finalDestination: props.detail.finalDestination ?? '',
  notes: props.detail.notes ?? '',
  returnMode: props.detail.returnMode,
  expectedReturnDate: props.detail.expectedReturnDate,
  items: props.detail.items.map((item) => ({ variantId: item.variantId, quantity: item.quantity })),
};
const form = reactive(useNormalRequestForm(initial));

const updateDraft = (draft: NormalRequestDraft): void => {
  Object.assign(form.draft, draft);
};

const submit = (): void => {
  if (!form.markAttempted()) return;
  const command = form.toCommand();
  emit('submit', {
    type: command.type,
    purposeObject: command.purposeObject,
    finalDestination: command.finalDestination,
    notes: command.notes,
    returnMode: command.returnMode,
    expectedReturnDate: command.expectedReturnDate,
  });
};
</script>

<template>
  <form class="paperwork-form" @submit.prevent="submit">
    <Alert v-if="detail.status === 'REJECTED'" variant="destructive">
      <AlertTitle>待补正</AlertTitle>
      <AlertDescription>{{ detail.latestReviewComment }}</AlertDescription>
    </Alert>

    <Alert
      v-if="detail.paperworkDueAt"
      :variant="detail.paperworkOverdue ? 'destructive' : 'default'"
    >
      <AlertDescription>
        {{ detail.paperworkOverdue ? '手续已超期' : '手续截止' }}：{{
          new Date(detail.paperworkDueAt).toLocaleString('zh-CN')
        }}
      </AlertDescription>
    </Alert>

    <RequestBusinessFields
      :draft="form.draft"
      :disabled="submitting"
      :minimum-return-date="form.today"
      @update:draft="updateDraft"
    />

    <section class="readonly-items" aria-labelledby="paperwork-items-title">
      <h2 id="paperwork-items-title">已出库明细</h2>
      <div class="table-wrap">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>商品规格</TableHead><TableHead class="quantity">数量</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="item in detail.items" :key="item.id">
              <TableCell>{{ item.variantName }}</TableCell>
              <TableCell class="quantity">{{ item.quantity }} 件</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </section>

    <Alert v-if="form.attempted && form.errors.length > 0" variant="destructive">
      <AlertDescription>
        <p v-for="message in form.errors" :key="message">{{ message }}</p>
      </AlertDescription>
    </Alert>

    <div class="form-actions">
      <Button type="submit" size="lg" :disabled="submitting">
        <Send aria-hidden="true" />{{ submitting ? '正在提交' : '提交审核' }}
      </Button>
    </div>
  </form>
</template>

<style scoped>
.paperwork-form,
.readonly-items {
  display: grid;
  gap: 1rem;
}
.readonly-items {
  padding: 1.1rem 0;
  border-bottom: 1px solid #d9ded9;
}
.readonly-items h2 {
  margin: 0;
  color: #26332d;
  font-size: 1rem;
}
.table-wrap {
  max-width: 100%;
  overflow-x: auto;
}
.quantity {
  width: 100px;
  text-align: right;
}
.form-actions {
  display: flex;
  justify-content: flex-end;
}
@media (max-width: 680px) {
  .form-actions :deep(button) {
    width: 100%;
  }
}
</style>
