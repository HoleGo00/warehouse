<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import type {
  CatalogProductResponse,
  CreateCatalogProductRequest,
  ProductCategoryCode,
  ProductStatus,
  UpdateCatalogProductRequest,
} from '@glorychips/contracts';
import { Save } from '@lucide/vue';

const props = defineProps<{
  product: CatalogProductResponse | null;
  busy: boolean;
}>();

const emit = defineEmits<{
  submitCreate: [command: CreateCatalogProductRequest];
  submitUpdate: [productId: string, command: UpdateCatalogProductRequest];
  cancel: [];
}>();

interface ProductFormState {
  code: string;
  name: string;
  category: ProductCategoryCode;
  status: ProductStatus;
}

const form = reactive<ProductFormState>({
  code: '',
  name: '',
  category: 'SMART_RING',
  status: 'INACTIVE',
});

const editing = computed(() => props.product !== null);

watch(
  () => props.product,
  (product) => {
    form.code = product?.code ?? '';
    form.name = product?.name ?? '';
    form.category = product?.category ?? 'SMART_RING';
    form.status = product?.status ?? 'INACTIVE';
  },
  { immediate: true },
);

const normalizeCode = (): void => {
  form.code = form.code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_');
};

const submit = (): void => {
  const name = form.name.trim();
  if (name.length === 0) return;
  if (props.product === null) {
    normalizeCode();
    if (form.code.length < 3) return;
    emit('submitCreate', {
      code: form.code,
      name,
      category: form.category,
      status: 'INACTIVE',
    });
    return;
  }
  emit('submitUpdate', props.product.id, {
    name,
    category: form.category,
    status: form.status,
  });
};
</script>

<template>
  <form class="product-form" @submit.prevent="submit">
    <div class="form-heading">
      <div>
        <h2>{{ editing ? '编辑商品' : '新增商品' }}</h2>
        <p>{{ editing ? product?.code : '新商品默认停用，配置主图后才能启用。' }}</p>
      </div>
      <button v-if="editing" class="text-button" type="button" @click="emit('cancel')">取消</button>
    </div>

    <label class="field">
      <span>商品编码</span>
      <!-- eslint-disable vue/html-self-closing -->
      <input
        v-model="form.code"
        type="text"
        autocomplete="off"
        maxlength="80"
        :disabled="editing || busy"
        required
        @blur="normalizeCode"
      />
      <!-- eslint-enable vue/html-self-closing -->
    </label>

    <label class="field">
      <span>商品名称</span>
      <!-- eslint-disable-next-line vue/html-self-closing -->
      <input v-model="form.name" type="text" maxlength="160" :disabled="busy" required />
    </label>

    <label class="field">
      <span>商品类别</span>
      <select v-model="form.category" :disabled="busy">
        <option value="SMART_RING">智能指环</option>
        <option value="SMART_WATCH">健康腕表</option>
      </select>
    </label>

    <label v-if="editing" class="field">
      <span>商品状态</span>
      <select v-model="form.status" :disabled="busy">
        <option value="ACTIVE">启用</option>
        <option value="INACTIVE">停用</option>
        <option value="INACTIVE_HISTORICAL">历史停用</option>
      </select>
    </label>

    <button class="primary-button" type="submit" :disabled="busy">
      <Save :size="17" aria-hidden="true" />
      {{ busy ? '正在保存' : editing ? '保存修改' : '创建商品' }}
    </button>
  </form>
</template>

<style scoped>
.product-form {
  display: grid;
  align-content: start;
  gap: 1rem;
  border: 1px solid #d7ddd8;
  border-radius: 8px;
  padding: 1.2rem;
  background: #ffffff;
}

.form-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
  padding-bottom: 0.85rem;
  border-bottom: 1px solid #e1e5e1;
}

.form-heading h2,
.form-heading p {
  margin: 0;
}

.form-heading h2 {
  color: #29362f;
  font-size: 1rem;
}

.form-heading p {
  margin-top: 0.3rem;
  color: #737f78;
  font-size: 0.75rem;
  line-height: 1.45;
}

.field {
  display: grid;
  gap: 0.4rem;
  color: #5d6962;
  font-size: 0.78rem;
  font-weight: 700;
}

.field input,
.field select {
  width: 100%;
  min-height: 40px;
  border: 1px solid #cdd5cf;
  border-radius: 6px;
  padding: 0.55rem 0.65rem;
  color: #27342e;
  background: #ffffff;
  font: inherit;
  font-weight: 500;
}

.field input:focus,
.field select:focus {
  border-color: #318062;
  outline: 3px solid #dcece3;
}

.primary-button,
.text-button {
  min-height: 38px;
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
}

.primary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  border: 1px solid #1f694e;
  color: #ffffff;
  background: #1f694e;
}

.primary-button:disabled {
  cursor: wait;
  opacity: 0.65;
}

.text-button {
  border: 0;
  color: #32654f;
  background: transparent;
}
</style>
