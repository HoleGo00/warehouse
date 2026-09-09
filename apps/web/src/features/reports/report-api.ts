import {
  reportResponseSchema,
  reportCandidatesResponseSchema,
  exportJobListSchema,
  exportJobResponseSchema,
  staffResponseSchema,
  updateAccessResponseSchema,
  reportMovementsResponseSchema,
} from '@glorychips/contracts';
import type { ReportFilters, UpdateAccessRequest } from '@glorychips/contracts';
import { apiBaseUrl, parseApiResponse } from '../shared/api-client.js';
import type { FetchFunction, RuntimeSchema } from '../shared/api-client.js';

export function createReportApi({
  baseUrl = apiBaseUrl,
  fetchFunction = fetch,
}: { baseUrl?: string; fetchFunction?: FetchFunction } = {}) {
  const read = async <T>(
    path: string,
    schema: RuntimeSchema<T>,
    query: Record<string, unknown> = {},
    signal?: AbortSignal,
  ) => {
    const url = new URL(path, baseUrl);
    for (const [key, value] of Object.entries(query))
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    return parseApiResponse(await fetchFunction(url, { credentials: 'include', signal }), schema);
  };
  const write = async <T>(
    path: string,
    method: string,
    body: unknown,
    schema: RuntimeSchema<T>,
    key?: string,
  ) =>
    parseApiResponse(
      await fetchFunction(new URL(path, baseUrl), {
        method,
        credentials: 'include',
        headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
        body: JSON.stringify(body),
      }),
      schema,
    );
  return {
    query: (filters: ReportFilters, cursor?: string, signal?: AbortSignal) =>
      read('/admin/reports/requests', reportResponseSchema, { ...filters, cursor }, signal),
    claimants: (query: Record<string, unknown>, signal?: AbortSignal) =>
      read('/admin/reports/claimants', reportCandidatesResponseSchema, query, signal),
    exports: (cursor?: string, signal?: AbortSignal) =>
      read('/admin/exports', exportJobListSchema, { cursor }, signal),
    createExport: (filters: ReportFilters, key: string) =>
      write('/admin/exports', 'POST', filters, exportJobResponseSchema, key),
    staff: (query: Record<string, unknown>, signal?: AbortSignal) =>
      read('/access/users', staffResponseSchema, query, signal),
    updateAccess: (id: string, body: UpdateAccessRequest) =>
      write(`/access/users/${encodeURIComponent(id)}`, 'PUT', body, updateAccessResponseSchema),
    movements: (id: string, cursor?: string, signal?: AbortSignal) =>
      read(
        `/requests/${encodeURIComponent(id)}/movements`,
        reportMovementsResponseSchema,
        { cursor },
        signal,
      ),
    downloadUrl: (id: string) =>
      new URL(`/admin/exports/${encodeURIComponent(id)}/download`, baseUrl).href,
    async checkDownload(id: string) {
      const response = await fetchFunction(
        new URL(`/admin/exports/${encodeURIComponent(id)}/download`, baseUrl),
        { credentials: 'include' },
      );
      if (!response.ok) await parseApiResponse(response, exportJobResponseSchema);
      return response.blob();
    },
  };
}
export type ReportApi = ReturnType<typeof createReportApi>;
