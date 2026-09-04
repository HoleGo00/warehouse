import {
  authErrorResponseSchema,
  authMeResponseSchema,
  clientLoginChallengeResponseSchema,
  clientLoginResponseSchema,
  normalizeAuthReturnPath,
} from '@glorychips/contracts';
import type {
  AuthErrorCode,
  AuthMeResponse,
  ClientLoginChallengeResponse,
  ClientLoginResponse,
} from '@glorychips/contracts';

type FetchFunction = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class AuthApiError extends Error {
  public constructor(
    public readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AuthApiError';
  }
}

interface CreateAuthApiOptions {
  readonly baseUrl: string;
  readonly fetchFunction?: FetchFunction;
}

const parseResponse = async <T>(response: Response, parse: (value: unknown) => T): Promise<T> => {
  const payload: unknown = await response.json();
  if (!response.ok) {
    const error = authErrorResponseSchema.safeParse(payload);
    if (error.success) throw new AuthApiError(error.data.code, error.data.message);
    throw new AuthApiError('AUTH_UPSTREAM_UNAVAILABLE', '服务暂时不可用');
  }
  return parse(payload);
};

export const createAuthApi = ({ baseUrl, fetchFunction = fetch }: CreateAuthApiOptions) => ({
  oauthStartUrl(rawReturnTo: unknown): string {
    const url = new URL('/auth/feishu/oauth/start', baseUrl);
    url.searchParams.set('returnTo', normalizeAuthReturnPath(rawReturnTo));
    return url.toString();
  },

  async getMe(): Promise<AuthMeResponse> {
    const response = await fetchFunction(new URL('/auth/me', baseUrl), {
      credentials: 'include',
    });
    return parseResponse(response, (payload) => authMeResponseSchema.parse(payload));
  },

  async createClientChallenge(rawReturnTo: unknown): Promise<ClientLoginChallengeResponse> {
    const response = await fetchFunction(new URL('/auth/feishu/client/challenge', baseUrl), {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ returnTo: normalizeAuthReturnPath(rawReturnTo) }),
    });
    return parseResponse(response, (payload) => clientLoginChallengeResponseSchema.parse(payload));
  },

  async completeClientLogin(code: string, challenge: string): Promise<ClientLoginResponse> {
    const response = await fetchFunction(new URL('/auth/feishu/client/login', baseUrl), {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, challenge }),
    });
    return parseResponse(response, (payload) => clientLoginResponseSchema.parse(payload));
  },

  async logout(): Promise<void> {
    const response = await fetchFunction(new URL('/auth/logout', baseUrl), {
      method: 'POST',
      credentials: 'include',
    });
    if (!response.ok) {
      await parseResponse(response, () => undefined);
    }
  },
});
