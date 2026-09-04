<script setup lang="ts">
import type { AuthMeResponse } from '@glorychips/contracts';
import { LogIn, RefreshCw, Warehouse } from '@lucide/vue';
import { useAuthSession } from './useAuthSession.js';

defineSlots<{
  default(props: { session: AuthMeResponse; logout: () => Promise<void> }): unknown;
}>();

const {
  status,
  session,
  errorMessage,
  clientLoginAvailable,
  beginOAuth,
  beginClientLogin,
  restore,
  logout,
} = useAuthSession();
</script>

<template>
  <slot v-if="session !== null" :session="session" :logout="logout" />

  <main v-else class="auth-page">
    <section class="auth-panel" aria-labelledby="auth-title">
      <div class="brand-mark" aria-hidden="true">
        <Warehouse :size="30" />
      </div>
      <p class="brand">GLORYCHIPS</p>
      <h1 id="auth-title" class="auth-title">仓储工作台</h1>

      <div
        v-if="status === 'loading' || status === 'client-login'"
        class="state-region"
        role="status"
      >
        <span class="spinner" aria-hidden="true" />
        <p>{{ status === 'client-login' ? '正在连接飞书' : '正在恢复会话' }}</p>
      </div>

      <div v-else class="login-region">
        <p class="login-copy">使用公司飞书账号登录，仅限应用可用范围内的在职员工。</p>
        <button class="primary-button" type="button" @click="beginOAuth">
          <LogIn :size="18" aria-hidden="true" />
          飞书登录
        </button>
        <button
          v-if="clientLoginAvailable"
          class="secondary-button"
          type="button"
          @click="beginClientLogin"
        >
          客户端免登
        </button>
        <button v-if="status === 'error'" class="secondary-button" type="button" @click="restore">
          <RefreshCw :size="17" aria-hidden="true" />
          重试
        </button>
      </div>

      <p v-if="errorMessage" class="error-message" role="alert">{{ errorMessage }}</p>
    </section>
  </main>
</template>

<style scoped>
.auth-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: #eef2ee;
}

.auth-panel {
  width: min(420px, 100%);
  padding: 2.5rem;
  border: 1px solid #d6ddd7;
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 18px 50px rgb(33 51 42 / 8%);
  text-align: center;
}

.brand-mark {
  width: 54px;
  height: 54px;
  display: grid;
  margin: 0 auto 1rem;
  place-items: center;
  border-radius: 8px;
  color: #ffffff;
  background: #1f694e;
}

.brand,
.auth-title,
.login-copy,
.state-region p,
.error-message {
  margin: 0;
}

.brand {
  color: #9a512f;
  font-size: 0.75rem;
  font-weight: 800;
}

.auth-title {
  margin-top: 0.35rem;
  color: #24312b;
  font-size: 1.65rem;
}

.state-region,
.login-region {
  min-height: 180px;
  display: grid;
  align-content: center;
  justify-items: stretch;
  gap: 0.75rem;
}

.state-region {
  justify-items: center;
  color: #66736d;
}

.spinner {
  width: 30px;
  aspect-ratio: 1;
  border: 3px solid #dce2dd;
  border-top-color: #1f694e;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.login-copy {
  margin-bottom: 0.4rem;
  color: #68756e;
  font-size: 0.9rem;
  line-height: 1.65;
}

.primary-button,
.secondary-button {
  min-height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 0.65rem 1rem;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.primary-button {
  color: #ffffff;
  background: #1f694e;
}

.secondary-button {
  border-color: #cfd7d1;
  color: #35433c;
  background: #ffffff;
}

.error-message {
  padding: 0.75rem;
  border-left: 3px solid #b64d37;
  color: #943c2a;
  background: #fff2ee;
  text-align: left;
  font-size: 0.85rem;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 480px) {
  .auth-panel {
    padding: 2rem 1.25rem;
  }
}
</style>
