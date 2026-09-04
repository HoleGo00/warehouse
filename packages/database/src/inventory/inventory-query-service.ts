import {
  calculateAvailability,
  catalogRingSizes,
  inventoryQueryResponseSchema,
  inventoryQuerySchema,
  warehouseCodeSchema,
} from '@glorychips/contracts';
import type {
  InventoryProductProjection,
  InventoryQuantityProjection,
  InventoryQuery,
  InventoryQueryResponse,
  InventorySyncIndicator,
  WarehouseCode,
} from '@glorychips/contracts';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { toCatalogImage } from '../catalog/projections.js';

const productInclude = {
  category: true,
  imageRefs: { where: { kind: 'MAIN' }, orderBy: { sortOrder: 'asc' } },
  variants: {
    include: { balances: true },
  },
} satisfies Prisma.ProductInclude;

type ProductRecord = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

const variantSortOrder = new Map<string, number>(
  catalogRingSizes.map((size, index) => [size, index]),
);

const sortVariants = (variants: ProductRecord['variants']) =>
  [...variants].sort((left, right) => {
    const leftRank = left.size === null ? -1 : (variantSortOrder.get(left.size) ?? 100);
    const rightRank = right.size === null ? -1 : (variantSortOrder.get(right.size) ?? 100);
    return leftRank - rightRank || left.code.localeCompare(right.code);
  });

const toQuantity = (input: {
  readonly confirmedFeishuQuantity: number;
  readonly pendingMovementDelta: number;
  readonly reservedQuantity: number;
}): InventoryQuantityProjection => {
  const calculated = calculateAvailability(input);
  const syncIndicator: InventorySyncIndicator =
    input.pendingMovementDelta === 0 ? 'CONFIRMED' : 'PENDING_LOCAL_CHANGES';
  return { ...input, ...calculated, syncIndicator };
};

const addQuantities = (
  quantities: readonly InventoryQuantityProjection[],
): InventoryQuantityProjection => {
  const total = toQuantity({
    confirmedFeishuQuantity: quantities.reduce(
      (sum, quantity) => sum + quantity.confirmedFeishuQuantity,
      0,
    ),
    pendingMovementDelta: quantities.reduce(
      (sum, quantity) => sum + quantity.pendingMovementDelta,
      0,
    ),
    reservedQuantity: quantities.reduce((sum, quantity) => sum + quantity.reservedQuantity, 0),
  });
  return quantities.some((quantity) => quantity.syncIndicator === 'PENDING_LOCAL_CHANGES')
    ? { ...total, syncIndicator: 'PENDING_LOCAL_CHANGES' }
    : total;
};

const toProductProjection = (
  product: ProductRecord,
  warehouseCodesById: ReadonlyMap<string, WarehouseCode>,
  selectedWarehouseIds: ReadonlySet<string>,
): InventoryProductProjection => {
  const mainImage =
    product.imageRefs[0] === undefined ? null : toCatalogImage(product.imageRefs[0]);
  return {
    id: product.id,
    code: product.code,
    name: product.officialName,
    category: product.category.code,
    status: product.status,
    imageReady: mainImage !== null,
    mainImage,
    variants: sortVariants(product.variants).map((variant) => {
      const balanceByWarehouse = new Map(
        variant.balances
          .filter((balance) => selectedWarehouseIds.has(balance.warehouseId))
          .map((balance) => [balance.warehouseId, balance]),
      );
      const warehouses = [...warehouseCodesById.entries()]
        .filter(([warehouseId]) => selectedWarehouseIds.has(warehouseId))
        .map(([warehouseId, warehouse]) => {
          const balance = balanceByWarehouse.get(warehouseId);
          return {
            warehouse,
            ...toQuantity({
              confirmedFeishuQuantity: balance?.confirmedFeishuQuantity ?? 0,
              pendingMovementDelta: balance?.pendingMovementDelta ?? 0,
              reservedQuantity: balance?.reservedQuantity ?? 0,
            }),
          };
        });
      return {
        id: variant.id,
        code: variant.code,
        displayName: variant.displayName,
        size: variant.size,
        isActive: variant.isActive,
        warehouses,
        total: addQuantities(warehouses),
      };
    }),
  };
};

export class InventoryQueryService {
  public constructor(private readonly database: PrismaClient) {}

  public async query(rawQuery: InventoryQuery): Promise<InventoryQueryResponse> {
    const query = inventoryQuerySchema.parse(rawQuery);
    const warehouses = await this.database.warehouse.findMany({
      where: {
        isActive: true,
        ...(query.warehouse === 'ALL' ? {} : { code: query.warehouse }),
      },
      select: { id: true, code: true, name: true },
    });
    warehouses.sort((left, right) => left.code.localeCompare(right.code));
    const warehouseCodesById = new Map<string, WarehouseCode>(
      warehouses.map((warehouse) => [warehouse.id, warehouseCodeSchema.parse(warehouse.code)]),
    );
    const selectedWarehouseIds = new Set(warehouses.map((warehouse) => warehouse.id));
    const products = await this.database.product.findMany({
      where: query.category === undefined ? undefined : { category: { code: query.category } },
      include: productInclude,
      orderBy: [{ category: { code: 'asc' } }, { officialName: 'asc' }],
    });
    return inventoryQueryResponseSchema.parse({
      warehouse: query.warehouse,
      category: query.category ?? null,
      warehouses: warehouses.map(({ code, name }) => ({ code, name })),
      products: products.map((product) =>
        toProductProjection(product, warehouseCodesById, selectedWarehouseIds),
      ),
    });
  }
}
