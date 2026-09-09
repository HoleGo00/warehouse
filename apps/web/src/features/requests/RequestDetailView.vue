<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import { useRoute } from 'vue-router';
import type {
  CompleteTemporaryPaperwork,
  NormalRequestDraft,
  RequestDetail,
} from '@glorychips/contracts';
import { Ban, Pencil, RefreshCw } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createCatalogApi } from '../catalog/catalog-api.js';
import { createInventoryApi } from '../inventory/inventory-api.js';
import NormalRequestForm from './NormalRequestForm.vue';
import PaperworkRequestForm from './PaperworkRequestForm.vue';
import RequestMovements from '../reports/RequestMovements.vue';
import { createIdempotencyKeyStore, createRequestApi } from './request-api.js';
import {
  buildRequestVariantOptions,
  requestOriginLabels,
  requestStatusLabel,
  requestTypeLabel,
  returnModeLabels,
  type RequestVariantOption,
} from './request-view-model.js';

const route = useRoute();
const api = createRequestApi();
const catalogApi = createCatalogApi();
const inventoryApi = createInventoryApi();
const resubmitKeys = createIdempotencyKeyStore();
const paperworkKeys = createIdempotencyKeyStore();
const cancelKeys = createIdempotencyKeyStore();
const requestId = computed<string | null>(() => {
  const value = route.params.requestId;
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value) ? value : null;
});
const detail = shallowRef<RequestDetail | null>(null);
const options = shallowRef<readonly RequestVariantOption[]>([]);
const loading = shallowRef(true);
const acting = shallowRef(false);
const editing = shallowRef(false);
const cancelReason = shallowRef('');
const errorMessage = shallowRef<string | null>(null);
const successMessage = shallowRef<string | null>(null);
let latestLoad = 0;

const initialDraft = computed<NormalRequestDraft | undefined>(() => {
  if (
    detail.value === null ||
    detail.value.type === null ||
    detail.value.purposeObject === null ||
    detail.value.finalDestination === null
  )
    return undefined;
  return {
    type: detail.value.type,
    purposeObject: detail.value.purposeObject,
    finalDestination: detail.value.finalDestination,
    notes: detail.value.notes ?? '',
    returnMode: detail.value.returnMode,
    expectedReturnDate: detail.value.expectedReturnDate,
    items: detail.value.items.map((item) => ({
      variantId: item.variantId,
      quantity: item.quantity,
    })),
  };
});

const load = async (): Promise<void> => {
  const loadId = ++latestLoad;
  detail.value = null;
  options.value = [];
  editing.value = false;
  errorMessage.value = null;
  if (requestId.value === null) {
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const response = await api.detail(requestId.value);
    if (loadId !== latestLoad) return;
    detail.value = response.request;
  } catch (error: unknown) {
    if (loadId !== latestLoad) return;
    errorMessage.value = error instanceof Error ? error.message : '申请详情读取失败';
  } finally {
    if (loadId === latestLoad) loading.value = false;
  }
};

watch(() => route.params.requestId, load, { immediate: true });

const beginEdit = async (): Promise<void> => {
  if (detail.value === null) return;
  const targetRequestId = detail.value.id;
  const targetWarehouse = detail.value.warehouse;
  acting.value = true;
  errorMessage.value = null;
  try {
    const [catalog, inventory] = await Promise.all([
      catalogApi.listSelectable(),
      inventoryApi.query({ warehouse: targetWarehouse }),
    ]);
    if (detail.value?.id !== targetRequestId) return;
    options.value = buildRequestVariantOptions(catalog, inventory, targetWarehouse);
    editing.value = true;
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : '可领用商品读取失败';
  } finally {
    acting.value = false;
  }
};

const resubmit = async (draft: NormalRequestDraft): Promise<void> => {
  if (requestId.value === null) return;
  const command = { requestId: requestId.value, draft };
  acting.value = true;
  errorMessage.value = null;
  successMessage.value = null;
  try {
    detail.value = (
      await api.resubmit(requestId.value, draft, resubmitKeys.keyFor(command))
    ).request;
    editing.value = false;
    successMessage.value = '申请已重新提交审核';
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : '重新提交失败';
  } finally {
    acting.value = false;
  }
};

