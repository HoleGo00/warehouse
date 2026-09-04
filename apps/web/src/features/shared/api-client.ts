import { apiErrorResponseSchema } from '@glorychips/contracts';
import type { ApiErrorCode } from '@glorychips/contracts';

export type FetchFunction = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface RuntimeSchema<T> {
  parse(value: unknown): T;
}

export class ApiClientError extends Error {
  public constructor(
    public readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

export const parseApiResponse = async <T>(
  response: Response,
  schema: RuntimeSchema<T>,
): Promise<T> => {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiClientError('AUTH_UPSTREAM_UNAVAILABLE', '服务返回了无法识别的内容');
  }
  if (!response.ok) {
    const error = apiErrorResponseSchema.safeParse(payload);
    if (error.success) throw new ApiClientError(error.data.code, error.data.message);
    throw new ApiClientError('AUTH_UPSTREAM_UNAVAILABLE', '服务暂时不可用');
  }
  return schema.parse(payload);
};
