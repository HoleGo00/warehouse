<script setup lang="ts">
import { computed } from 'vue';
import { useAuthSession } from './useAuthSession.js';

const {
  status,
  session,
  errorMessage,
  clientLoginAvailable,
  isSystemAdministrator,
  managedWarehouses,
  beginOAuth,
  beginClientLogin,
  restore,
  logout,
} = useAuthSession();

const roleLabels = computed(() =>
  (session.value?.access.roles ?? []).map((role) => {
    if (role === 'SYSTEM_ADMIN') return '系统管理员';
    if (role === 'WAREHOUSE_ADMIN') return '仓库管理员';
    return '普通领用人';
  }),
);

const warehouseLabels = computed(() =>
  managedWarehouses.value.map((warehouse) => (warehouse === 'XIHU' ? '西湖仓' : '余杭仓')),
);

const statusLabel = computed(() => {
  if (status.value === 'loading') return '正在恢复会话';
  if (status.value === 'client-login') return '正在连接飞书';
  if (status.value === 'signed-in') return '已登录';
  if (status.value === 'error') return '服务异常';
  return '未登录';
});
</script>

<template>
  <main class="workspace">
    <header class="topbar">
      <div>
        <p class="brand">GLORYCHIPS</p>
        <h1 class="title">仓储工作台</h1>
      </div>
      <span class="status-indicator" :data-state="status">{{ statusLabel }}</span>
    </header>

    <section v-if="status === 'loading' || status === 'client-login'" class="state-region">
      <span class="spinner" aria-hidden="true" />
      <p class="state-title">{{ statusLabel }}</p>
    </section>

    <section v-else-if="session !== null" class="account-region">
      <div class="identity-row">
        <!-- eslint-disable vue/html-self-closing -->
        <img
          v-if="session.user.avatarUrl"
          class="avatar"
          :src="session.user.avatarUrl"
          alt=""
          referrerpolicy="no-referrer"
        />
        <!-- eslint-enable vue/html-self-closing -->
        <span v-else class="avatar avatar-fallback" aria-hidden="true">
          {{ session.user.name.slice(0, 1) }}
        </span>
        <div class="identity-copy">
          <p class="identity-name">{{ session.user.name }}</p>
          <p class="identity-id">{{ session.user.feishuUserId }}</p>
        </div>
        <button class="secondary-button" type="button" @click="logout">退出登录</button>
      </div>

      <div class="access-grid">
        <section class="access-section" aria-labelledby="role-heading">
          <h2 id="role-heading" class="section-title">角色</h2>
          <div class="tag-row">
            <span v-for="role in roleLabels" :key="role" class="tag">{{ role }}</span>
          </div>
        </section>
        <section class="access-section" aria-labelledby="warehouse-heading">
          <h2 id="warehouse-heading" class="section-title">管理范围</h2>
          <div class="tag-row">
            <span v-if="isSystemAdministrator" class="tag tag-accent">全部仓库</span>
            <span v-else-if="warehouseLabels.length === 0" class="muted">无仓库管理权限</span>
            <template v-else>
              <span v-for="warehouse in warehouseLabels" :key="warehouse" class="tag tag-accent">
                {{ warehouse }}
              </span>
            </template>
          </div>
        </section>
      </div>
    </section>

    <section v-else class="login-region" aria-labelledby="login-heading">
      <div class="login-copy">
        <p class="section-kicker">公司账号</p>
        <h2 id="login-heading" class="login-title">使用飞书登录</h2>
        <p class="muted">仅限公司应用范围内的在职员工</p>
      </div>
      <div class="action-row">
        <button type="button" class="primary-button" @click="beginOAuth">飞书登录</button>
        <button
          v-if="clientLoginAvailable"
          type="button"
          class="secondary-button"
          @click="beginClientLogin"
        >
          客户端免登
        </button>
        <button v-if="status === 'error'" type="button" class="secondary-button" @click="restore">
          重试
        </button>
      </div>
    </section>

    <p v-if="errorMessage" class="error-message" role="alert">{{ errorMessage }}</p>
  </main>
</template>

<style scoped>
.workspace {
  width: min(960px, 100%);
  min-height: 520px;
  margin: 0 auto;
  padding: clamp(1.25rem, 4vw, 3rem);
}

