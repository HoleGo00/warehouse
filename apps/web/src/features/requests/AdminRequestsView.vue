<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import type {
  NormalRequestAdminQueueStatus,
  NormalRequestDetail,
  NormalRequestSummary,
  WarehouseCode,
} from '@glorychips/contracts';
import { Check, PackageCheck, RefreshCw, RotateCcw, X } from '@lucide/vue';
import { useAuthenticatedSession } from '../auth/auth-context.js';
import { createIdempotencyKeyStore, createRequestApi } from './request-api.js';
import { requestStatusLabels, requestTypeLabels, returnModeLabels } from './request-view-model.js';

const session = useAuthenticatedSession();
const api = createRequestApi();
const reviewKeys = createIdempotencyKeyStore();
const fulfillKeys = createIdempotencyKeyStore();
const cancelKeys = createIdempotencyKeyStore();
const managedWarehouses = computed<readonly WarehouseCode[]>(() =>
  session.value.access.roles.includes('SYSTEM_ADMIN')
    ? ['XIHU', 'YUHANG']
    : session.value.access.warehouses,
);
const warehouse = shallowRef<WarehouseCode>(managedWarehouses.value[0] ?? 'XIHU');
const status = shallowRef<NormalRequestAdminQueueStatus>('PENDING_APPROVAL');
const items = shallowRef<readonly NormalRequestSummary[]>([]);
const selected = shallowRef<NormalRequestDetail | null>(null);
const comment = shallowRef('');
const cancelReason = shallowRef('');
const loading = shallowRef(true);
const acting = shallowRef(false);
const errorMessage = shallowRef<string | null>(null);
const successMessage = shallowRef<string | null>(null);
let latestLoad = 0;
let latestSelection = 0;

const load = async (): Promise<void> => {
  const loadId = ++latestLoad;
  latestSelection += 1;
  loading.value = true;
  errorMessage.value = null;
  selected.value = null;
  items.value = [];
  try {
    const response = await api.adminQueue({ warehouse: warehouse.value, status: status.value });
    if (loadId !== latestLoad) return;
    items.value = response.items;
  } catch (error: unknown) {
    if (loadId !== latestLoad) return;
    errorMessage.value = error instanceof Error ? error.message : '管理员队列读取失败';
  } finally {
    if (loadId === latestLoad) loading.value = false;
  }
};

watch([warehouse, status], load, { immediate: true });

const selectRequest = async (requestId: string): Promise<void> => {
  const selectionId = ++latestSelection;
  const loadId = latestLoad;
  acting.value = true;
  errorMessage.value = null;
  selected.value = null;
  try {
    const response = await api.detail(requestId);
    if (selectionId !== latestSelection || loadId !== latestLoad) return;
    selected.value = response.request;
    comment.value = '';
    cancelReason.value = '';
  } catch (error: unknown) {
    if (selectionId !== latestSelection || loadId !== latestLoad) return;
    errorMessage.value = error instanceof Error ? error.message : '申请详情读取失败';
  } finally {
    if (selectionId === latestSelection) acting.value = false;
  }
};

const completeAction = async (message: string): Promise<void> => {
  successMessage.value = message;
  await load();
};

const review = async (decision: 'APPROVED' | 'REJECTED'): Promise<void> => {
  if (selected.value === null || (decision === 'REJECTED' && comment.value.trim().length === 0))
    return;
  const command = {
    requestId: selected.value.id,
    decision,
    comment: comment.value.trim() || undefined,
  };
  acting.value = true;
  errorMessage.value = null;
  successMessage.value = null;
  try {
    await api.review(
      command.requestId,
      { decision: command.decision, comment: command.comment },
      reviewKeys.keyFor(command),
    );
    await completeAction(decision === 'APPROVED' ? '整单已批准并预占库存' : '申请已整单退回');
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : '审核操作失败';
  } finally {
    acting.value = false;
  }
};

const fulfill = async (): Promise<void> => {
  if (selected.value === null) return;
  const command = { requestId: selected.value.id };
  acting.value = true;
  errorMessage.value = null;
  successMessage.value = null;
  try {
    await api.fulfill(command.requestId, fulfillKeys.keyFor(command));
    await completeAction('整单发放完成，库存流水已生成');
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : '确认发放失败';
  } finally {
    acting.value = false;
  }
};

const cancel = async (): Promise<void> => {
  if (selected.value === null || cancelReason.value.trim().length === 0) return;
  const command = { requestId: selected.value.id, reason: cancelReason.value.trim() };
  acting.value = true;
  errorMessage.value = null;
  successMessage.value = null;
  try {
    await api.cancel(
      command.requestId,
      { reason: command.reason },
      cancelKeys.keyFor(command),
      true,
    );
    await completeAction('申请已取消，预占库存已释放');
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : '取消申请失败';
  } finally {
    acting.value = false;
  }
};
</script>

