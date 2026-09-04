<script setup lang="ts">
import { reactive } from 'vue';
import type { NormalRequestDraft, RequestItemInput, WarehouseCode } from '@glorychips/contracts';
import { Send } from '@lucide/vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import RequestBusinessFields from './RequestBusinessFields.vue';
import RequestItemEditor from './RequestItemEditor.vue';
import type { RequestVariantOption } from './request-view-model.js';
import { useNormalRequestForm } from './useNormalRequestForm.js';

const props = defineProps<{
  warehouse: WarehouseCode;
  options: readonly RequestVariantOption[];
  initial?: NormalRequestDraft;
  submitting: boolean;
  submitLabel: string;
}>();

const emit = defineEmits<{
  submit: [draft: NormalRequestDraft];
}>();

const form = reactive(useNormalRequestForm(props.initial));

const updateDraft = (draft: NormalRequestDraft): void => {
  Object.assign(form.draft, draft);
};

const updateItems = (items: RequestItemInput[]): void => {
  form.draft.items.splice(0, form.draft.items.length, ...items);
};

const submit = (): void => {
  if (!form.markAttempted()) return;
  emit('submit', form.toCommand());
};
</script>

<template>
  <form class="request-form" @submit.prevent="submit">
    <div class="locked-warehouse">
      <span>领用仓库</span>
      <strong>{{ warehouse === 'XIHU' ? '西湖仓' : '余杭仓' }}</strong>
    </div>

    <RequestBusinessFields
      :draft="form.draft"
      :disabled="submitting"
      :minimum-return-date="form.today"
      @update:draft="updateDraft"
    />
    <RequestItemEditor
      :items="form.draft.items"
      :options="options"
      :disabled="submitting"
      @update:items="updateItems"
    />

    <Alert v-if="form.attempted && form.errors.length > 0" variant="destructive">
      <AlertDescription>
        <p v-for="message in form.errors" :key="message">{{ message }}</p>
      </AlertDescription>
    </Alert>

    <div class="form-actions">
      <Button type="submit" size="lg" :disabled="submitting">
        <Send aria-hidden="true" />
        {{ submitting ? '正在提交' : submitLabel }}
      </Button>
    </div>
  </form>
</template>

<style scoped>
.request-form {
  display: grid;
  gap: 1.25rem;
}
.locked-warehouse {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  padding: 0.85rem 1rem;
  border-left: 3px solid #1f684d;
  background: #eaf3ed;
}
.locked-warehouse span {
  color: #69766f;
  font-size: 0.78rem;
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
