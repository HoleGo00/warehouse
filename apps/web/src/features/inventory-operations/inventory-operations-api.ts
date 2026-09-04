import {
  adminTaskListResponseSchema,
  departureTriggerResponseSchema,
  inventoryOperationResponseSchema,
  requestActionResponseSchema,
  returnQueueResponseSchema,
  workCalendarDaySchema,
  workCalendarDeleteResponseSchema,
  workCalendarListResponseSchema,
} from '@glorychips/contracts';
import type {
  AdminTaskListResponse,
  AdminTaskQuery,
  ConfirmReturn,
  CreateInbound,
  CreateStocktake,
  CreateTransfer,
  DepartureTrigger,
  InventoryOperationResponse,
  RequestActionResponse,
  ReturnQueueQuery,
  ReturnQueueResponse,
  WorkCalendarListResponse,
} from '@glorychips/contracts';
import { apiBaseUrl, parseApiResponse, type FetchFunction } from '../shared/api-client.js';

interface ApiOptions {
  readonly baseUrl?: string;
  readonly fetchFunction?: FetchFunction;
}

const mutation = (idempotencyKey: string): HeadersInit => ({
  'content-type': 'application/json',
  'idempotency-key': idempotencyKey,
});

export const createInventoryOperationsApi = ({
  baseUrl = apiBaseUrl,
  fetchFunction = fetch,
}: ApiOptions = {}) => ({
  async inbound(command: CreateInbound, key: string): Promise<InventoryOperationResponse> {
    const response = await fetchFunction(new URL('/admin/inventory/inbound', baseUrl), {
      method: 'POST',
      credentials: 'include',
      headers: mutation(key),
      body: JSON.stringify(command),
    });
    return parseApiResponse(response, inventoryOperationResponseSchema);
  },

  async transfer(command: CreateTransfer, key: string): Promise<InventoryOperationResponse> {
    const response = await fetchFunction(new URL('/admin/inventory/transfers', baseUrl), {
      method: 'POST',
      credentials: 'include',
      headers: mutation(key),
      body: JSON.stringify(command),
    });
    return parseApiResponse(response, inventoryOperationResponseSchema);
  },

  async stocktake(command: CreateStocktake, key: string): Promise<InventoryOperationResponse> {
    const response = await fetchFunction(new URL('/admin/inventory/stocktakes', baseUrl), {
      method: 'POST',
      credentials: 'include',
      headers: mutation(key),
      body: JSON.stringify(command),
    });
    return parseApiResponse(response, inventoryOperationResponseSchema);
  },

  async returns(query: ReturnQueueQuery): Promise<ReturnQueueResponse> {
    const url = new URL('/admin/returns', baseUrl);
    if (query.warehouse !== undefined) url.searchParams.set('warehouse', query.warehouse);
    if (query.status !== undefined) url.searchParams.set('status', query.status);
    const response = await fetchFunction(url, { credentials: 'include' });
    return parseApiResponse(response, returnQueueResponseSchema);
  },

  async confirmReturn(command: ConfirmReturn, key: string): Promise<RequestActionResponse> {
    const response = await fetchFunction(new URL('/admin/returns/confirm', baseUrl), {
      method: 'POST',
      credentials: 'include',
      headers: mutation(key),
      body: JSON.stringify(command),
    });
    return parseApiResponse(response, requestActionResponseSchema);
  },

  async triggerDeparture(command: DepartureTrigger, key: string): Promise<{ created: number }> {
    const response = await fetchFunction(new URL('/admin/returns/departure-trigger', baseUrl), {
      method: 'POST',
      credentials: 'include',
      headers: mutation(key),
      body: JSON.stringify(command),
    });
    return parseApiResponse(response, departureTriggerResponseSchema);
  },

  async tasks(query: AdminTaskQuery): Promise<AdminTaskListResponse> {
    const url = new URL('/admin/tasks', baseUrl);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, value);
    }
    const response = await fetchFunction(url, { credentials: 'include' });
    return parseApiResponse(response, adminTaskListResponseSchema);
  },

  async calendar(from: string, to: string): Promise<WorkCalendarListResponse> {
    const url = new URL('/admin/work-calendar', baseUrl);
    url.searchParams.set('from', from);
    url.searchParams.set('to', to);
    const response = await fetchFunction(url, { credentials: 'include' });
    return parseApiResponse(response, workCalendarListResponseSchema);
  },

  async upsertCalendar(
    date: string,
    command: { isWorkingDay: boolean; description?: string },
    key: string,
  ): Promise<ReturnType<typeof workCalendarDaySchema.parse>> {
    const response = await fetchFunction(new URL(`/admin/work-calendar/${date}`, baseUrl), {
      method: 'PUT',
      credentials: 'include',
      headers: mutation(key),
      body: JSON.stringify(command),
    });
    return parseApiResponse(response, workCalendarDaySchema);
  },

  async deleteCalendar(date: string, key: string): Promise<{ deleted: boolean }> {
    const response = await fetchFunction(new URL(`/admin/work-calendar/${date}`, baseUrl), {
      method: 'DELETE',
      credentials: 'include',
      headers: mutation(key),
    });
    return parseApiResponse(response, workCalendarDeleteResponseSchema);
  },
});