<template>
  <section class="page" aria-labelledby="admin-requests-title">
    <header class="page-header">
      <div>
        <p>仓库作业</p>
        <h1 id="admin-requests-title">正常领用审核与发放</h1>
      </div>
      <button type="button" title="刷新" aria-label="刷新" :disabled="loading" @click="load">
        <RefreshCw :size="18" aria-hidden="true" />
      </button>
    </header>

    <div v-if="managedWarehouses.length === 0" class="state" role="alert">没有可管理的仓库</div>
    <template v-else>
      <div class="filters" aria-label="队列筛选">
        <label>
          <span>仓库</span>
          <select v-model="warehouse" :disabled="loading || acting">
            <option v-for="code in managedWarehouses" :key="code" :value="code">
              {{ code === 'XIHU' ? '西湖仓' : '余杭仓' }}
            </option>
          </select>
        </label>
        <div class="segments" role="group" aria-label="申请状态">
          <button
            type="button"
            :aria-pressed="status === 'PENDING_APPROVAL'"
            :disabled="loading || acting"
            @click="status = 'PENDING_APPROVAL'"
          >
            待审核
          </button>
          <button
            type="button"
            :aria-pressed="status === 'PENDING_RELEASE'"
            :disabled="loading || acting"
            @click="status = 'PENDING_RELEASE'"
          >
            待发放
          </button>
        </div>
      </div>

      <p v-if="errorMessage" class="message error" role="alert">{{ errorMessage }}</p>
      <p v-if="successMessage" class="message success" role="status">{{ successMessage }}</p>

      <div class="workspace">
        <div class="queue" aria-label="申请队列">
          <div v-if="loading" class="state" role="status">正在读取队列</div>
          <div v-else-if="items.length === 0" class="state">当前队列为空</div>
          <button
            v-for="item in items"
            v-else
            :key="item.id"
            class="queue-row"
            type="button"
            :disabled="loading || acting"
            :aria-current="selected?.id === item.id"
            @click="selectRequest(item.id)"
          >
            <span>{{ item.requestNumber }}</span>
            <strong>{{ item.claimantName }} · {{ requestTypeLabels[item.type] }}</strong>
            <small>{{ item.totalQuantity }} 件 · {{ item.purposeObject }}</small>
          </button>
        </div>

        <div class="detail-pane">
          <div v-if="selected === null" class="state">选择一张申请查看整单详情</div>
          <template v-else>
            <div class="detail-heading">
              <div>
                <span>{{ selected.requestNumber }}</span>
                <h2>{{ selected.claimantName }}</h2>
              </div>
              <strong>{{ requestStatusLabels[selected.status] }}</strong>
            </div>
            <dl class="detail-grid">
              <div>
                <dt>类型</dt>
                <dd>{{ requestTypeLabels[selected.type] }}</dd>
              </div>
              <div>
                <dt>归还</dt>
                <dd>{{ returnModeLabels[selected.returnMode] }}</dd>
              </div>
              <div>
                <dt>用途 / 对象</dt>
                <dd>{{ selected.purposeObject }}</dd>
              </div>
              <div>
                <dt>最终去向</dt>
                <dd>{{ selected.finalDestination }}</dd>
              </div>
            </dl>
            <div class="item-list">
              <div v-for="item in selected.items" :key="item.id">
                <!-- eslint-disable vue/html-closing-bracket-newline -->
                <span>{{ item.variantName }}</span
                ><strong>{{ item.quantity }} 件</strong>
                <!-- eslint-enable vue/html-closing-bracket-newline -->
              </div>
            </div>

            <div v-if="selected.allowedActions.review" class="action-panel">
              <label>
                <span>审核意见（退回时必填）</span>
                <textarea v-model="comment" rows="3" maxlength="1000" />
              </label>
              <div class="button-row">
                <button type="button" :disabled="acting" @click="review('APPROVED')">
                  <Check :size="17" aria-hidden="true" />批准并预占
                </button>
                <button
                  class="danger"
                  type="button"
                  :disabled="acting || comment.trim().length === 0"
                  @click="review('REJECTED')"
                >
                  <RotateCcw :size="17" aria-hidden="true" />整单退回
                </button>
              </div>
            </div>

            <div
              v-if="selected.allowedActions.fulfill || selected.allowedActions.adminCancel"
              class="action-panel"
            >
              <button
                v-if="selected.allowedActions.fulfill"
                type="button"
                :disabled="acting"
                @click="fulfill"
              >
                <PackageCheck :size="17" aria-hidden="true" />确认整单发放
              </button>
              <label v-if="selected.allowedActions.adminCancel">
                <span>管理员取消原因</span>
                <textarea v-model="cancelReason" rows="2" maxlength="1000" />
              </label>
              <button
                v-if="selected.allowedActions.adminCancel"
                class="danger"
                type="button"
                :disabled="acting || cancelReason.trim().length === 0"
                @click="cancel"
              >
                <X :size="17" aria-hidden="true" />取消并释放预占
              </button>
            </div>
          </template>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.page {
  width: min(1180px, 100%);
  margin: 0 auto;
}

