import { createRouter, createWebHistory } from 'vue-router';
import CatalogAdminView from '../features/catalog/CatalogAdminView.vue';
import InventoryView from '../features/inventory/InventoryView.vue';
import WarehouseEntryView from '../features/warehouse-entry/WarehouseEntryView.vue';
import AdminRequestsView from '../features/requests/AdminRequestsView.vue';
import MyRequestsView from '../features/requests/MyRequestsView.vue';
import NormalRequestApplyView from '../features/requests/NormalRequestApplyView.vue';
import OfflineRequestView from '../features/requests/OfflineRequestView.vue';
import RequestDetailView from '../features/requests/RequestDetailView.vue';
import TemporaryRequestApplyView from '../features/requests/TemporaryRequestApplyView.vue';
import AdminTasksView from '../features/inventory-operations/AdminTasksView.vue';
import InboundView from '../features/inventory-operations/InboundView.vue';
import ReturnsView from '../features/inventory-operations/ReturnsView.vue';
import StocktakeView from '../features/inventory-operations/StocktakeView.vue';
import TransferView from '../features/inventory-operations/TransferView.vue';
import WorkCalendarView from '../features/inventory-operations/WorkCalendarView.vue';
import SyncAdminView from '../features/sync/SyncAdminView.vue';
import ReportsView from '../features/reports/ReportsView.vue';
import AccessView from '../features/access/AccessView.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/inventory' },
    { path: '/admin/reports', name: 'reports', component: ReportsView },
    { path: '/admin/access', name: 'access', component: AccessView },
    { path: '/inventory', name: 'inventory', component: InventoryView },
    { path: '/w/:warehouseCode/apply', name: 'warehouse-entry', component: WarehouseEntryView },
    {
      path: '/w/:warehouseCode/apply/normal',
      name: 'normal-request-apply',
      component: NormalRequestApplyView,
    },
    {
      path: '/w/:warehouseCode/apply/temporary',
      name: 'temporary-request-apply',
      component: TemporaryRequestApplyView,
    },
    { path: '/requests/me', name: 'my-requests', component: MyRequestsView },
    { path: '/requests/:requestId', name: 'request-detail', component: RequestDetailView },
    { path: '/admin/requests', name: 'admin-requests', component: AdminRequestsView },
    {
      path: '/admin/requests/offline',
      name: 'offline-request-create',
      component: OfflineRequestView,
    },
    { path: '/admin/catalog', name: 'catalog-admin', component: CatalogAdminView },
    { path: '/admin/inventory/inbound', name: 'inventory-inbound', component: InboundView },
    { path: '/admin/inventory/transfer', name: 'inventory-transfer', component: TransferView },
    { path: '/admin/inventory/stocktake', name: 'inventory-stocktake', component: StocktakeView },
    { path: '/admin/returns', name: 'admin-returns', component: ReturnsView },
    { path: '/admin/tasks', name: 'admin-tasks', component: AdminTasksView },
    { path: '/admin/work-calendar', name: 'work-calendar', component: WorkCalendarView },
    { path: '/admin/sync', name: 'sync-admin', component: SyncAdminView },
    { path: '/:pathMatch(.*)*', redirect: '/inventory' },
  ],
});