const cancel = async (): Promise<void> => {
  if (requestId.value === null || cancelReason.value.trim().length === 0) return;
  const command = { requestId: requestId.value, reason: cancelReason.value.trim() };
  acting.value = true;
  errorMessage.value = null;
  successMessage.value = null;
  try {
    detail.value = (
      await api.cancel(requestId.value, { reason: command.reason }, cancelKeys.keyFor(command))
    ).request;
    cancelReason.value = '';
    successMessage.value = '申请已取消';
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : '取消申请失败';
  } finally {
    acting.value = false;
  }
};

const completePaperwork = async (command: CompleteTemporaryPaperwork): Promise<void> => {
  if (requestId.value === null) return;
  const signature = { requestId: requestId.value, command };
  acting.value = true;
  errorMessage.value = null;
  successMessage.value = null;
  try {
    detail.value = (
      await api.completePaperwork(requestId.value, command, paperworkKeys.keyFor(signature))
    ).request;
    successMessage.value = '手续已提交审核';
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : '手续提交失败';
  } finally {
    acting.value = false;
  }
};
</script>

<template>
  <section class="page" aria-labelledby="request-detail-title">
    <header class="page-header">
      <h1 id="request-detail-title">{{ detail?.requestNumber ?? '领用申请' }}</h1>
      <Button
        type="button"
        variant="outline"
        size="icon"
        title="刷新"
        aria-label="刷新"
        :disabled="loading"
        @click="load"
      >
        <RefreshCw :size="18" aria-hidden="true" />
      </Button>
    </header>

    <div v-if="loading" class="state" role="status">正在读取申请详情</div>
    <div v-else-if="requestId === null" class="state" role="alert">申请编号无效</div>
    <div v-else-if="detail === null" class="state" role="alert">{{ errorMessage }}</div>
    <template v-else>
      <p v-if="errorMessage" class="message error" role="alert">{{ errorMessage }}</p>
      <p v-if="successMessage" class="message success" role="status">{{ successMessage }}</p>

      <PaperworkRequestForm
        v-if="detail.allowedActions.completePaperwork"
        :key="detail.updatedAt"
        :detail="detail"
        :submitting="acting"
        @submit="completePaperwork"
      />

      <NormalRequestForm
        v-else-if="editing && initialDraft"
        :key="detail.updatedAt"
        :warehouse="detail.warehouse"
        :options="options"
        :initial="initialDraft"
        :submitting="acting"
        submit-label="重新提交审核"
        @submit="resubmit"
      />

      <template v-else>
        <section class="summary-band">
          <div>
            <span>状态</span><strong>{{ requestStatusLabel(detail.status, detail.origin) }}</strong>
          </div>
          <div>
            <span>来源</span><strong>{{ requestOriginLabels[detail.origin] }}</strong>
          </div>
          <div>
            <span>仓库</span><strong>{{ detail.warehouseName }}</strong>
          </div>
          <div>
            <span>类型</span><strong>{{ requestTypeLabel(detail.type) }}</strong>
          </div>
          <div>
            <span>数量</span><strong>{{ detail.totalQuantity }} 件</strong>
          </div>
        </section>

        <section class="detail-section">
          <h2>业务信息</h2>
          <dl class="detail-grid">
            <div>
              <dt>用途 / 对象</dt>
              <dd>{{ detail.purposeObject ?? '待补手续' }}</dd>
            </div>
            <div>
              <dt>最终去向</dt>
              <dd>{{ detail.finalDestination ?? '待补手续' }}</dd>
            </div>
            <div>
              <dt>归还规则</dt>
              <dd>{{ returnModeLabels[detail.returnMode] }}</dd>
            </div>
            <div>
              <dt>预计归还</dt>
              <dd>{{ detail.expectedReturnDate ?? '无固定日期' }}</dd>
            </div>
            <div class="wide">
              <dt>备注</dt>
              <dd>{{ detail.notes ?? '无' }}</dd>
            </div>
            <div>
              <dt>领用人</dt>
              <dd>{{ detail.claimantName }}</dd>
            </div>
            <div v-if="detail.fulfillment">
              <dt>出库经办人</dt>
              <dd>{{ detail.fulfillment.executorName }}</dd>
            </div>
            <div v-if="detail.paperworkDueAt">
              <dt>手续截止</dt>
              <dd :class="{ overdue: detail.paperworkOverdue }">
                {{ new Date(detail.paperworkDueAt).toLocaleString('zh-CN') }}
              </dd>
            </div>
          </dl>
        </section>

        <section class="detail-section">
          <h2>领用明细</h2>
          <div class="item-list">
            <div v-for="item in detail.items" :key="item.id" class="item-row">
              <span>{{ item.variantName }}</span>
              <strong>{{ item.quantity }} 件</strong>
            </div>
          </div>
        </section>

        <section v-if="detail.returnObligations.length > 0" class="detail-section">
          <h2>归还进度</h2>
          <div class="history-list">
            <div
              v-for="obligation in detail.returnObligations"
              :key="obligation.id"
              class="history-row"
            >
              <strong>{{
                detail.items.find((item) => item.variantId === obligation.variantId)?.variantName ??
                obligation.variantId
              }}</strong>
              <span
                >应还 {{ obligation.requiredQuantity }} · 已还 {{ obligation.returnedQuantity }} ·
                剩余 {{ obligation.remainingQuantity }}</span
              >
              <p>{{ obligation.dueDate ?? '员工离职时归还' }}</p>
              <div v-for="record in obligation.returns" :key="record.id" class="return-record">
                <span>{{ record.warehouseName }} · {{ record.quantity }} 件</span>
                <span
                  >{{ record.processorName }} ·
                  {{ new Date(record.returnedAt).toLocaleString('zh-CN') }}</span
                >
              </div>
            </div>
          </div>
        </section>

        <section v-if="detail.approvals.length > 0" class="detail-section">
          <h2>审核记录</h2>
          <div class="history-list">
            <div v-for="approval in detail.approvals" :key="approval.id" class="history-row">
              <strong>{{ approval.decision === 'APPROVED' ? '批准' : '退回' }}</strong>
              <!-- prettier-ignore -->
              <span>{{ approval.reviewerName }} · {{ new Date(approval.reviewedAt).toLocaleString('zh-CN') }}</span>
              <p>{{ approval.comment ?? '无审核意见' }}</p>
            </div>
          </div>
        </section>

        <RequestMovements :request-id="detail.id" />
        <section v-if="detail.allowedActions.resubmit" class="action-band">
          <Button
            class="secondary-button"
            type="button"
            variant="outline"
            :disabled="acting"
            @click="beginEdit"
          >
            <Pencil :size="17" aria-hidden="true" />
            修改并重新提交
          </Button>
        </section>

        <section
          v-if="detail.allowedActions.cancel"
          class="cancel-band"
          aria-labelledby="cancel-title"
        >
          <div>
            <h2 id="cancel-title">取消申请</h2>
            <p>审核通过后取消会同时释放整批预占库存。</p>
          </div>
          <div class="cancel-reason">
            <Label for="cancel-reason">取消原因</Label>
            <Textarea
              id="cancel-reason"
              v-model="cancelReason"
              rows="2"
              maxlength="1000"
              placeholder="填写取消原因"
            />
          </div>
          <Button
            type="button"
            variant="destructive"
            :disabled="acting || cancelReason.trim().length === 0"
            @click="cancel"
          >
            <Ban :size="17" aria-hidden="true" />
            {{ acting ? '处理中' : '确认取消' }}
          </Button>
        </section>
      </template>
    </template>
  </section>
