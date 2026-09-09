<script setup lang="ts">
import { Search, UserCog } from '@lucide/vue';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuthenticatedSession } from '../auth/auth-context.js';
import ReportSelect from '../reports/ReportSelect.vue';
import AccessDialog from './AccessDialog.vue';
import { useStaff } from './useStaff.js';
const state = useStaff(useAuthenticatedSession());
const { allowed, rows, selected, query, role, status, loading, busy, error, nextCursor } = state;
const roles = { CLAIMANT: '普通领用人', WAREHOUSE_ADMIN: '仓库管理员', SYSTEM_ADMIN: '系统管理员' };
</script>
<template>
  <section class="mx-auto grid w-full min-w-0 max-w-7xl gap-4">
    <h1 class="border-b border-border pb-3 text-xl font-semibold">人员与权限</h1>
    <Alert v-if="!allowed" variant="destructive"
      ><AlertDescription>仅系统管理员可访问</AlertDescription></Alert
    >
    <template v-else>
      <form
        class="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-4"
        @submit.prevent="state.load()"
      >
        <label class="grid gap-1.5 text-sm font-medium"
          >姓名<Input v-model="query" maxlength="100"
        /></label>
        <ReportSelect
          v-model="role"
          label="角色筛选"
          :options="Object.entries(roles).map(([value, label]) => ({ value, label }))"
        />
        <ReportSelect
          v-model="status"
          label="人员状态"
          :options="[
            { value: 'ACTIVE', label: '在职' },
            { value: 'INACTIVE', label: '已停用' },
          ]"
        />
        <Button :disabled="loading"><Search />查询</Button>
      </form>
      <Alert v-if="error && !selected" variant="destructive"
        ><AlertDescription>{{ error }}</AlertDescription></Alert
      >
      <p v-if="loading" role="status" class="py-6 text-center text-sm">正在读取人员</p>
      <div v-else class="min-w-0 overflow-x-auto">
        <Table
          ><TableHeader
            ><TableRow
              ><TableHead>姓名</TableHead><TableHead>状态</TableHead><TableHead>角色</TableHead
              ><TableHead>授权仓库</TableHead><TableHead>操作</TableHead></TableRow
            ></TableHeader
          ><TableBody>
            <TableRow v-for="user in rows" :key="user.id"
              ><TableCell>{{ user.name }}</TableCell
              ><TableCell>{{ user.status === 'ACTIVE' ? '在职' : '已停用' }}</TableCell
              ><TableCell>{{ user.access.roles.map((r) => roles[r]).join('、') }}</TableCell
              ><TableCell>{{
                user.access.roles.includes('SYSTEM_ADMIN')
                  ? '全部仓库'
                  : user.access.warehouses
                      .map((w) => (w === 'XIHU' ? '西湖仓' : '余杭仓'))
                      .join('、') || '无'
              }}</TableCell
              ><TableCell
                ><Button
                  variant="outline"
                  size="icon"
                  title="修改权限"
                  aria-label="修改权限"
                  @click="selected = user"
                  ><UserCog /></Button></TableCell
            ></TableRow>
            <TableRow v-if="!rows.length"
              ><TableCell :colspan="5" class="py-10 text-center">暂无匹配人员</TableCell></TableRow
            >
          </TableBody></Table
        >
      </div>
      <Button v-if="nextCursor" variant="outline" :disabled="loading" @click="state.load(true)"
        >更多人员</Button
      >
      <AccessDialog
        :user="selected"
        :busy="busy"
        :error="error"
        @close="selected = null"
        @save="state.save"
      />
    </template>
  </section>
</template>