.page-header,
.filters,
.workspace,
.detail-heading,
.button-row,
.item-list > div {
  display: flex;
}

.page-header {
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #d8ded9;
}

.page-header p,
.page-header h1,
.detail-heading h2 {
  margin: 0;
}

.page-header p {
  color: #9a542f;
  font-size: 0.75rem;
  font-weight: 800;
}

.page-header h1 {
  margin-top: 0.15rem;
  font-size: 1.4rem;
}

.page-header button {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border: 1px solid #c6cfc8;
  border-radius: 6px;
  background: #ffffff;
  cursor: pointer;
}

.filters {
  align-items: end;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 0;
}

.filters label,
.action-panel label {
  display: grid;
  gap: 0.35rem;
  color: #56635c;
  font-size: 0.78rem;
  font-weight: 800;
}

select,
textarea {
  min-height: 40px;
  border: 1px solid #c8d0ca;
  border-radius: 6px;
  padding: 0.5rem 0.6rem;
  background: #ffffff;
  font: inherit;
}

textarea {
  width: 100%;
  resize: vertical;
}

.segments {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border: 1px solid #c8d0ca;
  border-radius: 6px;
  overflow: hidden;
}

.segments button {
  min-height: 40px;
  border: 0;
  padding: 0.5rem 0.9rem;
  background: #ffffff;
  cursor: pointer;
}

.segments button[aria-pressed='true'] {
  color: #ffffff;
  background: #23684f;
}

.workspace {
  min-height: 520px;
  border-top: 1px solid #d8ded9;
}

.queue {
  width: 340px;
  flex: 0 0 340px;
  border-right: 1px solid #d8ded9;
}

.queue-row {
  width: 100%;
  min-width: 0;
  display: grid;
  gap: 0.25rem;
  border: 0;
  border-bottom: 1px solid #e0e5e1;
  padding: 0.85rem;
  color: #26332d;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.queue-row:hover,
.queue-row[aria-current='true'] {
  background: #eaf3ed;
}

.queue-row span,
.queue-row small,
.detail-heading span,
dt {
  color: #6d7972;
  font-size: 0.76rem;
}

.queue-row strong,
.queue-row small {
  overflow-wrap: anywhere;
}

.detail-pane {
  min-width: 0;
  flex: 1;
  padding: 1rem 0 1rem 1.25rem;
}

.state {
  min-height: 180px;
  display: grid;
  place-items: center;
  padding: 1rem;
  color: #6d7972;
  text-align: center;
}

.detail-heading {
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.detail-heading > strong {
  border-radius: 4px;
  padding: 0.25rem 0.45rem;
  color: #24523d;
  background: #e8f2ec;
  font-size: 0.76rem;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  margin: 1rem 0;
}

.detail-grid > div {
  min-width: 0;
}

dd {
  margin: 0.2rem 0 0;
  overflow-wrap: anywhere;
}

.item-list {
  display: grid;
  border-top: 1px solid #dce2dd;
}

.item-list > div {
  justify-content: space-between;
  gap: 1rem;
  padding: 0.65rem 0;
  border-bottom: 1px solid #e4e8e5;
}

.item-list span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.action-panel {
  display: grid;
  gap: 0.75rem;
  margin-top: 1rem;
  padding: 1rem 0;
  border-top: 1px solid #d8ded9;
}

.button-row {
  justify-content: flex-end;
  gap: 0.6rem;
}

.action-panel button {
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  border: 1px solid #24694f;
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  color: #ffffff;
  background: #24694f;
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}

.action-panel button.danger {
  border-color: #a54c39;
  background: #a54c39;
}

button:disabled {
  cursor: wait;
  opacity: 0.65;
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

@media (max-width: 760px) {
  .filters {
    align-items: stretch;
    flex-direction: column;
  }

  .filters select,
  .segments {
    width: 100%;
  }

  .workspace {
    flex-direction: column;
  }

  .queue {
    width: 100%;
    flex: none;
    border-right: 0;
  }

  .detail-pane {
    padding: 1rem 0;
  }

  .detail-grid {
    grid-template-columns: 1fr;
  }

  .button-row {
    flex-direction: column;
  }

  .action-panel button {
    width: 100%;
  }
}
</style>
