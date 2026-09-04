import { warehouseEntriesResponseSchema } from '@glorychips/contracts';
import type { WarehouseEntriesResponse } from '@glorychips/contracts';
import { apiBaseUrl, parseApiResponse, type FetchFunction } from '../shared/api-client.js';

interface CreateWarehousesApiOptions {
  readonly baseUrl?: string;
  readonly fetchFunction?: FetchFunction;
}

export const createWarehousesApi = ({
  baseUrl = apiBaseUrl,
  fetchFunction = fetch,
}: CreateWarehousesApiOptions = {}) => ({
  async listEntries(): Promise<WarehouseEntriesResponse> {
    const response = await fetchFunction(new URL('/warehouses/entries', baseUrl), {
      credentials: 'include',
    });
    return parseApiResponse(response, warehouseEntriesResponseSchema);
  },

  qrDownloadUrl(qrCodePath: string): string {
    return new URL(qrCodePath, baseUrl).toString();
  },
});
