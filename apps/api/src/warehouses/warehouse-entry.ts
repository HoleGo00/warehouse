import {
  warehouseEntriesResponseSchema,
  warehouseEntrySchema,
  warehouseCodeSchema,
} from '@glorychips/contracts';
import type {
  WarehouseCode,
  WarehouseEntriesResponse,
  WarehouseEntry,
} from '@glorychips/contracts';
import type { ApiEnvironment } from '@glorychips/config';

interface WarehouseDirectoryRecord {
  readonly code: string;
  readonly name: string;
}

export const buildWarehouseEntry = (
  publicBaseUrl: string,
  warehouse: WarehouseDirectoryRecord,
): WarehouseEntry => {
  const code = warehouseCodeSchema.parse(warehouse.code);
  const applyPath = `/w/${code}/apply` as const;
  return warehouseEntrySchema.parse({
    code,
    name: warehouse.name,
    applyPath,
    publicUrl: new URL(applyPath, publicBaseUrl).toString(),
    qrCodeUrl: `/warehouses/${code}/qr.svg`,
  });
};

export const buildWarehouseEntriesResponse = (
  environment: ApiEnvironment,
  warehouses: readonly WarehouseDirectoryRecord[],
): WarehouseEntriesResponse =>
  warehouseEntriesResponseSchema.parse({
    items: warehouses.map((warehouse) =>
      buildWarehouseEntry(environment.WEB_PUBLIC_URL, warehouse),
    ),
    productionReady: environment.NODE_ENV === 'production',
  });

export const findWarehouseEntry = (
  environment: ApiEnvironment,
  warehouses: readonly WarehouseDirectoryRecord[],
  code: WarehouseCode,
): WarehouseEntry | null => {
  const warehouse = warehouses.find((candidate) => candidate.code === code);
  return warehouse === undefined
    ? null
    : buildWarehouseEntry(environment.WEB_PUBLIC_URL, warehouse);
};
