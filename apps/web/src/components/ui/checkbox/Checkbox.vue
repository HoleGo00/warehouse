<script setup lang="ts">
import { Check } from '@lucide/vue';
import { CheckboxRoot, CheckboxIndicator, useForwardPropsEmits } from 'reka-ui';
import type { CheckboxRootProps, CheckboxRootEmits } from 'reka-ui';
const props = defineProps<CheckboxRootProps>();
const emits = defineEmits<CheckboxRootEmits>();
const forwarded = useForwardPropsEmits(props, emits);
</script>
<template>
  <CheckboxRoot
    v-bind="forwarded"
    class="flex size-4 shrink-0 items-center justify-center rounded border border-input bg-background data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
  >
    <CheckboxIndicator><Check class="size-3.5" /></CheckboxIndicator>
  </CheckboxRoot>
</template>
