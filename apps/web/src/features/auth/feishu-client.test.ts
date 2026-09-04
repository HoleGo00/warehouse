import { describe, expect, it } from 'vitest';
import {
  canUseFeishuClientLogin,
  isFeishuClientUserAgent,
  loadFeishuClientSdk,
  requestFeishuAccessCode,
  selectFeishuLoginMethod,
} from './feishu-client.js';

describe('Feishu client login bridge', () => {
  it('resolves a requestAccess authorization code', async () => {
    const code = requestFeishuAccessCode({
      appId: 'cli_0123456789abcdef',
      client: {
        requestAccess: (options) => options.success({ code: 'client-code' }),
      },
    });

    await expect(code).resolves.toBe('client-code');
  });

  it('reports requestAccess failure without hiding the OAuth fallback', async () => {
    const options = {
      appId: 'cli_0123456789abcdef',
      client: {
        requestAccess: (requestOptions: FeishuRequestAccessOptions) =>
          requestOptions.fail(new Error('denied')),
      },
    };
    expect(selectFeishuLoginMethod(options)).toBe('CLIENT');
    await expect(requestFeishuAccessCode(options)).rejects.toThrow('飞书客户端授权失败');
  });

  it('selects OAuth when requestAccess or the app id is unavailable', async () => {
    expect(canUseFeishuClientLogin({ client: {}, appId: 'cli_0123456789abcdef' })).toBe(false);
    expect(selectFeishuLoginMethod({ client: {}, appId: 'cli_local_visual_check' })).toBe('OAUTH');
    await expect(
      requestFeishuAccessCode({
        client: { requestAccess: () => undefined },
        appId: 'cli_local_visual_check',
      }),
    ).rejects.toThrow('当前环境不支持飞书客户端免登');
  });

  it('does not load the H5 SDK in ordinary browsers', async () => {
    const appended: unknown[] = [];
    const fakeDocument = {
      querySelector: () => null,
      createElement: () => ({
        addEventListener: () => undefined,
        dataset: {},
      }),
      head: { append: (value: unknown) => appended.push(value) },
    } as unknown as Document;

    expect(isFeishuClientUserAgent('Mozilla/5.0 Chrome/140.0')).toBe(false);
    expect(isFeishuClientUserAgent('Mozilla/5.0 Lark/7.30.0')).toBe(true);
    await expect(
      loadFeishuClientSdk({ document: fakeDocument, userAgent: 'Mozilla/5.0 Chrome/140.0' }),
    ).resolves.toBe(false);
    expect(appended).toHaveLength(0);
  });
});
