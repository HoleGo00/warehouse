import {
  migrationBatchesResponseSchema,
  runSyncReconciliationResponseSchema,
  syncBindingsResponseSchema,
  syncJobResponseSchema,
  syncJobsResponseSchema,
  syncReconciliationsResponseSchema,
} from '@glorychips/contracts';
import type {
  RetrySyncJob,
  RunSyncReconciliation,
  SyncJobsQuery,
  SyncReconciliationsQuery,
} from '@glorychips/contracts';
import { apiBaseUrl, parseApiResponse } from '../shared/api-client.js';
import type { FetchFunction, RuntimeSchema } from '../shared/api-client.js';

export function createSyncApi({
  baseUrl = apiBaseUrl,
  fetchFunction = fetch,
}: {
  baseUrl?: string;
  fetchFunction?: FetchFunction;
} = {}) {
  const read = async <T>(
    path: string,
    schema: RuntimeSchema<T>,
    query: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<T> => {
    const url = new URL(path, baseUrl);
    for (const [key, value] of Object.entries(query))
      if (value !== undefined) url.searchParams.set(key, String(value));
    return parseApiResponse(await fetchFunction(url, { credentials: 'include', signal }), schema);
  };
  const write = async <T>(
    path: string,
    command: unknown,
    key: string,
    schema: RuntimeSchema<T>,
  ): Promise<T> =>
    parseApiResponse(
      await fetchFunction(new URL(path, baseUrl), {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'idempotency-key': key },
        body: JSON.stringify(command),
      }),
      schema,
    );
  return {
    jobs: (query: Partial<SyncJobsQuery>, signal?: AbortSignal) =>
      read('/admin/sync/jobs', syncJobsResponseSchema, query, signal),
    job: (id: string, signal?: AbortSignal) =>
      read(`/admin/sync/jobs/${encodeURIComponent(id)}`, syncJobResponseSchema, {}, signal),
    retry: (id: string, command: RetrySyncJob, key: string) =>
      write(
        `/admin/sync/jobs/${encodeURIComponent(id)}/retry`,
        command,
        key,
        syncJobResponseSchema,
      ),
    reconciliations: (query: Partial<SyncReconciliationsQuery>, signal?: AbortSignal) =>
      read('/admin/sync/reconciliations', syncReconciliationsResponseSchema, query, signal),
    runReconciliation: (command: RunSyncReconciliation, key: string) =>
      write('/admin/sync/reconciliations/run', command, key, runSyncReconciliationResponseSchema),
    bindings: (signal?: AbortSignal) =>
      read('/admin/sync/bindings', syncBindingsResponseSchema, {}, signal),
    migrations: (signal?: AbortSignal) =>
      read('/admin/migrations', migrationBatchesResponseSchema, {}, signal),
  };
}
export type SyncApi = ReturnType<typeof createSyncApi>;
