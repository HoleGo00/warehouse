import {
  catalogRingSizes,
  productCatalog,
  roleCodes,
  warehouseCodes,
} from '../../contracts/src/index.js';
import { createDatabaseClient } from '../src/client.js';

const roleNames = {
  CLAIMANT: '领用人',
  WAREHOUSE_ADMIN: '仓库管理员',
  SYSTEM_ADMIN: '系统管理员',
} as const;

const warehouseNames = {
  XIHU: '西湖仓',
  YUHANG: '余杭仓',
} as const;

const categoryNames = {
  SMART_RING: '智能指环',
  SMART_WATCH: '智能腕表',
} as const;

const database = createDatabaseClient();

const seed = async (): Promise<void> => {
  await database.$transaction(async (transaction) => {
    for (const code of roleCodes) {
      await transaction.role.upsert({
        where: { code },
        create: { code, name: roleNames[code] },
        update: { name: roleNames[code] },
      });
    }

    for (const code of warehouseCodes) {
      await transaction.warehouse.upsert({
        where: { code },
        create: {
          code,
          name: warehouseNames[code],
          publicSlug: code.toLowerCase(),
        },
        update: {
          name: warehouseNames[code],
          publicSlug: code.toLowerCase(),
          isActive: true,
        },
      });
    }

    const categoryIds = new Map<string, string>();
    for (const [code, name] of Object.entries(categoryNames)) {
      const category = await transaction.productCategory.upsert({
        where: { code: code as keyof typeof categoryNames },
        create: { code: code as keyof typeof categoryNames, name },
        update: { name },
      });
      categoryIds.set(code, category.id);
    }

    for (const catalogProduct of productCatalog) {
      const categoryId = categoryIds.get(catalogProduct.category);
      if (categoryId === undefined) {
        throw new Error(`Missing category seed for ${catalogProduct.category}`);
      }

      const product = await transaction.product.upsert({
        where: { code: catalogProduct.code },
        create: {
          code: catalogProduct.code,
          officialName: catalogProduct.name,
          categoryId,
          specificationMode: catalogProduct.specificationMode,
          status: catalogProduct.status,
          baseTarget: catalogProduct.baseTarget,
        },
        update: {
          officialName: catalogProduct.name,
          categoryId,
          specificationMode: catalogProduct.specificationMode,
          status: catalogProduct.status,
          baseTarget: catalogProduct.baseTarget,
        },
      });

      for (const alias of catalogProduct.aliases) {
        await transaction.productAlias.upsert({
          where: {
            source_alias: {
              source: 'LEGACY_FEISHU',
              alias,
            },
          },
          create: {
            productId: product.id,
            alias,
            source: 'LEGACY_FEISHU',
          },
          update: { productId: product.id },
        });
      }

      const variants =
        catalogProduct.specificationMode === 'RING_SIZE'
          ? catalogRingSizes.map((size) => ({ code: size, size }))
          : [{ code: 'DEFAULT', size: null }];

      for (const variantSeed of variants) {
        const variantKey = `${catalogProduct.code}:${variantSeed.size ?? 'NONE'}`;
        await transaction.productVariant.upsert({
          where: { variantKey },
          create: {
            productId: product.id,
            code: variantSeed.code,
            variantKey,
            displayName:
              variantSeed.size === null
                ? catalogProduct.name
                : `${catalogProduct.name} ${variantSeed.size}`,
            specificationMode: catalogProduct.specificationMode,
            size: variantSeed.size,
            isActive: catalogProduct.status === 'ACTIVE',
          },
          update: {
            productId: product.id,
            code: variantSeed.code,
            displayName:
              variantSeed.size === null
                ? catalogProduct.name
                : `${catalogProduct.name} ${variantSeed.size}`,
            specificationMode: catalogProduct.specificationMode,
            size: variantSeed.size,
            isActive: catalogProduct.status === 'ACTIVE',
          },
        });
      }
    }

    const warehouses = await transaction.warehouse.findMany({ select: { id: true } });
    const variants = await transaction.productVariant.findMany({ select: { id: true } });

    await transaction.inventoryBalance.createMany({
      data: warehouses.flatMap((warehouse) =>
        variants.map((variant) => ({
          warehouseId: warehouse.id,
          variantId: variant.id,
        })),
      ),
      skipDuplicates: true,
    });
  });

  const [warehouseCount, roleCount, productCount, variantCount, balanceCount] = await Promise.all([
    database.warehouse.count(),
    database.role.count(),
    database.product.count(),
    database.productVariant.count(),
    database.inventoryBalance.count(),
  ]);

  console.info(
    `Seed complete: ${warehouseCount} warehouses, ${roleCount} roles, ${productCount} products, ${variantCount} variants, ${balanceCount} balances.`,
  );
};

seed()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await database.$disconnect();
  });
