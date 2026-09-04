import { catalogListResponseSchema, catalogProductResponseSchema } from '@glorychips/contracts';
import type {
  CatalogListResponse,
  CatalogProductMutationResponse,
  CreateCatalogProductRequest,
  UpdateCatalogProductRequest,
} from '@glorychips/contracts';
import { apiBaseUrl, parseApiResponse, type FetchFunction } from '../shared/api-client.js';

interface CreateCatalogApiOptions {
  readonly baseUrl?: string;
  readonly fetchFunction?: FetchFunction;
}

export const createCatalogApi = ({
  baseUrl = apiBaseUrl,
  fetchFunction = fetch,
}: CreateCatalogApiOptions = {}) => ({
  async list(): Promise<CatalogListResponse> {
    const response = await fetchFunction(new URL('/catalog', baseUrl), {
      credentials: 'include',
    });
    return parseApiResponse(response, catalogListResponseSchema);
  },

  async create(command: CreateCatalogProductRequest): Promise<CatalogProductMutationResponse> {
    const response = await fetchFunction(new URL('/catalog', baseUrl), {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(command),
    });
    return parseApiResponse(response, catalogProductResponseSchema);
  },

  async update(
    productId: string,
    command: UpdateCatalogProductRequest,
  ): Promise<CatalogProductMutationResponse> {
    const response = await fetchFunction(new URL(`/catalog/${productId}`, baseUrl), {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(command),
    });
    return parseApiResponse(response, catalogProductResponseSchema);
  },
});
