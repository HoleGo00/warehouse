<script setup lang="ts">
import { computed, provide, toRef } from 'vue';
import type { AuthMeResponse } from '@glorychips/contracts';
import {
  ArrowRightLeft,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  FilePlus2,
  ListChecks,
  LogOut,
  PackageSearch,
  PackagePlus,
  ScanLine,
  Settings,
  Warehouse,
} from '@lucide/vue';
import { authSessionKey } from './features/auth/auth-context.js';

const props = defineProps<{
  session: AuthMeResponse;
  logout: () => Promise<void>;
}>();

provide(authSessionKey, toRef(props, 'session'));

const isSystemAdministrator = computed(() => props.session.access.roles.includes('SYSTEM_ADMIN'));
const isWarehouseAdministrator = computed(
  () => isSystemAdministrator.value || props.session.access.roles.includes('WAREHOUSE_ADMIN'),
);
const accountRoleLabel = computed(() => {
  if (isSystemAdministrator.value) return '系统管理员';
  if (props.session.access.roles.includes('WAREHOUSE_ADMIN')) return '仓库管理员';
  return '公司员工';
});
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand-lockup">
        <Warehouse :size="24" aria-hidden="true" />
        <div>
          <p class="brand-name">GLORYCHIPS</p>
          <p class="brand-subtitle">仓储工作台</p>
        </div>
      </div>

      <nav class="primary-nav" aria-label="主要导航">
        <RouterLink class="nav-link" to="/inventory">
          <PackageSearch :size="18" aria-hidden="true" />
          库存查询
        </RouterLink>
        <RouterLink class="nav-link" to="/w/XIHU/apply">
          <ClipboardList :size="18" aria-hidden="true" />
          西湖仓入口
        </RouterLink>
        <RouterLink class="nav-link" to="/w/YUHANG/apply">
          <ClipboardList :size="18" aria-hidden="true" />
          余杭仓入口
        </RouterLink>
        <RouterLink class="nav-link" to="/requests/me">
          <ClipboardList :size="18" aria-hidden="true" />
          我的申请
        </RouterLink>
        <RouterLink v-if="isWarehouseAdministrator" class="nav-link" to="/admin/requests">
          <ClipboardCheck :size="18" aria-hidden="true" />
          审核与发放
        </RouterLink>
        <RouterLink v-if="isWarehouseAdministrator" class="nav-link" to="/admin/requests/offline">
          <FilePlus2 :size="18" aria-hidden="true" />
          线下登记
        </RouterLink>
        <RouterLink v-if="isWarehouseAdministrator" class="nav-link" to="/admin/inventory/inbound">
          <PackagePlus :size="18" aria-hidden="true" />
          入库登记
        </RouterLink>
        <RouterLink v-if="isWarehouseAdministrator" class="nav-link" to="/admin/inventory/transfer">
          <ArrowRightLeft :size="18" aria-hidden="true" />
          库存调拨
        </RouterLink>
        <RouterLink
          v-if="isWarehouseAdministrator"
          class="nav-link"
          to="/admin/inventory/stocktake"
        >
          <ScanLine :size="18" aria-hidden="true" />
          库存盘点
        </RouterLink>
        <RouterLink v-if="isWarehouseAdministrator" class="nav-link" to="/admin/returns">
          <ClipboardList :size="18" aria-hidden="true" />
          实物归还
        </RouterLink>
        <RouterLink v-if="isWarehouseAdministrator" class="nav-link" to="/admin/tasks">
          <ListChecks :size="18" aria-hidden="true" />
          管理员任务
        </RouterLink>
        <RouterLink v-if="isSystemAdministrator" class="nav-link" to="/admin/work-calendar">
          <CalendarDays :size="18" aria-hidden="true" />
          工作日历
        </RouterLink>
        <RouterLink v-if="isSystemAdministrator" class="nav-link" to="/admin/catalog">
          <Settings :size="18" aria-hidden="true" />
          商品管理
        </RouterLink>
      </nav>

      <div class="account-block">
        <div class="account-copy">
          <strong class="account-name">{{ session.user.name }}</strong>
          <span class="account-role">{{ accountRoleLabel }}</span>
        </div>
        <button
          class="icon-button"
          type="button"
          title="退出登录"
          aria-label="退出登录"
          @click="logout"
        >
          <LogOut :size="18" aria-hidden="true" />
        </button>
      </div>
    </aside>

    <main class="content-shell">
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 236px minmax(0, 1fr);
  background: #f3f5f2;
}

.sidebar {
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #d9ded9;
  background: #ffffff;
}

.brand-lockup,
.account-block,
.nav-link {
  display: flex;
  align-items: center;
}

.brand-lockup {
  min-height: 76px;
  gap: 0.75rem;
  padding: 1rem 1.1rem;
  border-bottom: 1px solid #e1e5e1;
  color: #1f6049;
}

.brand-name,
.brand-subtitle,
.account-name,
.account-role {
  margin: 0;
}

.brand-name {
  color: #24312b;
  font-size: 0.82rem;
  font-weight: 800;
}

.brand-subtitle,
.account-role {
  color: #68746e;
  font-size: 0.75rem;
}

.primary-nav {
  flex: 1;
  display: grid;
  align-content: start;
  gap: 0.25rem;
  padding: 0.85rem;
}

.nav-link {
  min-height: 42px;
  gap: 0.7rem;
  padding: 0.6rem 0.75rem;
  border-radius: 6px;
  color: #45524c;
  text-decoration: none;
  font-size: 0.9rem;
  font-weight: 700;
}

.nav-link:hover {
  background: #f2f5f2;
}

.nav-link.router-link-active {
  color: #155d43;
  background: #e9f3ed;
}

.account-block {
  gap: 0.75rem;
  padding: 1rem;
  border-top: 1px solid #e1e5e1;
}

.account-copy {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 0.15rem;
}

.account-name {
  overflow: hidden;
  color: #26332d;
  font-size: 0.86rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.icon-button {
  width: 36px;
  height: 36px;
  display: grid;
  flex: 0 0 36px;
  place-items: center;
  border: 1px solid #d4dad5;
  border-radius: 6px;
  color: #47544e;
  background: #ffffff;
  cursor: pointer;
}

.icon-button:hover {
  color: #9a3e2c;
  border-color: #dcac9f;
  background: #fff5f2;
}

.content-shell {
  min-width: 0;
  padding: 1.5rem clamp(1rem, 3vw, 2.5rem) 3rem;
}

@media (max-width: 760px) {
  .app-shell {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }

  .sidebar {
    position: sticky;
    z-index: 10;
    top: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    border-right: 0;
    border-bottom: 1px solid #d9ded9;
  }

  .brand-lockup {
    min-height: 58px;
    border-bottom: 0;
  }

  .brand-subtitle,
  .account-copy {
    display: none;
  }

  .primary-nav {
    grid-column: 1 / -1;
    grid-row: 2;
    display: flex;
    overflow-x: auto;
    padding: 0 0.75rem 0.65rem;
  }

  .nav-link {
    min-height: 38px;
    flex: 0 0 auto;
    padding: 0.5rem 0.65rem;
    font-size: 0.8rem;
  }

  .account-block {
    padding: 0.7rem 0.85rem;
    border-top: 0;
  }

  .content-shell {
    padding: 1rem 0.85rem 2rem;
  }
}
</style>
