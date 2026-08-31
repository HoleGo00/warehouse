import { isFeishuAppId } from '@glorychips/contracts';

interface FeishuClientApi {
  readonly requestAccess?: (options: FeishuRequestAccessOptions) => void;
}

interface FeishuClientOptions {
  readonly client?: FeishuClientApi;
  readonly appId?: string;
}

interface FeishuSdkLoaderOptions {
  readonly document?: Document;
  readonly userAgent?: string;
}

const FEISHU_SDK_URL = 'https://lf1-cdn-tos.bytegoofy.com/goofy/lark/op/h5-js-sdk-1.5.26.js';
const FEISHU_CLIENT_USER_AGENT = /(?:Feishu|Lark)\//i;

const defaultOptions = (): FeishuClientOptions => ({
  client: typeof window === 'undefined' ? undefined : window.tt,
  appId: import.meta.env.VITE_FEISHU_APP_ID,
});

export const canUseFeishuClientLogin = (options: FeishuClientOptions = defaultOptions()): boolean =>
  options.client?.requestAccess !== undefined && isFeishuAppId(options.appId);

export const selectFeishuLoginMethod = (
  options: FeishuClientOptions = defaultOptions(),
): 'CLIENT' | 'OAUTH' => (canUseFeishuClientLogin(options) ? 'CLIENT' : 'OAUTH');

export const isFeishuClientUserAgent = (userAgent: string): boolean =>
  FEISHU_CLIENT_USER_AGENT.test(userAgent);

export const loadFeishuClientSdk = async (
  options: FeishuSdkLoaderOptions = {},
): Promise<boolean> => {
  const documentObject =
    options.document ?? (typeof document === 'undefined' ? undefined : document);
  const userAgent =
    options.userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent);
  if (documentObject === undefined || !isFeishuClientUserAgent(userAgent)) return false;
  if (typeof window !== 'undefined' && window.tt?.requestAccess !== undefined) return true;

  const existing = documentObject.querySelector<HTMLScriptElement>(
    `script[data-feishu-h5-sdk="1.5.26"]`,
  );
  if (existing !== null) {
    await new Promise<void>((resolve, reject) => {
      if (typeof window !== 'undefined' && window.tt?.requestAccess !== undefined) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('飞书客户端组件加载失败')), {
        once: true,
      });
    });
    return typeof window !== 'undefined' && window.tt?.requestAccess !== undefined;
  }

  const script = documentObject.createElement('script');
  script.src = FEISHU_SDK_URL;
  script.async = true;
  script.dataset.feishuH5Sdk = '1.5.26';
  await new Promise<void>((resolve, reject) => {
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('飞书客户端组件加载失败')), {
      once: true,
    });
    documentObject.head.append(script);
  });
  return typeof window !== 'undefined' && window.tt?.requestAccess !== undefined;
};

export const requestFeishuAccessCode = async (
  options: FeishuClientOptions = defaultOptions(),
): Promise<string> =>
  new Promise((resolve, reject) => {
    const requestAccess = options.client?.requestAccess;
    if (requestAccess === undefined || !isFeishuAppId(options.appId)) {
      reject(new Error('当前环境不支持飞书客户端免登'));
      return;
    }
    requestAccess({
      appID: options.appId,
      success: (result) => resolve(result.code),
      fail: () => reject(new Error('飞书客户端授权失败')),
    });
  });
