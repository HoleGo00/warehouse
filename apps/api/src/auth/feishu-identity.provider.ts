import { z } from 'zod';
import type { AuthLoginKind } from '@glorychips/contracts';
import { AuthDomainError } from '@glorychips/database';
import type { FeishuIdentity } from '@glorychips/database';

export interface FeishuIdentityProvider {
  createAuthorizationUrl(state: string): string;
  resolveAuthorizationCode(kind: AuthLoginKind, code: string): Promise<FeishuIdentity>;
}

interface ProviderConfig {
  readonly appId: string;
  readonly appSecret: string;
  readonly redirectUri: string;
}

type FetchFunction = (input: string | URL, init?: RequestInit) => Promise<Response>;

const oauthTokenSchema = z.union([
  z.object({ access_token: z.string().min(1) }),
  z.object({
    code: z.literal(0),
    data: z.object({ access_token: z.string().min(1) }),
  }),
]);

const appAccessTokenSchema = z.object({
  code: z.literal(0),
  app_access_token: z.string().min(1),
});

const feishuErrorSchema = z.object({ code: z.number() });

const FEISHU_USER_OUTSIDE_APP_SCOPE = 20_010;

const userInfoSchema = z.object({
  code: z.literal(0),
  data: z.object({
    tenant_key: z.string().min(1),
    open_id: z.string().min(1),
    union_id: z.string().min(1).optional(),
    name: z.string().min(1),
    avatar_url: z.url().optional(),
  }),
});

const contactUserSchema = z.object({
  code: z.literal(0),
  data: z.object({
    user: z.object({
      user_id: z.string().min(1),
      department_ids: z.array(z.string()).optional(),
      status: z.object({
        is_frozen: z.boolean(),
        is_resigned: z.boolean(),
        is_activated: z.boolean(),
        is_unjoin: z.boolean(),
      }),
    }),
  }),
});

const readAccessToken = (payload: z.infer<typeof oauthTokenSchema>): string =>
  'access_token' in payload ? payload.access_token : payload.data.access_token;

export class HttpFeishuIdentityProvider implements FeishuIdentityProvider {
  public constructor(
    private readonly config: ProviderConfig,
    private readonly fetchFunction: FetchFunction = fetch,
  ) {}

  public createAuthorizationUrl(state: string): string {
    const url = new URL('https://accounts.feishu.cn/open-apis/authen/v1/authorize');
    url.searchParams.set('app_id', this.config.appId);
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('state', state);
    return url.toString();
  }

  public async resolveAuthorizationCode(
    kind: AuthLoginKind,
    code: string,
  ): Promise<FeishuIdentity> {
    try {
      const accessToken = await this.exchangeAuthorizationCode(kind, code);

      const userInfoResponse = await this.fetchFunction(
        'https://open.feishu.cn/open-apis/authen/v1/user_info',
        { headers: { authorization: `Bearer ${accessToken}` } },
      );
      if (!userInfoResponse.ok) throw new Error('Feishu user endpoint rejected the request.');
      const userInfoPayload: unknown = await userInfoResponse.json();
      const userInfo = userInfoSchema.parse(userInfoPayload).data;

      const contactResponse = await this.fetchFunction(
        `https://open.feishu.cn/open-apis/contact/v3/users/${encodeURIComponent(userInfo.open_id)}?user_id_type=open_id&department_id_type=open_department_id`,
        { headers: { authorization: `Bearer ${accessToken}` } },
      );
      if (!contactResponse.ok) throw new Error('Feishu contact endpoint rejected the request.');
      const contactPayload: unknown = await contactResponse.json();
      const contactUser = contactUserSchema.parse(contactPayload).data.user;
      const status = contactUser.status;
      const isActive =
        status.is_activated && !status.is_frozen && !status.is_resigned && !status.is_unjoin;
      return {
        ...this.toIdentity(userInfo, contactUser.user_id, isActive),
        departments: contactUser.department_ids,
      };
    } catch (error: unknown) {
      if (error instanceof AuthDomainError) throw error;
      throw new AuthDomainError(
        'AUTH_UPSTREAM_UNAVAILABLE',
        'Feishu identity verification failed.',
      );
    }
  }

  private async exchangeAuthorizationCode(kind: AuthLoginKind, code: string): Promise<string> {
    if (kind === 'CLIENT_CHALLENGE') {
      const appTokenResponse = await this.fetchFunction(
        'https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ app_id: this.config.appId, app_secret: this.config.appSecret }),
        },
      );
      if (!appTokenResponse.ok) {
        throw new Error('Feishu app token endpoint rejected the request.');
      }
      const appTokenPayload: unknown = await appTokenResponse.json();
      const appAccessToken = appAccessTokenSchema.parse(appTokenPayload).app_access_token;
      const userTokenResponse = await this.fetchFunction(
        'https://open.feishu.cn/open-apis/authen/v1/access_token',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${appAccessToken}`,
            'content-type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify({ grant_type: 'authorization_code', code }),
        },
      );
      return this.readUserAccessToken(userTokenResponse);
    }

    const tokenResponse = await this.fetchFunction(
      'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          grant_type: 'authorization_code',
          client_id: this.config.appId,
          client_secret: this.config.appSecret,
          code,
          redirect_uri: this.config.redirectUri,
        }),
      },
    );
    return this.readUserAccessToken(tokenResponse);
  }

  private async readUserAccessToken(response: Response): Promise<string> {
    const payload: unknown = await response.json();
    const tokenError = feishuErrorSchema.safeParse(payload);
    if (tokenError.success && tokenError.data.code === FEISHU_USER_OUTSIDE_APP_SCOPE) {
      throw new AuthDomainError(
        'FEISHU_APP_SCOPE_FORBIDDEN',
        'The user is outside the application scope.',
      );
    }
    if (!response.ok) throw new Error('Feishu token endpoint rejected the request.');
    return readAccessToken(oauthTokenSchema.parse(payload));
  }

  private toIdentity(
    userInfo: z.infer<typeof userInfoSchema>['data'],
    userId: string,
    isActive: boolean,
  ): FeishuIdentity {
    return {
      tenantKey: userInfo.tenant_key,
      userId,
      openId: userInfo.open_id,
      unionId: userInfo.union_id,
      name: userInfo.name,
      avatarUrl: userInfo.avatar_url,
      isInAppScope: true,
      isActive,
    };
  }
}
