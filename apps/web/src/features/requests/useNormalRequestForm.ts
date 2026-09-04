import { computed, reactive, shallowRef, watch } from 'vue';
import type { NormalRequestDraft, RequestType, ReturnMode } from '@glorychips/contracts';
import {
  normalizeReturnPolicy,
  totalRequestQuantity,
  validateNormalRequestDraft,
} from './request-view-model.js';

const todayInShanghai = (): string => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
};

const defaultDraft = (): NormalRequestDraft => ({
  type: 'INTERNAL',
  purposeObject: '',
  finalDestination: '',
  notes: '',
  returnMode: 'NOT_REQUIRED',
  expectedReturnDate: null,
  items: [],
});

export const useNormalRequestForm = (initial?: NormalRequestDraft) => {
  const source = initial ?? defaultDraft();
  const draft = reactive<NormalRequestDraft>({
    ...source,
    items: source.items.map((item) => ({ ...item })),
  });
  const attempted = shallowRef(false);
  const today = todayInShanghai();

  const errors = computed(() => validateNormalRequestDraft(draft, today));
  const totalQuantity = computed(() => totalRequestQuantity(draft));

  watch(
    () => draft.type,
    (type: RequestType) => {
      const normalized = normalizeReturnPolicy(type, draft.returnMode);
      draft.returnMode = normalized.returnMode;
      draft.expectedReturnDate = normalized.expectedReturnDate;
    },
  );

  watch(
    () => draft.returnMode,
    (mode: ReturnMode) => {
      if (mode !== 'BY_DATE') draft.expectedReturnDate = null;
    },
  );

  const markAttempted = (): boolean => {
    attempted.value = true;
    return errors.value.length === 0;
  };

  const toCommand = (): NormalRequestDraft => ({
    ...draft,
    notes: draft.notes?.trim() || undefined,
    expectedReturnDate: draft.expectedReturnDate ?? null,
    items: draft.items.map((item) => ({ ...item })),
  });

  return {
    draft,
    attempted,
    errors,
    totalQuantity,
    today,
    markAttempted,
    toCommand,
  };
};
