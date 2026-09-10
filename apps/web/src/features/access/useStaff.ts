import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue';
import type { Ref } from 'vue';
import type { AuthMeResponse, StaffRow, UpdateAccessRequest } from '@glorychips/contracts';
import { createReportApi } from '../reports/report-api.js';
import type { ReportApi } from '../reports/report-api.js';
import { ApiClientError } from '../shared/api-client.js';
export function useStaff(
  session: Readonly<Ref<AuthMeResponse>>,
  api: ReportApi = createReportApi(),
) {
  const denied = shallowRef(false);
  const allowed = computed(
    () => !denied.value && session.value.access.roles.includes('SYSTEM_ADMIN'),
  );
  const rows = ref<StaffRow[]>([]);
  const selected = ref<StaffRow | null>(null);
  const query = shallowRef('');
  const role = shallowRef('ALL');
  const status = shallowRef('ALL');
  const loading = shallowRef(false);
  const busy = shallowRef(false);
  const error = shallowRef('');
  const nextCursor = shallowRef<string | null>(null);
  let generation = 0;
  let controller: AbortController | undefined;
  function reject(e: unknown) {
    error.value = e instanceof Error ? e.message : '请求失败';
    if (
      e instanceof ApiClientError &&
      ['AUTH_REQUIRED', 'USER_INACTIVE', 'FORBIDDEN_ROLE'].includes(e.code)
    ) {
      denied.value = true;
      generation++;
      controller?.abort();
      rows.value = [];
      selected.value = null;
      loading.value = false;
      nextCursor.value = null;
    }
  }
  async function load(more = false) {
    if (!allowed.value) return;
    const version = ++generation;
    controller?.abort();
    controller = new AbortController();
    loading.value = true;
    error.value = '';
    try {
      const result = await api.staff(
        {
          query: query.value,
          role: role.value === 'ALL' ? undefined : role.value,
          status: status.value === 'ALL' ? undefined : status.value,
          cursor: more ? (nextCursor.value ?? undefined) : undefined,
        },
        controller.signal,
      );
      if (generation !== version) return;
      rows.value = more ? [...rows.value, ...result.items] : result.items;
      nextCursor.value = result.nextCursor;
    } catch (e) {
      if (generation === version) {
        rows.value = [];
        selected.value = null;
        reject(e);
      }
    } finally {
      if (generation === version) loading.value = false;
    }
  }
  async function save(command: UpdateAccessRequest) {
    if (!selected.value || busy.value || !allowed.value) return;
    const version = generation;
    busy.value = true;
    error.value = '';
    try {
      await api.updateAccess(selected.value.id, command);
      if (generation !== version) return;
      selected.value = null;
      await load();
    } catch (e) {
      if (generation === version) reject(e);
    } finally {
      busy.value = false;
    }
  }
  watch(
    () => JSON.stringify({ id: session.value.user.id, access: session.value.access }),
    () => {
      denied.value = false;
      generation++;
      controller?.abort();
      rows.value = [];
      selected.value = null;
      loading.value = false;
      if (allowed.value) void load();
    },
    { immediate: true },
  );
  onScopeDispose(() => {
    generation++;
    controller?.abort();
  });
  return {
    allowed,
    rows,
    selected,
    query,
    role,
    status,
    loading,
    busy,
    error,
    nextCursor,
    load,
    save,
  };
}