</template>

<style scoped>
.page {
  width: min(980px, 100%);
  margin: 0 auto;
}

.page-header,
.summary-band,
.item-row,
.history-row,
.action-band,
.cancel-band {
  display: flex;
}

.page-header {
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #d8ded9;
}

.page-header h1,
.detail-section h2,
.history-row p,
.cancel-band h2,
.cancel-band p {
  margin: 0;
}

.page-header h1 {
  font-size: 1.35rem;
  overflow-wrap: anywhere;
}

.page-header button,
.secondary-button,
.cancel-band button {
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  border: 1px solid #c6cfc8;
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  background: #ffffff;
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}

.page-header button {
  width: 40px;
  padding: 0;
}

.state {
  min-height: 320px;
  display: grid;
  place-items: center;
  color: #6d7972;
}

.message {
  padding: 0.75rem 1rem;
  border-left: 3px solid;
}

.message.error {
  border-color: #b14d39;
  color: #8f3f30;
  background: #fff2ef;
}

.message.success {
  border-color: #23704f;
  color: #205d45;
  background: #eaf4ee;
}

.summary-band {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 1px;
  margin-top: 1rem;
  background: #dbe1dc;
}

.summary-band > div {
  min-width: 0;
  display: grid;
  gap: 0.3rem;
  padding: 0.85rem;
  background: #ffffff;
}

