import { createRouter, createWebHistory } from 'vue-router';
import CatalogAdminView from '../features/catalog/CatalogAdminView.vue';
import InventoryView from '../features/inventory/InventoryView.vue';
import WarehouseEntryView from '../features/warehouse-entry/WarehouseEntryView.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/inventory' },
    { path: '/inventory', name: 'inventory', component: InventoryView },
    { path: '/w/:warehouseCode/apply', name: 'warehouse-entry', component: WarehouseEntryView },
    { path: '/admin/catalog', name: 'catalog-admin', component: CatalogAdminView },
    { path: '/:pathMatch(.*)*', redirect: '/inventory' },
  ],
});
