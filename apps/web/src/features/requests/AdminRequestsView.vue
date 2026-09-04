<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import type {
  NormalRequestAdminQueueStatus,
  PaperworkQueueState,
  RequestDetail,
  RequestSummary,
  WarehouseCode,
} from '@glorychips/contracts';
import { Check, FilePlus2, PackageCheck, RefreshCw, RotateCcw, X } from '@lucide/vue';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuthenticatedSession } from '../auth/auth-context.js';
import { createIdempotencyKeyStore, createRequestApi } from './request-api.js';
import {
  requestOriginLabels,
  requestPurposeLabel,
  requestStatusLabel,
  requestTypeLabel,
  returnModeLabels,
} from './request-view-model.js';

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
const queueMode = shallowRef<'NORMAL' | 'PAPERWORK'>('NORMAL');
const status = shallowRef<NormalRequestAdminQueueStatus>('PENDING_APPROVAL');
const paperworkState = shallowRef<PaperworkQueueState>('REQUIRED');
const items = shallowRef<readonly RequestSummary[]>([]);
const selected = shallowRef<RequestDetail | null>(null);
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
    const response =
      queueMode.value === 'NORMAL'
        ? await api.adminQueue({ warehouse: warehouse.value, status: status.value })
        : await api.paperworkQueue({ warehouse: warehouse.value, state: paperworkState.value });
    if (loadId !== latestLoad) return;
    items.value = response.items;
  } catch (error: unknown) {
    if (loadId !== latestLoad) return;
    errorMessage.value = error instanceof Error ? error.message : '管理员队列读取失败';
  } finally {
    if (loadId === latestLoad) loading.value = false;
  }
};

