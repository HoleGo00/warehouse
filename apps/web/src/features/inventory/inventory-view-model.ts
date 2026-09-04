import type {
  InventoryProductProjection,
  InventoryQuantityProjection,
  InventoryVariantProjection,
  WarehouseCode,
} from '@glorychips/contracts';

export const productStatusLabel = (status: InventoryProductProjection['status']): string => {
  if (status === 'ACTIVE') return '启用';
  if (status === 'INACTIVE_HISTORICAL') return '历史停用';
  return '停用';
};

export const hasPendingSync = (product: InventoryProductProjection): boolean =>
  product.variants.some((variant) =>
    variant.warehouses.some((quantity) => quantity.syncIndicator === 'PENDING_LOCAL_CHANGES'),
  );

export const quantityForWarehouse = (
  variant: InventoryVariantProjection,
  warehouse: WarehouseCode,
): InventoryQuantityProjection | null =>
  variant.warehouses.find((quantity) => quantity.warehouse === warehouse) ?? null;

export const quantitySummary = (quantity: InventoryQuantityProjection): string =>
  `飞书 ${quantity.confirmedFeishuQuantity} / 待同步 ${quantity.pendingMovementDelta >= 0 ? '+' : ''}${quantity.pendingMovementDelta} / 预占 ${quantity.reservedQuantity}`;
