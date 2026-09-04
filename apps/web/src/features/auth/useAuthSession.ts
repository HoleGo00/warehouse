import { computed, onMounted, readonly, shallowRef } from 'vue';
import type { AuthMeResponse, WarehouseCode } from '@glorychips/contracts';
import { normalizeAuthReturnPath } from '@glorychips/contracts';
import { AuthApiError, createAuthApi } from './auth-api.js';
import {
  canUseFeishuClientLogin,
  loadFeishuClientSdk,
  requestFeishuAccessCode,
} from './feishu-client.js';

type AuthStatus = 'loading' | 'signed-out' | 'client-login' | 'signed-in' | 'error';

const api = createAuthApi({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000',
});

const currentReturnTo = (): string =>
  normalizeAuthReturnPath(`${window.location.pathname}${window.location.search}`);

export const useAuthSession = () => {
  const status = shallowRef<AuthStatus>('loading');
  const session = shallowRef<AuthMeResponse | null>(null);
  const errorMessage = shallowRef<string | null>(null);
  const clientLoginAvailable = shallowRef(false);

  const isSystemAdministrator = computed(
    () => session.value?.access.roles.includes('SYSTEM_ADMIN') ?? false,
  );
  const managedWarehouses = computed<readonly WarehouseCode[]>(
    () => session.value?.access.warehouses ?? [],
  );

  const beginOAuth = (): void => {
    window.location.assign(api.oauthStartUrl(currentReturnTo()));
  };

  const beginClientLogin = async (): Promise<void> => {
    status.value = 'client-login';
    errorMessage.value = null;
    try {
      const challenge = await api.createClientChallenge(currentReturnTo());
      const code = await requestFeishuAccessCode();
      const completed = await api.completeClientLogin(code, challenge.challenge);
      session.value = completed.session;
      status.value = 'signed-in';
      if (completed.returnTo !== currentReturnTo()) {
        window.location.assign(completed.returnTo);
      }
    } catch (error: unknown) {
      status.value = 'signed-out';
      errorMessage.value = error instanceof Error ? error.message : '飞书客户端登录失败';
    }
  };

  const restore = async (): Promise<void> => {
    status.value = 'loading';
    errorMessage.value = null;
    try {
      session.value = await api.getMe();
      status.value = 'signed-in';
    } catch (error: unknown) {
      session.value = null;
      if (error instanceof AuthApiError && error.code === 'AUTH_REQUIRED') {
        status.value = 'signed-out';
        if (clientLoginAvailable.value) await beginClientLogin();
        return;
      }
      status.value = 'error';
      errorMessage.value = error instanceof Error ? error.message : '会话恢复失败';
    }
  };

  const logout = async (): Promise<void> => {
    status.value = 'loading';
    errorMessage.value = null;
    try {
      await api.logout();
      session.value = null;
      status.value = 'signed-out';
    } catch (error: unknown) {
      status.value = 'error';
      errorMessage.value = error instanceof Error ? error.message : '注销失败';
    }
  };

  onMounted(async () => {
    try {
      clientLoginAvailable.value = await loadFeishuClientSdk();
    } catch {
      clientLoginAvailable.value = canUseFeishuClientLogin();
    }
    await restore();
  });

  return {
    status: readonly(status),
    session: readonly(session),
    errorMessage: readonly(errorMessage),
    clientLoginAvailable: readonly(clientLoginAvailable),
    isSystemAdministrator,
    managedWarehouses,
    beginOAuth,
    beginClientLogin,
    restore,
    logout,
  };
};
