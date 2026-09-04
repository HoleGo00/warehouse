<script setup lang="ts">
import { computed } from 'vue';
import type { NormalRequestDraft, RequestType, ReturnMode } from '@glorychips/contracts';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { requestTypeLabels, returnModeLabels } from './request-view-model.js';

const props = defineProps<{
  draft: NormalRequestDraft;
  disabled?: boolean;
  minimumReturnDate?: string;
}>();

const emit = defineEmits<{
  'update:draft': [draft: NormalRequestDraft];
}>();

const updateDraft = (patch: Partial<NormalRequestDraft>): void => {
  emit('update:draft', { ...props.draft, ...patch });
};

const type = computed<RequestType>({
  get: () => props.draft.type,
  set: (value) => updateDraft({ type: value }),
});

const returnMode = computed<ReturnMode>({
  get: () => props.draft.returnMode,
  set: (value) => updateDraft({ returnMode: value }),
});

const purposeObject = computed({
  get: () => props.draft.purposeObject,
  set: (value: string) => updateDraft({ purposeObject: value }),
});

const finalDestination = computed({
  get: () => props.draft.finalDestination,
  set: (value: string) => updateDraft({ finalDestination: value }),
});

const notes = computed({
  get: () => props.draft.notes ?? '',
  set: (value: string) => updateDraft({ notes: value }),
});

const expectedReturnDate = computed({
  get: () => props.draft.expectedReturnDate ?? '',
  set: (value: string) => updateDraft({ expectedReturnDate: value || null }),
});
</script>

<template>
  <section class="business-fields" aria-labelledby="request-info-title">
    <h2 id="request-info-title">申请信息</h2>
    <div class="field-grid">
      <div class="field">
        <Label for="request-type">领用类型</Label>
        <Select v-model="type" :disabled="disabled">
          <SelectTrigger id="request-type" class="control">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="(label, value) in requestTypeLabels" :key="value" :value="value">
              {{ label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div class="field">
        <Label for="purpose-object">用途 / 对象</Label>
        <Input id="purpose-object" v-model="purposeObject" maxlength="200" :disabled="disabled" />
      </div>

      <div class="field">
        <Label for="final-destination">最终去向</Label>
        <Input
          id="final-destination"
          v-model="finalDestination"
          maxlength="200"
          :disabled="disabled"
        />
      </div>

      <div v-if="draft.type === 'INTERNAL'" class="field">
        <Label for="return-mode">归还规则</Label>
        <Select v-model="returnMode" :disabled="disabled">
          <SelectTrigger id="return-mode" class="control">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="(label, value) in returnModeLabels" :key="value" :value="value">
              {{ label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div v-else class="field">
        <Label>归还规则</Label>
        <div class="fixed-value">{{ returnModeLabels[draft.returnMode] }}</div>
      </div>

      <div v-if="draft.returnMode === 'BY_DATE'" class="field">
        <Label for="expected-return-date">预计归还日期</Label>
        <Input
          id="expected-return-date"
          v-model="expectedReturnDate"
          type="date"
          :min="minimumReturnDate"
          :disabled="disabled"
        />
      </div>

      <div class="field field-wide">
        <Label for="request-notes">备注</Label>
        <Textarea
          id="request-notes"
          v-model="notes"
          maxlength="1000"
          rows="3"
          :disabled="disabled"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.business-fields {
  display: grid;
  gap: 1rem;
  padding: 1.1rem 0;
  border-bottom: 1px solid #d9ded9;
}
.business-fields h2 {
  margin: 0;
  color: #26332d;
  font-size: 1rem;
}
.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}
.field {
  min-width: 0;
  display: grid;
  gap: 0.4rem;
}
.field-wide {
  grid-column: 1 / -1;
}
.control,
.fixed-value {
  min-height: 40px;
}
.fixed-value {
  display: flex;
  align-items: center;
  border: 1px solid #dce2dd;
  border-radius: 6px;
  padding: 0.5rem 0.65rem;
  color: #4d5952;
  background: #f5f7f5;
  font-size: 0.875rem;
}
@media (max-width: 680px) {
  .field-grid {
    grid-template-columns: 1fr;
  }
  .field-wide {
    grid-column: auto;
  }
}
</style>
