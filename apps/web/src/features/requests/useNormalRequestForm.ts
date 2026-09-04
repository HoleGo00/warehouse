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
  const selectedVariantId = shallowRef('');
  const selectedQuantity = shallowRef(1);
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

  const addLine = (): void => {
    if (selectedVariantId.value.length === 0 || selectedQuantity.value <= 0) return;
    if (draft.items.some((item) => item.variantId === selectedVariantId.value)) return;
    draft.items.push({
      variantId: selectedVariantId.value,
      quantity: selectedQuantity.value,
    });
    selectedVariantId.value = '';
    selectedQuantity.value = 1;
  };

  const removeLine = (variantId: string): void => {
    const index = draft.items.findIndex((item) => item.variantId === variantId);
    if (index >= 0) draft.items.splice(index, 1);
  };

  const updateQuantity = (variantId: string, quantity: number): void => {
    const item = draft.items.find((line) => line.variantId === variantId);
    if (item !== undefined) item.quantity = quantity;
  };

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
    selectedVariantId,
    selectedQuantity,
    attempted,
    errors,
    totalQuantity,
    today,
    addLine,
    removeLine,
    updateQuantity,
    markAttempted,
    toCommand,
  };
};
