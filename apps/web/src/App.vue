<script setup lang="ts">
import AuthShell from './features/auth/AuthShell.vue';
import AppShell from './AppShell.vue';
</script>

<template>
  <AuthShell v-slot="{ session, logout }">
    <AppShell :session="session" :logout="logout" />
  </AuthShell>
</template>