watch([warehouse, queueMode, status, paperworkState], load, { immediate: true });

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
    const isTemporary = selected.value.origin === 'EXPRESS';
    await completeAction(
      decision === 'APPROVED'
        ? isTemporary
          ? '临时领用手续已审核通过'
          : '整单已批准并预占库存'
        : isTemporary
          ? '手续已退回补正'
          : '申请已整单退回',
    );
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
      <h1 id="admin-requests-title">领用审核与发放</h1>
      <div class="header-actions">
        <Button as-child>
          <RouterLink class="offline-link" to="/admin/requests/offline">
            <FilePlus2 :size="17" aria-hidden="true" />线下登记
          </RouterLink>
        </Button>
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
      </div>
    </header>

    <div v-if="managedWarehouses.length === 0" class="state" role="alert">没有可管理的仓库</div>
    <template v-else>
      <div class="filters" aria-label="队列筛选">
        <div class="filter-field">
          <Label for="admin-request-warehouse">仓库</Label>
          <Select v-model="warehouse" :disabled="loading || acting">
            <SelectTrigger id="admin-request-warehouse" class="warehouse-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="code in managedWarehouses" :key="code" :value="code">
                {{ code === 'XIHU' ? '西湖仓' : '余杭仓' }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="filter-groups">
          <div class="segments" role="group" aria-label="队列类型">
            <Button
              type="button"
              :variant="queueMode === 'NORMAL' ? 'default' : 'ghost'"
              :aria-pressed="queueMode === 'NORMAL'"
              :disabled="loading || acting"
              @click="queueMode = 'NORMAL'"
            >
              审核发放
            </Button>
            <Button
              type="button"
              :variant="queueMode === 'PAPERWORK' ? 'default' : 'ghost'"
              :aria-pressed="queueMode === 'PAPERWORK'"
              :disabled="loading || acting"
              @click="queueMode = 'PAPERWORK'"
            >
              补手续
            </Button>
          </div>

          <div v-if="queueMode === 'NORMAL'" class="segments" role="group" aria-label="申请状态">
            <Button
              type="button"
              :variant="status === 'PENDING_APPROVAL' ? 'default' : 'ghost'"
              :aria-pressed="status === 'PENDING_APPROVAL'"
              :disabled="loading || acting"
              @click="status = 'PENDING_APPROVAL'"
            >
              待审核
            </Button>
            <Button
              type="button"
              :variant="status === 'PENDING_RELEASE' ? 'default' : 'ghost'"
              :aria-pressed="status === 'PENDING_RELEASE'"
              :disabled="loading || acting"
              @click="status = 'PENDING_RELEASE'"
            >
              待发放
            </Button>
          </div>

          <div v-else class="segments three" role="group" aria-label="手续状态">
            <Button
              type="button"
              :variant="paperworkState === 'REQUIRED' ? 'default' : 'ghost'"
              :aria-pressed="paperworkState === 'REQUIRED'"
              :disabled="loading || acting"
              @click="paperworkState = 'REQUIRED'"
            >
              待补手续
            </Button>
            <Button
              type="button"
              :variant="paperworkState === 'CORRECTION' ? 'default' : 'ghost'"
              :aria-pressed="paperworkState === 'CORRECTION'"
              :disabled="loading || acting"
              @click="paperworkState = 'CORRECTION'"
            >
              待补正
            </Button>
            <Button
              type="button"
              :variant="paperworkState === 'OVERDUE' ? 'default' : 'ghost'"
              :aria-pressed="paperworkState === 'OVERDUE'"
              :disabled="loading || acting"
              @click="paperworkState = 'OVERDUE'"
            >
              已超期
            </Button>
          </div>
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
            <strong>{{ item.claimantName }} · {{ requestTypeLabel(item.type) }}</strong>
            <small
              >{{ requestOriginLabels[item.origin] }} · {{ item.totalQuantity }} 件 ·
              {{ requestPurposeLabel(item.purposeObject) }}</small
            >
            <small v-if="item.paperworkDueAt" :class="{ overdue: item.paperworkOverdue }">
              {{ new Date(item.paperworkDueAt).toLocaleString('zh-CN') }}
            </small>
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
              <strong :class="{ overdue: selected.paperworkOverdue }">{{
                requestStatusLabel(selected.status, selected.origin)
              }}</strong>
            </div>
            <dl class="detail-grid">
              <div>
                <dt>来源</dt>
                <dd>{{ requestOriginLabels[selected.origin] }}</dd>
              </div>
              <div>
                <dt>类型</dt>
                <dd>{{ requestTypeLabel(selected.type) }}</dd>
              </div>
              <div>
                <dt>归还</dt>
                <dd>{{ returnModeLabels[selected.returnMode] }}</dd>
              </div>
              <div>
                <dt>用途 / 对象</dt>
                <dd>{{ selected.purposeObject ?? '待补手续' }}</dd>
              </div>
              <div>
                <dt>最终去向</dt>
                <dd>{{ selected.finalDestination ?? '待补手续' }}</dd>
              </div>
              <div v-if="selected.paperworkDueAt">
                <dt>手续截止</dt>
                <dd :class="{ overdue: selected.paperworkOverdue }">
                  {{ new Date(selected.paperworkDueAt).toLocaleString('zh-CN') }}
                </dd>
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
              <div class="action-field">
                <Label for="review-comment">审核意见（退回时必填）</Label>
                <Textarea id="review-comment" v-model="comment" rows="3" maxlength="1000" />
              </div>
              <div class="button-row">
                <Button type="button" :disabled="acting" @click="review('APPROVED')">
                  <Check :size="17" aria-hidden="true" />{{
                    selected.origin === 'EXPRESS' ? '通过手续' : '批准并预占'
                  }}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  :disabled="acting || comment.trim().length === 0"
                  @click="review('REJECTED')"
                >
                  <RotateCcw :size="17" aria-hidden="true" />{{
                    selected.origin === 'EXPRESS' ? '退回补正' : '整单退回'
                  }}
                </Button>
              </div>
            </div>

            <div
              v-if="selected.allowedActions.fulfill || selected.allowedActions.adminCancel"
              class="action-panel"
            >
              <Button
                v-if="selected.allowedActions.fulfill"
                type="button"
                :disabled="acting"
                @click="fulfill"
              >
                <PackageCheck :size="17" aria-hidden="true" />确认整单发放
              </Button>
              <div v-if="selected.allowedActions.adminCancel" class="action-field">
                <Label for="admin-cancel-reason">管理员取消原因</Label>
                <Textarea
                  id="admin-cancel-reason"
                  v-model="cancelReason"
                  rows="2"
                  maxlength="1000"
                />
              </div>
              <Button
                v-if="selected.allowedActions.adminCancel"
                type="button"
                variant="destructive"
                :disabled="acting || cancelReason.trim().length === 0"
                @click="cancel"
              >
                <X :size="17" aria-hidden="true" />取消并释放预占
              </Button>
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
.header-actions,
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

.page-header h1,
.detail-heading h2 {
  margin: 0;
}

.page-header h1 {
  font-size: 1.4rem;
}

.header-actions {
  align-items: center;
  gap: 0.5rem;
}

.offline-link {
  min-height: 40px;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border: 1px solid #24694f;
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  color: #fff;
  background: #24694f;
  text-decoration: none;
  font-size: 0.84rem;
  font-weight: 800;
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

.filter-groups {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.filter-field,
.action-field {
  display: grid;
  gap: 0.35rem;
  color: #56635c;
  font-size: 0.78rem;
  font-weight: 800;
}

textarea {
  min-height: 40px;
  border: 1px solid #c8d0ca;
  border-radius: 6px;
  padding: 0.5rem 0.6rem;
  background: #ffffff;
  font: inherit;
}

.warehouse-select {
  width: 150px;
  min-height: 40px;
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

.segments.three {
  grid-template-columns: repeat(3, 1fr);
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

.overdue {
  color: #a23c2e !important;
  font-weight: 800;
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

.action-panel button[data-variant='destructive'] {
  border-color: #a54c39;
  color: #ffffff;
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

  .filter-groups {
    width: 100%;
    align-items: stretch;
    flex-direction: column;
  }

  .warehouse-select,
  .segments {
    width: 100%;
  }

  .page-header {
    align-items: flex-start;
  }
  .header-actions {
    flex-shrink: 0;
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
