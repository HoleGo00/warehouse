import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue';
import type { Ref } from 'vue';
import { reportFiltersSchema } from '@glorychips/contracts';
import type { AuthMeResponse, ExportJob, ReportFilters, ReportRow } from '@glorychips/contracts';
import { ApiClientError } from '../shared/api-client.js';
import { createReportApi } from './report-api.js';
import type { ReportApi } from './report-api.js';

const navigation = new WeakMap<
  Readonly<Ref<AuthMeResponse>>,
  {
    identity: string;
    filters: ReportFilters;
    pages: (string | undefined)[];
    page: number;
  }
>();
export function useReports(
  session: Readonly<Ref<AuthMeResponse>>,
  api: ReportApi = createReportApi(),
) {
  const denied = shallowRef(false);
  const identity = () =>
    JSON.stringify({
      id: session.value.user.id,
      access: session.value.access,
      expiresAt: session.value.expiresAt,
    });
  const saved = navigation.get(session);
  const restored = saved?.identity === identity() ? saved : undefined;
  const allowed = computed(
    () =>
      !denied.value &&
      session.value.access.roles.some((r) => ['SYSTEM_ADMIN', 'WAREHOUSE_ADMIN'].includes(r)),
  );
  const rows = ref<ReportRow[]>([]);
  const jobs = ref<ExportJob[]>([]);
  const filters = ref<ReportFilters>(restored?.filters ?? { dateMode: 'SUBMITTED' });
  const loading = shallowRef(false);
  const busy = shallowRef(false);
  const error = shallowRef('');
  const message = shallowRef('');
  const nextCursor = shallowRef<string | null>(null);
  const jobNext = shallowRef<string | null>(null);
  const pages = ref<(string | undefined)[]>(restored?.pages ?? [undefined]);
  const page = shallowRef(restored?.page ?? 0);
  let generation = 0;
  let controller: AbortController | undefined;
  let key: string | undefined;
  let disposed = false;
  let jobsLoading = false;
  const reject = (e: unknown) => {
    error.value = e instanceof Error ? e.message : '请求失败';
    if (
      e instanceof ApiClientError &&
      ['AUTH_REQUIRED', 'USER_INACTIVE', 'FORBIDDEN_ROLE', 'FORBIDDEN_WAREHOUSE'].includes(e.code)
    ) {
      denied.value = true;
      rows.value = [];
      jobs.value = [];
      generation++;
      controller?.abort();
      loading.value = false;
      nextCursor.value = null;
      jobNext.value = null;
      filters.value = { dateMode: 'SUBMITTED' };
      navigation.delete(session);
    }
  };
  async function load() {
    if (!allowed.value || disposed) return;
    const version = ++generation;
    controller?.abort();
    controller = new AbortController();
    rows.value = [];
    nextCursor.value = null;
    loading.value = true;
    error.value = '';
    try {
      const result = await api.query(filters.value, pages.value[page.value], controller.signal);
      if (version === generation) {
        rows.value = result.items;
        nextCursor.value = result.nextCursor;
      }
    } catch (e) {
      if (version === generation) reject(e);
    } finally {
      if (version === generation) loading.value = false;
    }
  }
  async function loadJobs(more = false) {
    if (!allowed.value || disposed || jobsLoading || (more && !jobNext.value)) return;
    jobsLoading = true;
    const version = generation;
    try {
      const target = more ? 1 : Math.max(1, jobs.value.length);
      const refreshed: ExportJob[] = [];
      let cursor = more ? (jobNext.value ?? undefined) : undefined;
      do {
        const result = await api.exports(cursor, controller?.signal);
        refreshed.push(...result.items);
        cursor = result.nextCursor ?? undefined;
      } while (!more && cursor && refreshed.length < target && version === generation && !disposed);
      if (version === generation && !disposed) {
        jobs.value = [
          ...new Map(
            (more ? [...jobs.value, ...refreshed] : refreshed).map((job) => [job.id, job]),
          ).values(),
        ];
        jobNext.value = cursor ?? null;
      }
    } catch (e) {
      if (version === generation && !disposed) reject(e);
    } finally {
      jobsLoading = false;
    }
  }
  async function search(raw: unknown) {
    const parsed = reportFiltersSchema.safeParse(raw);
    if (!parsed.success) {
      error.value = parsed.error.issues[0]?.message ?? '筛选无效';
      return;
    }
    filters.value = parsed.data;
    pages.value = [undefined];
    page.value = 0;
    key = undefined;
    await load();
    await loadJobs();
  }
  async function next() {
    if (!nextCursor.value) return;
    pages.value[page.value + 1] = nextCursor.value;
    page.value++;
    await load();
  }
  async function previous() {
    if (page.value) {
      page.value--;
      await load();
    }
  }
  async function createExport() {
    if (busy.value || !allowed.value) return;
    busy.value = true;
    error.value = '';
    const version = generation;
    key ??= crypto.randomUUID();
    try {
      await api.createExport(filters.value, key);
      if (version !== generation || disposed) return;
      key = undefined;
      message.value = '导出已加入队列';
      await loadJobs();
    } catch (e) {
      if (version === generation) reject(e);
    } finally {
      busy.value = false;
    }
  }
  async function download(id: string) {
    if (!allowed.value || busy.value) return;
    busy.value = true;
    const version = generation;
    try {
      const blob = await api.checkDownload(id);
      if (version !== generation || disposed) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `warehouse-${id}.xlsx`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) {
      if (version === generation) reject(e);
    } finally {
      busy.value = false;
    }
  }
  watch(
    identity,
    (_current, previous) => {
      denied.value = false;
      generation++;
      controller?.abort();
      rows.value = [];
      jobs.value = [];
      key = undefined;
      loading.value = false;
      busy.value = false;
      if (previous !== undefined) {
        pages.value = [undefined];
        page.value = 0;
        filters.value = { dateMode: 'SUBMITTED' };
        navigation.delete(session);
      }
      if (allowed.value) void load().then(() => loadJobs());
    },
    { immediate: true },
  );
  const interval = setInterval(() => {
    void loadJobs();
  }, 5000);
  onScopeDispose(() => {
    if (allowed.value)
      navigation.set(session, {
        identity: identity(),
        filters: { ...filters.value },
        pages: [...pages.value],
        page: page.value,
      });
    disposed = true;
    generation++;
    controller?.abort();
    clearInterval(interval);
  });
  return {
    allowed,
    rows,
    jobs,
    filters,
    loading,
    busy,
    error,
    message,
    nextCursor,
    jobNext,
    page,
    load,
    loadJobs,
    search,
    next,
    previous,
    createExport,
    download,
  };
}
