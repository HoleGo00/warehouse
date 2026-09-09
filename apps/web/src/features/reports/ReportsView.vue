<script setup lang="ts">
import { ref } from 'vue';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuthenticatedSession } from '../auth/auth-context.js';
import { useReports } from './useReports.js';
import ReportFilters from './ReportFilters.vue';
import ReportResults from './ReportResults.vue';
import ExportJobs from './ExportJobs.vue';
const session = useAuthenticatedSession();
const state = useReports(session);
const { allowed, rows, jobs, filters, loading, busy, error, message, nextCursor, jobNext, page } =
  state;
const view = ref('query');
async function exportCurrent() {
  await state.createExport();
  if (!error.value) view.value = 'exports';
}
</script>
<template>
  <section class="mx-auto grid w-full min-w-0 max-w-7xl gap-4">
    <h1 class="border-b border-border pb-3 text-xl font-semibold">业务查询与导出</h1>
    <Alert v-if="!allowed" variant="destructive"
      ><AlertDescription>仅管理员可访问</AlertDescription></Alert
    >
    <template v-else>
      <Alert v-if="error" variant="destructive"
        ><AlertDescription>{{ error }}</AlertDescription></Alert
      >
      <p v-if="message" role="status" class="text-sm text-primary">{{ message }}</p>
      <Tabs v-model="view" class="min-w-0"
        ><TabsList variant="line"
          ><TabsTrigger value="query">业务查询</TabsTrigger
          ><TabsTrigger value="exports">我的导出</TabsTrigger></TabsList
        >
        <TabsContent value="query" class="grid min-w-0 gap-5"
          ><ReportFilters
            :session="session"
            :initial="filters"
            :busy="loading || busy"
            @search="state.search" /><ReportResults
            :rows="rows"
            :page="page"
            :has-next="!!nextCursor"
            :loading="loading"
            :busy="busy"
            @previous="state.previous"
            @next="state.next"
            @export="exportCurrent"
        /></TabsContent>
        <TabsContent value="exports" class="min-w-0"
          ><ExportJobs
            :jobs="jobs"
            :busy="busy"
            :more="!!jobNext"
            @download="state.download"
            @refresh="state.loadJobs()"
            @more="state.loadJobs(true)"
        /></TabsContent>
      </Tabs>
    </template>
  </section>
</template>
