<script setup lang="ts">
import { computed, reactive } from 'vue';
import type { NormalRequestDraft, WarehouseCode } from '@glorychips/contracts';
import { Plus, Send, Trash2 } from '@lucide/vue';
import type { RequestVariantOption } from './request-view-model.js';
import { requestTypeLabels, returnModeLabels } from './request-view-model.js';
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
const availableOptions = computed(() =>
  props.options.filter(
    (option) => !form.draft.items.some((item) => item.variantId === option.variantId),
  ),
);
const optionById = computed(
  () => new Map(props.options.map((option) => [option.variantId, option])),
);

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
      <small>仓库由扫码入口锁定</small>
    </div>

    <section class="form-section" aria-labelledby="request-info-title">
      <h2 id="request-info-title">申请信息</h2>
      <div class="field-grid">
        <label class="field">
          <span>领用类型</span>
          <select v-model="form.draft.type">
            <option v-for="(label, value) in requestTypeLabels" :key="value" :value="value">
              {{ label }}
            </option>
          </select>
        </label>
        <label class="field">
          <span>用途 / 对象</span>
          <!-- eslint-disable-next-line vue/html-self-closing -->
          <input v-model="form.draft.purposeObject" maxlength="200" required />
        </label>
        <label class="field">
          <span>最终去向</span>
          <!-- eslint-disable-next-line vue/html-self-closing -->
          <input v-model="form.draft.finalDestination" maxlength="200" required />
        </label>
        <label v-if="form.draft.type === 'INTERNAL'" class="field">
          <span>归还规则</span>
          <select v-model="form.draft.returnMode">
            <option v-for="(label, value) in returnModeLabels" :key="value" :value="value">
              {{ label }}
            </option>
          </select>
        </label>
        <div v-else class="field fixed-policy">
          <span>归还规则</span>
          <strong>{{ returnModeLabels[form.draft.returnMode] }}</strong>
        </div>
        <label v-if="form.draft.returnMode === 'BY_DATE'" class="field">
          <span>预计归还日期</span>
          <!-- eslint-disable-next-line vue/html-self-closing -->
          <input v-model="form.draft.expectedReturnDate" type="date" :min="form.today" required />
        </label>
        <label class="field field-wide">
          <span>备注</span>
          <textarea v-model="form.draft.notes" maxlength="1000" rows="3" />
        </label>
      </div>
    </section>

    <section class="form-section" aria-labelledby="request-items-title">
      <div class="section-heading">
        <h2 id="request-items-title">领用明细</h2>
        <span>{{ form.draft.items.length }} 个规格，共 {{ form.totalQuantity }} 件</span>
      </div>
      <div class="line-adder">
        <label class="field line-product">
          <span>商品规格</span>
          <select v-model="form.selectedVariantId">
            <option value="">请选择</option>
            <option
              v-for="option in availableOptions"
              :key="option.variantId"
              :value="option.variantId"
              :disabled="option.availableQuantity <= 0"
            >
              {{ option.variantName }}（可用 {{ option.availableQuantity }}）
            </option>
          </select>
        </label>
        <label class="field line-quantity">
          <span>数量</span>
          <!-- eslint-disable-next-line vue/html-self-closing -->
          <input v-model.number="form.selectedQuantity" type="number" min="1" step="1" />
        </label>
        <button class="secondary-button add-button" type="button" @click="form.addLine">
          <Plus :size="17" aria-hidden="true" />
          添加
        </button>
      </div>

      <div v-if="form.draft.items.length === 0" class="empty-lines">尚未添加商品规格</div>
      <div v-else class="request-lines">
        <div v-for="item in form.draft.items" :key="item.variantId" class="request-line">
          <div>
            <strong>{{ optionById.get(item.variantId)?.variantName ?? item.variantId }}</strong>
            <span>可用 {{ optionById.get(item.variantId)?.availableQuantity ?? '未知' }}</span>
          </div>
          <label class="quantity-control">
            <span class="sr-only">数量</span>
            <!-- eslint-disable vue/html-self-closing -->
            <input
              :value="item.quantity"
              type="number"
              min="1"
              step="1"
              @input="
                form.updateQuantity(
                  item.variantId,
                  Number(($event.target as HTMLInputElement).value),
                )
              "
            />
            <!-- eslint-enable vue/html-self-closing -->
          </label>
          <button
            class="icon-button"
            type="button"
            title="删除明细"
            aria-label="删除明细"
            @click="form.removeLine(item.variantId)"
          >
            <Trash2 :size="17" aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>

    <div v-if="form.attempted && form.errors.length > 0" class="form-errors" role="alert">
      <p v-for="message in form.errors" :key="message">{{ message }}</p>
    </div>

    <div class="form-actions">
      <button class="primary-button" type="submit" :disabled="submitting">
        <Send :size="17" aria-hidden="true" />
        {{ submitting ? '正在提交' : submitLabel }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.request-form,
.form-section,
.field,
.request-lines,
.form-errors {
  display: grid;
}

.request-form {
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

.locked-warehouse span,
.locked-warehouse small,
.section-heading span,
.request-line span {
  color: #69766f;
  font-size: 0.78rem;
}

.locked-warehouse small {
  margin-left: auto;
}

.form-section {
  gap: 1rem;
  padding: 1.1rem 0;
  border-bottom: 1px solid #d9ded9;
}

.form-section h2,
.form-errors p {
  margin: 0;
}

.form-section h2 {
  color: #26332d;
  font-size: 1rem;
}

.field-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.field {
  gap: 0.4rem;
  min-width: 0;
  color: #4f5d56;
  font-size: 0.82rem;
  font-weight: 700;
}

.field-wide {
  grid-column: 1 / -1;
}

.field input,
.field select,
.field textarea,
.quantity-control input {
  width: 100%;
  min-height: 42px;
  border: 1px solid #cbd3cd;
  border-radius: 6px;
  padding: 0.55rem 0.65rem;
  color: #24312b;
  background: #ffffff;
  font: inherit;
}

.field textarea {
  resize: vertical;
}

.fixed-policy strong {
  min-height: 42px;
  display: flex;
  align-items: center;
  padding: 0.55rem 0.65rem;
  border: 1px solid #dce2dd;
  border-radius: 6px;
  background: #f5f7f5;
}

.section-heading,
.line-adder,
.request-line,
.form-actions {
  display: flex;
  align-items: center;
}

.section-heading {
  justify-content: space-between;
  gap: 1rem;
}

.line-adder {
  align-items: end;
  gap: 0.75rem;
}

.line-product {
  flex: 1;
}

.line-quantity {
  width: 110px;
}

.primary-button,
.secondary-button,
.icon-button {
  min-height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  border-radius: 6px;
  padding: 0.55rem 0.8rem;
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}

.primary-button {
  border: 1px solid #1c674b;
  color: #ffffff;
  background: #1c674b;
}

.secondary-button,
.icon-button {
  border: 1px solid #c8d0ca;
  color: #315744;
  background: #ffffff;
}

.icon-button {
  width: 40px;
  flex: 0 0 40px;
  padding: 0;
}

.primary-button:disabled {
  cursor: wait;
  opacity: 0.65;
}

.request-lines {
  gap: 0.5rem;
}

.request-line {
  gap: 0.75rem;
  padding: 0.7rem 0;
  border-top: 1px solid #e1e5e1;
}

.request-line > div {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 0.2rem;
}

.request-line strong {
  overflow-wrap: anywhere;
}

.quantity-control {
  width: 92px;
}

.empty-lines {
  padding: 1rem;
  border: 1px dashed #cbd3cd;
  color: #738078;
  text-align: center;
}

.form-errors {
  gap: 0.3rem;
  padding: 0.8rem 1rem;
  border-left: 3px solid #b14d39;
  color: #8f3f30;
  background: #fff2ef;
}

.form-actions {
  justify-content: flex-end;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
}

@media (max-width: 680px) {
  .field-grid {
    grid-template-columns: 1fr;
  }

  .field-wide {
    grid-column: auto;
  }

  .locked-warehouse {
    align-items: flex-start;
    flex-direction: column;
    gap: 0.25rem;
  }

  .locked-warehouse small {
    margin-left: 0;
  }

  .line-adder {
    align-items: stretch;
    flex-direction: column;
  }

  .line-quantity,
  .add-button,
  .primary-button {
    width: 100%;
  }
}
</style>
