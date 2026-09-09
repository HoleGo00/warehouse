import { computed, onScopeDispose, shallowRef, watch } from 'vue';
import type { Ref } from 'vue';
import type {
  OutboxStatus,
  OutboxStepTarget,
  RetrySyncJob,
  SyncBindingsResponse,
  SyncJob,
  SyncReconciliationsResponse,
} from '@glorychips/contracts';
import { createSyncApi } from './sync-api.js';
import type { SyncApi } from './sync-api.js';
import { syncActionError } from './sync-view-model.js';

export type SyncView = 'jobs' | 'reconciliations' | 'bindings';
export function useSyncAdmin(allowed: Readonly<Ref<boolean>>, api: SyncApi = createSyncApi()) {
  const view = shallowRef<SyncView>('jobs');
  const target = shallowRef<'ALL' | OutboxStepTarget>('ALL');
  const status = shallowRef<'ALL' | OutboxStatus>('ALL');
  const jobs = shallowRef<SyncJob[]>([]);
  const reconciliations = shallowRef<SyncReconciliationsResponse['items']>([]);
  const bindings = shallowRef<SyncBindingsResponse['items']>([]);
  const detail = shallowRef<SyncJob | null>(null);
  const detailOpen = shallowRef(false);
  const detailLoading = shallowRef(false);
  const loading = shallowRef(false);
  const busy = shallowRef(false);
  const error = shallowRef<string | null>(null);
  const detailError = shallowRef<string | null>(null);
  const message = shallowRef<string | null>(null);
  let sequence = 0;
  let detailSequence = 0;
  let mutationSequence = 0;
  let controller: AbortController | undefined;
  let detailController: AbortController | undefined;
  let disposed = false;
  const keys = new Map<string, string>();
  const selectedTarget = computed(() => (target.value === 'ALL' ? undefined : target.value));
  const load = async () => {
    const current = ++sequence;
    controller?.abort();
    controller = new AbortController();
    error.value = null;
    jobs.value = [];
    reconciliations.value = [];
    bindings.value = [];
    if (disposed || !allowed.value) {
      loading.value = false;
      return;
    }
    loading.value = true;
    try {
      const filter = { target: selectedTarget.value };
      if (view.value === 'jobs') {
        const response = await api.jobs(
          { ...filter, ...(status.value === 'ALL' ? {} : { status: status.value }) },
          controller.signal,
        );
        if (current === sequence) jobs.value = response.items;
      } else if (view.value === 'reconciliations') {
        const response = await api.reconciliations(filter, controller.signal);
        if (current === sequence) reconciliations.value = response.items;
      } else {
        const response = await api.bindings(controller.signal);
        if (current === sequence)
          bindings.value = response.items.filter(
            (item) => !filter.target || item.target === filter.target,
          );
      }
    } catch (caught) {
      if (current === sequence) error.value = syncActionError(caught);
    } finally {
      if (current === sequence) loading.value = false;
    }
  };
  const openDetail = async (id: string) => {
    if (disposed || !allowed.value || busy.value) return;
    const current = ++detailSequence;
    detailController?.abort();
    detailController = new AbortController();
    detail.value = null;
    detailOpen.value = true;
    detailLoading.value = true;
    detailError.value = null;
    try {
      const response = await api.job(id, detailController.signal);
      if (current === detailSequence) detail.value = response.job;
    } catch (caught) {
      if (current === detailSequence) detailError.value = syncActionError(caught);
    } finally {
      if (current === detailSequence) detailLoading.value = false;
    }
  };
  const retry = async (command: RetrySyncJob) => {
    if (disposed || !allowed.value || busy.value || !detail.value?.canRetry) return;
    const current = ++mutationSequence;
    const id = detail.value.id;
    const fingerprint = JSON.stringify({ id, ...command });
    const key = keys.get(fingerprint) ?? crypto.randomUUID();
    keys.set(fingerprint, key);
    busy.value = true;
    detailError.value = null;
    try {
      const response = await api.retry(id, command, key);
      if (disposed || current !== mutationSequence) return;
      keys.delete(fingerprint);
      detail.value = response.job;
      detailOpen.value = false;
      message.value = '已提交重试';
      await load();
    } catch (caught) {
      if (!disposed && current === mutationSequence) detailError.value = syncActionError(caught);
    } finally {
      if (!disposed && current === mutationSequence) busy.value = false;
    }
  };
  const runReconciliation = async () => {
    if (disposed || !allowed.value || busy.value) return;
    const current = ++mutationSequence;
    const fingerprint = `reconcile:${target.value}`;
    const key = keys.get(fingerprint) ?? crypto.randomUUID();
    keys.set(fingerprint, key);
    busy.value = true;
    error.value = null;
    message.value = null;
    try {
      await api.runReconciliation({ target: selectedTarget.value }, key);
      if (disposed || current !== mutationSequence) return;
      keys.delete(fingerprint);
      message.value = '已提交对账任务';
      await load();
    } catch (caught) {
      if (!disposed && current === mutationSequence) error.value = syncActionError(caught);
    } finally {
      if (!disposed && current === mutationSequence) busy.value = false;
    }
  };
  watch(
    allowed,
    (value) => {
      if (value) return;
      sequence++;
      detailSequence++;
      mutationSequence++;
      controller?.abort();
      detailController?.abort();
      jobs.value = [];
      reconciliations.value = [];
      bindings.value = [];
      detail.value = null;
      detailOpen.value = false;
      detailLoading.value = false;
      loading.value = false;
      busy.value = false;
      error.value = null;
      detailError.value = null;
      message.value = null;
      keys.clear();
    },
    { flush: 'sync' },
  );
  watch(
    [view, target, status, allowed],
    () => {
      void load();
    },
    { immediate: true },
  );
  watch(detailOpen, (open) => {
    if (!open) {
      detailSequence++;
      detailController?.abort();
    }
  });
  onScopeDispose(() => {
    disposed = true;
    sequence++;
    detailSequence++;
    mutationSequence++;
    controller?.abort();
    detailController?.abort();
  });
  return {
    view,
    target,
    status,
    jobs,
    reconciliations,
    bindings,
    detail,
    detailOpen,
    detailLoading,
    loading,
    busy,
    error,
    detailError,
    message,
    load,
    openDetail,
    retry,
    runReconciliation,
  };
}
