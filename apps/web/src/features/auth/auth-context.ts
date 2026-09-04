import { inject } from 'vue';
import type { InjectionKey, Ref } from 'vue';
import type { AuthMeResponse } from '@glorychips/contracts';

export const authSessionKey: InjectionKey<Readonly<Ref<AuthMeResponse>>> = Symbol('auth-session');

export const useAuthenticatedSession = (): Readonly<Ref<AuthMeResponse>> => {
  const session = inject(authSessionKey);
  if (session === undefined) {
    throw new Error('Authenticated session context is unavailable.');
  }
  return session;
};
