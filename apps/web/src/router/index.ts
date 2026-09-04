import { createRouter, createWebHistory } from 'vue-router';
import CatalogAdminView from '../features/catalog/CatalogAdminView.vue';
import InventoryView from '../features/inventory/InventoryView.vue';
import WarehouseEntryView from '../features/warehouse-entry/WarehouseEntryView.vue';
import AdminRequestsView from '../features/requests/AdminRequestsView.vue';
import MyRequestsView from '../features/requests/MyRequestsView.vue';
import NormalRequestApplyView from '../features/requests/NormalRequestApplyView.vue';
import RequestDetailView from '../features/requests/RequestDetailView.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/inventory' },
    { path: '/inventory', name: 'inventory', component: InventoryView },
    { path: '/w/:warehouseCode/apply', name: 'warehouse-entry', component: WarehouseEntryView },
    {
      path: '/w/:warehouseCode/apply/normal',
      name: 'normal-request-apply',
      component: NormalRequestApplyView,
    },
    { path: '/requests/me', name: 'my-requests', component: MyRequestsView },
    { path: '/requests/:requestId', name: 'request-detail', component: RequestDetailView },
    { path: '/admin/requests', name: 'admin-requests', component: AdminRequestsView },
    { path: '/admin/catalog', name: 'catalog-admin', component: CatalogAdminView },
    { path: '/:pathMatch(.*)*', redirect: '/inventory' },
  ],
});