.topbar,
.identity-row,
.action-row,
.tag-row {
  display: flex;
  align-items: center;
}

.topbar {
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 1.25rem;
  border-bottom: 1px solid #d8dcd8;
}

.brand,
.section-kicker {
  margin: 0 0 0.35rem;
  color: #a45330;
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0;
}

.title,
.login-title,
.section-title,
.identity-name,
.identity-id,
.muted,
.state-title,
.error-message {
  margin: 0;
}

.title {
  font-size: 1.5rem;
  line-height: 1.2;
}

.status-indicator {
  min-width: 5.5rem;
  padding: 0.4rem 0.65rem;
  border: 1px solid #c9cfca;
  border-radius: 6px;
  color: #4c5953;
  background: #f7f8f6;
  text-align: center;
  font-size: 0.8rem;
  font-weight: 700;
}

.status-indicator[data-state='signed-in'] {
  border-color: #9bc4ad;
  color: #1e6748;
  background: #edf7f0;
}

.status-indicator[data-state='error'] {
  border-color: #e0a28f;
  color: #9b3f2d;
  background: #fff2ed;
}

.state-region,
.login-region,
.account-region {
  margin-top: 2rem;
}

.state-region {
  min-height: 280px;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 1rem;
}

.spinner {
  width: 2rem;
  aspect-ratio: 1;
  border: 3px solid #cfd5d1;
  border-top-color: #206b51;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.login-region {
  display: flex;
  min-height: 300px;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
  padding: 2rem 0;
}

.login-title {
  font-size: clamp(1.8rem, 5vw, 3rem);
  line-height: 1.1;
}

.muted,
.identity-id {
  color: #647069;
  line-height: 1.6;
}

.login-copy .muted {
  margin-top: 0.8rem;
}

.action-row,
.tag-row {
  flex-wrap: wrap;
  gap: 0.65rem;
}

.primary-button,
.secondary-button {
  min-height: 42px;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 0.65rem 1rem;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.primary-button {
  color: #ffffff;
  background: #206b51;
}

.secondary-button {
  border-color: #c7cdc8;
  color: #29352f;
  background: #ffffff;
}

.primary-button:focus-visible,
.secondary-button:focus-visible {
  outline: 3px solid #e6b858;
  outline-offset: 2px;
}

.identity-row {
  gap: 1rem;
  padding: 1.25rem 0 1.75rem;
}

.identity-copy {
  min-width: 0;
  flex: 1;
}

.identity-name {
  font-size: 1.15rem;
  font-weight: 800;
}

.identity-id {
  overflow-wrap: anywhere;
  font-size: 0.8rem;
}

.avatar {
  width: 48px;
  height: 48px;
  flex: 0 0 48px;
  border-radius: 6px;
  object-fit: cover;
}

.avatar-fallback {
  display: grid;
  place-items: center;
  color: #ffffff;
  background: #a45330;
  font-weight: 800;
}

.access-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border-top: 1px solid #d8dcd8;
  border-bottom: 1px solid #d8dcd8;
}

.access-section {
  min-width: 0;
  padding: 1.5rem 0;
}

.access-section + .access-section {
  padding-left: 1.5rem;
  border-left: 1px solid #d8dcd8;
}

.section-title {
  margin-bottom: 0.8rem;
  font-size: 0.9rem;
}

.tag {
  padding: 0.35rem 0.55rem;
  border-radius: 4px;
  color: #34423b;
  background: #edf0ed;
  font-size: 0.8rem;
  font-weight: 700;
}

.tag-accent {
  color: #75430d;
  background: #fff0cf;
}

.error-message {
  margin-top: 1rem;
  padding: 0.8rem 1rem;
  border-left: 3px solid #b54c35;
  color: #8f3828;
  background: #fff2ed;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 640px) {
  .login-region {
    min-height: 260px;
    align-items: flex-start;
    flex-direction: column;
    justify-content: center;
  }

  .action-row,
  .primary-button,
  .secondary-button {
    width: 100%;
  }

  .access-grid {
    grid-template-columns: 1fr;
  }

  .access-section + .access-section {
    padding-left: 0;
    border-top: 1px solid #d8dcd8;
    border-left: 0;
  }

  .identity-row {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .identity-row .secondary-button {
    margin-left: 64px;
  }
}
</style>
