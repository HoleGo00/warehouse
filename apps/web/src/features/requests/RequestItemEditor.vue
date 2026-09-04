<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import type { RequestItemInput } from '@glorychips/contracts';
import { Plus, Trash2 } from '@lucide/vue';
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
import type { RequestVariantOption } from './request-view-model.js';

const props = defineProps<{
  items: readonly RequestItemInput[];
  options: readonly RequestVariantOption[];
  disabled?: boolean;
}>();

const emit = defineEmits<{
  'update:items': [items: RequestItemInput[]];
}>();

const selectedVariantId = shallowRef('');
const selectedQuantity = shallowRef(1);
const availableOptions = computed(() =>
  props.options.filter(
    (option) => !props.items.some((item) => item.variantId === option.variantId),
  ),
);
const optionById = computed(
  () => new Map(props.options.map((option) => [option.variantId, option])),
);
const totalQuantity = computed(() => props.items.reduce((sum, item) => sum + item.quantity, 0));

const setSelectedQuantity = (value: string | number): void => {
  selectedQuantity.value = Number(value);
};

const addLine = (): void => {
  if (
    selectedVariantId.value.length === 0 ||
    !Number.isSafeInteger(selectedQuantity.value) ||
    selectedQuantity.value <= 0 ||
    props.items.some((item) => item.variantId === selectedVariantId.value)
  )
    return;

  emit('update:items', [
    ...props.items,
    { variantId: selectedVariantId.value, quantity: selectedQuantity.value },
  ]);
  selectedVariantId.value = '';
  selectedQuantity.value = 1;
};

const updateQuantity = (variantId: string, value: string | number): void => {
  const quantity = Number(value);
  emit(
    'update:items',
    props.items.map((item) => (item.variantId === variantId ? { ...item, quantity } : item)),
  );
};

const removeLine = (variantId: string): void => {
  emit(
    'update:items',
    props.items.filter((item) => item.variantId !== variantId),
  );
};
</script>

<template>
  <section class="item-editor" aria-labelledby="request-items-title">
    <div class="section-heading">
      <h2 id="request-items-title">领用明细</h2>
      <span>{{ items.length }} 个规格，共 {{ totalQuantity }} 件</span>
    </div>

    <div class="line-adder">
      <div class="field line-product">
        <Label for="request-variant">商品规格</Label>
        <Select v-model="selectedVariantId" :disabled="disabled">
          <SelectTrigger id="request-variant" class="control">
            <SelectValue placeholder="请选择" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="option in availableOptions"
              :key="option.variantId"
              :value="option.variantId"
              :disabled="option.availableQuantity <= 0"
            >
              {{ option.variantName }}（可用 {{ option.availableQuantity }}）
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div class="field line-quantity">
        <Label for="request-quantity">数量</Label>
        <Input
          id="request-quantity"
          :model-value="selectedQuantity"
          type="number"
          min="1"
          step="1"
          :disabled="disabled"
          @update:model-value="setSelectedQuantity"
        />
      </div>

      <Button
        type="button"
        variant="outline"
        class="add-button"
        :disabled="disabled"
        @click="addLine"
      >
        <Plus aria-hidden="true" />添加
      </Button>
    </div>

    <div v-if="items.length === 0" class="empty-lines">尚未添加商品规格</div>
    <div v-else class="request-lines">
      <div v-for="item in items" :key="item.variantId" class="request-line">
        <div class="line-copy">
          <strong>{{ optionById.get(item.variantId)?.variantName ?? item.variantId }}</strong>
          <span>可用 {{ optionById.get(item.variantId)?.availableQuantity ?? '未知' }}</span>
        </div>
        <Label class="sr-only" :for="`quantity-${item.variantId}`">数量</Label>
        <Input
          :id="`quantity-${item.variantId}`"
          class="quantity-input"
          :model-value="item.quantity"
          type="number"
          min="1"
          step="1"
          :disabled="disabled"
          @update:model-value="updateQuantity(item.variantId, $event)"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          title="删除明细"
          aria-label="删除明细"
          :disabled="disabled"
          @click="removeLine(item.variantId)"
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.item-editor {
  display: grid;
  gap: 1rem;
  padding: 1.1rem 0;
  border-bottom: 1px solid #d9ded9;
}
.section-heading,
.line-adder,
.request-line {
  display: flex;
  align-items: center;
}
.section-heading {
  justify-content: space-between;
  gap: 1rem;
}
.section-heading h2 {
  margin: 0;
  color: #26332d;
  font-size: 1rem;
}
.section-heading span,
.line-copy span {
  color: #69766f;
  font-size: 0.78rem;
}
.line-adder {
  align-items: end;
  gap: 0.75rem;
}
.field,
.line-copy,
.request-lines {
  display: grid;
}
.field {
  gap: 0.4rem;
}
.line-product {
  min-width: 0;
  flex: 1;
}
.line-quantity {
  width: 110px;
}
.control,
.add-button {
  min-height: 40px;
}
.request-lines {
  gap: 0.5rem;
}
.request-line {
  gap: 0.75rem;
  padding: 0.7rem 0;
  border-top: 1px solid #e1e5e1;
}
.line-copy {
  min-width: 0;
  flex: 1;
  gap: 0.2rem;
}
.line-copy strong {
  overflow-wrap: anywhere;
}
.quantity-input {
  width: 92px;
}
.empty-lines {
  padding: 1rem;
  border: 1px dashed #cbd3cd;
  color: #738078;
  text-align: center;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
}
@media (max-width: 680px) {
  .line-adder {
    align-items: stretch;
    flex-direction: column;
  }
  .line-quantity,
  .add-button {
    width: 100%;
  }
  .request-line {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 84px 32px;
  }
  .quantity-input {
    width: 84px;
  }
}
</style>
