<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue';
import type {
  CatalogProductResponse,
  CreateCatalogProductRequest,
  UpdateCatalogProductRequest,
} from '@glorychips/contracts';
import { Plus, RefreshCw, ShieldAlert } from '@lucide/vue';
import { useAuthenticatedSession } from '../auth/auth-context.js';
import { createCatalogApi } from './catalog-api.js';
import CatalogProductForm from './CatalogProductForm.vue';
import CatalogProductList from './CatalogProductList.vue';

const session = useAuthenticatedSession();
const api = createCatalogApi();
const products = shallowRef<readonly CatalogProductResponse[]>([]);
const selectedProduct = shallowRef<CatalogProductResponse | null>(null);
const loading = shallowRef(false);
const saving = shallowRef(false);
const errorMessage = shallowRef<string | null>(null);
const successMessage = shallowRef<string | null>(null);

const allowed = computed(() => session.value.access.roles.includes('SYSTEM_ADMIN'));

const load = async (): Promise<void> => {
  if (!allowed.value) return;
  loading.value = true;
  errorMessage.value = null;
  try {
    products.value = (await api.list()).items;
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : '商品目录读取失败';
  } finally {
    loading.value = false;
  }
};

const createProduct = async (command: CreateCatalogProductRequest): Promise<void> => {
  saving.value = true;
  errorMessage.value = null;
  successMessage.value = null;
  try {
    const response = await api.create(command);
    successMessage.value = `已创建 ${response.product.name}`;
    selectedProduct.value = null;
    await load();
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : '商品创建失败';
  } finally {
    saving.value = false;
  }
};

const updateProduct = async (
  productId: string,
  command: UpdateCatalogProductRequest,
): Promise<void> => {
  saving.value = true;
  errorMessage.value = null;
  successMessage.value = null;
  try {
    const response = await api.update(productId, command);
    successMessage.value = `已更新 ${response.product.name}`;
    selectedProduct.value = response.product;
    await load();
    selectedProduct.value =
      products.value.find((product) => product.id === response.product.id) ?? response.product;
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : '商品更新失败';
  } finally {
    saving.value = false;
  }
};

onMounted(load);
</script>

<template>
  <section class="catalog-page" aria-labelledby="catalog-title">
    <div v-if="!allowed" class="forbidden-state" role="alert">
      <ShieldAlert :size="30" aria-hidden="true" />
      <h1 id="catalog-title">无商品管理权限</h1>
      <p>只有系统管理员可以新增或修改商品。</p>
      <RouterLink class="back-link" to="/inventory">返回库存查询</RouterLink>
    </div>

    <template v-else>
      <header class="page-header">
        <div>
          <p class="page-kicker">系统管理员</p>
          <h1 id="catalog-title" class="page-title">商品管理</h1>
          <p class="page-description">管理商品名称、类别、规格模式和状态。商品不提供物理删除。</p>
        </div>
        <div class="header-actions">
          <button
            class="icon-button"
            type="button"
            title="刷新商品"
            aria-label="刷新商品"
            @click="load"
          >
            <RefreshCw :size="18" aria-hidden="true" />
          </button>
          <button class="new-button" type="button" @click="selectedProduct = null">
            <Plus :size="17" aria-hidden="true" />
            新增商品
          </button>
        </div>
      </header>

      <p v-if="errorMessage" class="feedback error" role="alert">{{ errorMessage }}</p>
      <p v-if="successMessage" class="feedback success" role="status">{{ successMessage }}</p>

      <div class="catalog-layout">
        <section class="list-region" aria-label="商品列表">
          <p class="list-summary">
            {{ loading ? '正在读取商品' : `共 ${products.length} 个商品` }}
          </p>
          <CatalogProductList
            v-if="products.length > 0"
            :products="products"
            :selected-product-id="selectedProduct?.id ?? null"
            @edit="selectedProduct = $event"
          />
          <div v-else-if="!loading" class="empty-state">暂无商品。</div>
        </section>

        <CatalogProductForm
          :product="selectedProduct"
          :busy="saving"
          @submit-create="createProduct"
          @submit-update="updateProduct"
          @cancel="selectedProduct = null"
        />
      </div>
    </template>
  </section>
</template>

<style scoped>
.catalog-page {
  width: min(1320px, 100%);
  margin: 0 auto;
}

.page-header,
.header-actions {
  display: flex;
  align-items: center;
}

.page-header {
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #d9dfda;
}

.page-kicker,
.page-title,
.page-description,
.feedback,
.list-summary,
.forbidden-state h1,
.forbidden-state p {
  margin: 0;
}

.page-kicker {
  color: #a0522f;
  font-size: 0.75rem;
  font-weight: 800;
}

.page-title {
  margin-top: 0.25rem;
  color: #26332d;
  font-size: 1.5rem;
}

.page-description {
  margin-top: 0.4rem;
  color: #68756e;
  font-size: 0.84rem;
}

.header-actions {
  gap: 0.5rem;
}

.icon-button,
.new-button,
.back-link {
  min-height: 38px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  border: 1px solid #d0d8d2;
  border-radius: 6px;
  color: #385047;
  background: #ffffff;
  text-decoration: none;
  font: inherit;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
}

.icon-button {
  width: 38px;
  padding: 0;
}

.new-button {
  border-color: #1f694e;
  color: #ffffff;
  background: #1f694e;
  padding-inline: 0.75rem;
}

.feedback {
  margin-top: 0.8rem;
  padding: 0.7rem 0.85rem;
  border-left: 3px solid;
  font-size: 0.82rem;
}

.feedback.error {
  border-color: #b34d38;
  color: #933b2a;
  background: #fff2ee;
}

.feedback.success {
  border-color: #247154;
  color: #225b46;
  background: #eaf5ee;
}

.catalog-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 310px;
  gap: 1rem;
  align-items: start;
  padding-top: 1rem;
}

.list-region {
  min-width: 0;
}

.list-summary {
  margin-bottom: 0.55rem;
  color: #727e77;
  font-size: 0.76rem;
}

.empty-state {
  min-height: 220px;
  display: grid;
  place-items: center;
  color: #727e77;
}

.forbidden-state {
  min-height: 440px;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 0.7rem;
  color: #8c4937;
  text-align: center;
}

.forbidden-state p {
  color: #6b7770;
}

@media (max-width: 960px) {
  .catalog-layout {
    grid-template-columns: 1fr;
  }

  .catalog-layout > :last-child {
    grid-row: 1;
  }
}

@media (max-width: 600px) {
  .page-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .header-actions,
  .new-button {
    width: 100%;
  }
}
</style>
