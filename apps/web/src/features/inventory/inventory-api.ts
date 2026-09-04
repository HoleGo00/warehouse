import { inventoryQueryResponseSchema } from '@glorychips/contracts';
import type { InventoryQuery, InventoryQueryResponse } from '@glorychips/contracts';
import { apiBaseUrl, parseApiResponse, type FetchFunction } from '../shared/api-client.js';

interface CreateInventoryApiOptions {
  readonly baseUrl?: string;
  readonly fetchFunction?: FetchFunction;
}

export const createInventoryApi = ({
  baseUrl = apiBaseUrl,
  fetchFunction = fetch,
}: CreateInventoryApiOptions = {}) => ({
  async query(query: InventoryQuery, signal?: AbortSignal): Promise<InventoryQueryResponse> {
    const url = new URL('/inventory', baseUrl);
    url.searchParams.set('warehouse', query.warehouse);
    if (query.category !== undefined) url.searchParams.set('category', query.category);
    const response = await fetchFunction(url, { credentials: 'include', signal });
    return parseApiResponse(response, inventoryQueryResponseSchema);
  },
});
