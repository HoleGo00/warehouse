<script setup lang="ts">
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
defineProps<{ label: string; options: { value: string; label: string }[] }>();
const model = defineModel<string>({ default: 'ALL' });
</script>
<template>
  <div class="grid min-w-0 gap-1.5">
    <span class="text-sm font-medium">{{ label }}</span>
    <Select v-model="model">
      <SelectTrigger class="w-full" :aria-label="label"><SelectValue /></SelectTrigger>
      <SelectContent
        ><SelectItem value="ALL">全部</SelectItem>
        <SelectItem v-for="option in options" :key="option.value" :value="option.value">{{
          option.label
        }}</SelectItem>
      </SelectContent>
    </Select>
  </div>
</template>