.summary-band span,
dt,
.history-row span {
  color: #6d7972;
  font-size: 0.78rem;
}

.detail-section {
  padding: 1.2rem 0;
  border-bottom: 1px solid #dde2de;
}

.detail-section h2,
.cancel-band h2 {
  font-size: 1rem;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  margin: 1rem 0 0;
}

.detail-grid > div {
  min-width: 0;
}

.detail-grid .wide {
  grid-column: 1 / -1;
}

dd {
  margin: 0.25rem 0 0;
  overflow-wrap: anywhere;
}

.overdue {
  color: #a33f31;
  font-weight: 800;
}

.item-list,
.history-list {
  display: grid;
  margin-top: 0.7rem;
}

.item-row {
  justify-content: space-between;
  gap: 1rem;
  padding: 0.65rem 0;
  border-top: 1px solid #e4e8e5;
}

.item-row span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.history-row {
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.35rem 0.7rem;
  padding: 0.75rem 0;
  border-top: 1px solid #e4e8e5;
}

.history-row p {
  width: 100%;
  color: #4d5952;
}

.return-record {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid #e4e8e5;
  color: #68746e;
  font-size: 0.78rem;
}

.action-band {
  justify-content: flex-end;
  padding: 1rem 0;
}

.cancel-band {
  align-items: center;
  gap: 1rem;
  margin-top: 1rem;
  padding: 1rem;
  border-left: 3px solid #aa4b38;
  background: #fff2ef;
}

.cancel-band > div {
  flex: 1;
}

.cancel-band p {
  margin-top: 0.2rem;
  color: #79594f;
  font-size: 0.78rem;
}

.cancel-reason {
  min-width: 220px;
  display: grid;
  gap: 0.35rem;
  color: #79594f;
  font-size: 0.78rem;
  font-weight: 800;
}

.cancel-band textarea {
  width: 100%;
  min-width: 220px;
  min-height: 64px;
  border: 1px solid #d6b8b0;
  border-radius: 6px;
  padding: 0.55rem;
  font: inherit;
  resize: vertical;
}

.cancel-band button {
  color: #ffffff;
  border-color: #a84d39;
  background: #a84d39;
}

button:disabled {
  cursor: wait;
  opacity: 0.65;
}

@media (max-width: 700px) {
  .summary-band,
  .detail-grid {
    grid-template-columns: 1fr 1fr;
  }

  .cancel-band {
    align-items: stretch;
    flex-direction: column;
  }

  .cancel-reason,
  .cancel-band textarea,
  .cancel-band button,
  .secondary-button {
    width: 100%;
    min-width: 0;
  }
}
</style>
