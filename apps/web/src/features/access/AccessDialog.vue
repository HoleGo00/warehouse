<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { StaffRow, UpdateAccessRequest, WarehouseCode } from '@glorychips/contracts';
import { updateAccessRequestSchema } from '@glorychips/contracts';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
const props = defineProps<{ user: StaffRow | null; busy: boolean; error: string }>();
const emit = defineEmits<{ close: []; save: [command: UpdateAccessRequest] }>();
const role = ref('CLAIMANT');
const warehouses = ref<WarehouseCode[]>([]);
watch(
  () => props.user,
  (user) => {
    role.value = user?.access.roles.includes('SYSTEM_ADMIN')
      ? 'SYSTEM_ADMIN'
      : user?.access.roles.includes('WAREHOUSE_ADMIN')
        ? 'WAREHOUSE_ADMIN'
        : 'CLAIMANT';
    warehouses.value = [...(user?.access.warehouses ?? [])];
  },
  { immediate: true },
);
const command = computed(() => ({
  roles: role.value === 'CLAIMANT' ? ['CLAIMANT'] : ['CLAIMANT', role.value],
  warehouses: role.value === 'WAREHOUSE_ADMIN' ? warehouses.value : [],
}));
function toggle(warehouse: WarehouseCode, checked: boolean | 'indeterminate') {
  warehouses.value =
    checked === true
      ? [...new Set([...warehouses.value, warehouse])]
      : warehouses.value.filter((w) => w !== warehouse);
}
function save() {
  const parsed = updateAccessRequestSchema.safeParse(command.value);
  if (parsed.success) emit('save', parsed.data);
}
</script>
<template>
  <Dialog
    :open="!!user"
    @update:open="
      (open) => {
        if (!open && !busy) emit('close');
      }
    "
  >
    <DialogContent
      ><DialogHeader
        ><DialogTitle>修改人员权限</DialogTitle
        ><DialogDescription>{{ user?.name }}</DialogDescription></DialogHeader
      >
      <div class="grid gap-4">
        <label class="grid gap-2 text-sm font-medium"
          >角色
          <Select v-model="role"
            ><SelectTrigger aria-label="角色"><SelectValue /></SelectTrigger
            ><SelectContent
              ><SelectItem value="CLAIMANT">普通领用人</SelectItem
              ><SelectItem value="WAREHOUSE_ADMIN">仓库管理员</SelectItem
              ><SelectItem value="SYSTEM_ADMIN">系统管理员</SelectItem></SelectContent
            ></Select
          >
        </label>
        <fieldset v-if="role === 'WAREHOUSE_ADMIN'" class="grid gap-3">
          <legend class="mb-2 text-sm font-medium">授权仓库</legend>
          <label
            v-for="warehouse in ['XIHU', 'YUHANG'] as const"
            :key="warehouse"
            class="flex items-center gap-2"
            ><Checkbox
              :model-value="warehouses.includes(warehouse)"
              @update:model-value="(v) => toggle(warehouse, v)"
            />{{ warehouse === 'XIHU' ? '西湖仓' : '余杭仓' }}</label
          >
        </fieldset>
        <p v-if="role === 'SYSTEM_ADMIN'" class="text-sm text-amber-700">
          系统管理员拥有全部仓库权限。
        </p>
        <p v-if="error" role="alert" class="break-words text-sm text-destructive">{{ error }}</p>
      </div>
      <DialogFooter
        ><Button variant="outline" :disabled="busy" @click="emit('close')">取消</Button
        ><Button
          :disabled="busy || !updateAccessRequestSchema.safeParse(command).success"
          @click="save"
          >{{ busy ? '正在保存' : '保存权限' }}</Button
        ></DialogFooter
      >
    </DialogContent>
  </Dialog>
</template>
