import {
  catalogListResponseSchema,
  catalogProductResponseSchema,
  catalogRingSizes,
  createCatalogProductRequestSchema,
  updateCatalogProductRequestSchema,
} from '@glorychips/contracts';
import type {
  CatalogListResponse,
  CatalogProductMutationResponse,
  CatalogProductResponse,
  CreateCatalogProductRequest,
  ProductCategoryCode,
  ProductStatus,
  UpdateCatalogProductRequest,
} from '@glorychips/contracts';
import type { Prisma, PrismaClient, ProductVariant } from '../generated/prisma/client.js';
import { CatalogDomainError } from './errors.js';
import { toCatalogImage } from './projections.js';

type Transaction = Prisma.TransactionClient;

const productInclude = {
  category: true,
  imageRefs: { orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }] },
  variants: true,
} satisfies Prisma.ProductInclude;

type ProductRecord = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

const shapeForCategory = (category: ProductCategoryCode) =>
  category === 'SMART_RING'
    ? { specificationMode: 'RING_SIZE' as const, baseTarget: 'RING' as const }
    : { specificationMode: 'NONE' as const, baseTarget: 'WATCH' as const };

const variantSeeds = (category: ProductCategoryCode, productCode: string, productName: string) =>
  category === 'SMART_RING'
    ? catalogRingSizes.map((size) => ({
        code: size,
        variantKey: `${productCode}:${size}`,
        displayName: `${productName} ${size}`,
        specificationMode: 'RING_SIZE' as const,
        size,
      }))
    : [
        {
          code: 'DEFAULT',
          variantKey: `${productCode}:NONE`,
          displayName: productName,
          specificationMode: 'NONE' as const,
          size: null,
        },
      ];

const variantSortOrder = new Map<string, number>(
  catalogRingSizes.map((size, index) => [size, index]),
);

const sortVariants = (variants: ProductRecord['variants']) =>
  [...variants].sort((left, right) => {
    const leftRank = left.size === null ? -1 : (variantSortOrder.get(left.size) ?? 100);
    const rightRank = right.size === null ? -1 : (variantSortOrder.get(right.size) ?? 100);
    return leftRank - rightRank || left.code.localeCompare(right.code);
  });

const toCatalogProduct = (product: ProductRecord): CatalogProductResponse => {
  const images = product.imageRefs.map(toCatalogImage);
  const mainImage = images.find((image) => image.kind === 'MAIN') ?? null;
  return {
    id: product.id,
    code: product.code,
    name: product.officialName,
    category: product.category.code,
    specificationMode: product.specificationMode,
    status: product.status,
    baseTarget: product.baseTarget,
    imageReady: mainImage !== null,
    mainImage,
    detailImages: images.filter((image) => image.kind === 'DETAIL'),
    variants: sortVariants(product.variants).map((variant) => ({
      id: variant.id,
      code: variant.code,
      displayName: variant.displayName,
      size: variant.size,
      isActive: variant.isActive,
    })),
  };
};

const assertActivationAllowed = async (
  transaction: Transaction,
  productId: string,
  status: ProductStatus,
): Promise<void> => {
  if (status !== 'ACTIVE') return;
  const mainImage = await transaction.productImageRef.findFirst({
    where: { productId, kind: 'MAIN' },
    select: { id: true },
  });
  if (mainImage === null) {
    throw new CatalogDomainError(
      'PRODUCT_IMAGE_REQUIRED',
      'A main image is required before a product can be activated.',
      { productId },
    );
  }
};

const assertCategoryChangeAllowed = async (
  transaction: Transaction,
  productId: string,
): Promise<void> => {
  const variants = await transaction.productVariant.findMany({
    where: { productId },
    select: { id: true },
  });
  const variantIds = variants.map((variant) => variant.id);
  const nonZeroBalances = await transaction.inventoryBalance.count({
    where: {
      variantId: { in: variantIds },
      OR: [
        { confirmedFeishuQuantity: { not: 0 } },
        { pendingMovementDelta: { not: 0 } },
        { reservedQuantity: { not: 0 } },
      ],
    },
  });
  const movements = await transaction.inventoryMovement.count({
    where: { variantId: { in: variantIds } },
  });
  const reservations = await transaction.inventoryReservation.count({
    where: { variantId: { in: variantIds } },
  });
  const requestItems = await transaction.requestItem.count({
    where: { variantId: { in: variantIds } },
  });
  const reconciliations = await transaction.inventoryReconciliation.count({
    where: { variantId: { in: variantIds } },
  });
  const returnObligations = await transaction.returnObligation.count({
    where: { variantId: { in: variantIds } },
  });
  const returns = await transaction.returnRecord.count({
    where: { variantId: { in: variantIds } },
  });
  if (
    nonZeroBalances +
      movements +
      reservations +
      requestItems +
      reconciliations +
      returnObligations +
      returns >
    0
  ) {
    throw new CatalogDomainError(
      'CATALOG_CATEGORY_LOCKED',
      'The product category cannot change after inventory or business usage exists.',
      { productId },
    );
  }
};

export class CatalogService {
  public constructor(private readonly database: PrismaClient) {}

  public async listCatalog(includeInactive = true): Promise<CatalogListResponse> {
    const products = await this.database.product.findMany({
      where: includeInactive ? undefined : { status: 'ACTIVE' },
      include: productInclude,
      orderBy: [{ category: { code: 'asc' } }, { officialName: 'asc' }],
    });
    return catalogListResponseSchema.parse({ items: products.map(toCatalogProduct) });
  }

  public async listSelectableCatalog(): Promise<CatalogListResponse> {
    const products = await this.database.product.findMany({
      where: {
        status: 'ACTIVE',
        imageRefs: { some: { kind: 'MAIN' } },
        variants: { some: { isActive: true } },
      },
      include: productInclude,
      orderBy: [{ category: { code: 'asc' } }, { officialName: 'asc' }],
    });
    return catalogListResponseSchema.parse({
      items: products.map((product) => {
        const projected = toCatalogProduct(product);
        return {
          ...projected,
          variants: projected.variants.filter((variant) => variant.isActive),
        };
      }),
    });
  }

  public async createProduct(
    rawCommand: CreateCatalogProductRequest,
  ): Promise<CatalogProductMutationResponse> {
    const command = createCatalogProductRequestSchema.parse(rawCommand);
    if (command.status === 'ACTIVE') {
      throw new CatalogDomainError(
        'PRODUCT_IMAGE_REQUIRED',
        'New products must receive a main image before activation.',
      );
    }
    return this.database.$transaction(async (transaction) => {
      const category = await transaction.productCategory.findUnique({
        where: { code: command.category },
      });
      if (category === null) {
        throw new CatalogDomainError('CATALOG_NOT_FOUND', 'The product category was not found.');
      }
      const shape = shapeForCategory(command.category);
      try {
        const product = await transaction.product.create({
          data: {
            code: command.code,
            officialName: command.name,
            categoryId: category.id,
            status: command.status,
            ...shape,
          },
        });
        const variants: ProductVariant[] = [];
        for (const variant of variantSeeds(command.category, command.code, command.name)) {
          variants.push(
            await transaction.productVariant.create({
              data: { ...variant, productId: product.id, isActive: false },
            }),
          );
        }
        const warehouses = await transaction.warehouse.findMany({
          where: { isActive: true },
          select: { id: true },
        });
        await transaction.inventoryBalance.createMany({
          data: warehouses.flatMap((warehouse) =>
            variants.map((variant) => ({ warehouseId: warehouse.id, variantId: variant.id })),
          ),
        });
        const created = await transaction.product.findUniqueOrThrow({
          where: { id: product.id },
          include: productInclude,
        });
        return catalogProductResponseSchema.parse({ product: toCatalogProduct(created) });
      } catch (error: unknown) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'P2002'
        ) {
          throw new CatalogDomainError('CATALOG_CONFLICT', 'The product code already exists.');
        }
        throw error;
      }
    });
  }

  public async updateProduct(
    productId: string,
    rawCommand: UpdateCatalogProductRequest,
  ): Promise<CatalogProductMutationResponse> {
    const command = updateCatalogProductRequestSchema.parse(rawCommand);
    return this.database.$transaction(async (transaction) => {
      const current = await transaction.product.findUnique({
        where: { id: productId },
        include: productInclude,
      });
      if (current === null) {
        throw new CatalogDomainError('CATALOG_NOT_FOUND', 'The product was not found.', {
          productId,
        });
      }
      const targetCategory = command.category ?? current.category.code;
      const targetName = command.name ?? current.officialName;
      const targetStatus = command.status ?? current.status;
      if (current.status !== 'ACTIVE') {
        await assertActivationAllowed(transaction, current.id, targetStatus);
      }

      if (targetCategory !== current.category.code) {
        await assertCategoryChangeAllowed(transaction, current.id);
        const category = await transaction.productCategory.findUnique({
          where: { code: targetCategory },
        });
        if (category === null) {
          throw new CatalogDomainError('CATALOG_NOT_FOUND', 'The product category was not found.');
        }
        await transaction.inventoryBalance.deleteMany({
          where: { variant: { productId: current.id } },
        });
        await transaction.productVariant.deleteMany({ where: { productId: current.id } });
        const shape = shapeForCategory(targetCategory);
        await transaction.product.update({
          where: { id: current.id },
          data: {
            officialName: targetName,
            categoryId: category.id,
            status: targetStatus,
            ...shape,
          },
        });
        const variants: ProductVariant[] = [];
        for (const variant of variantSeeds(targetCategory, current.code, targetName)) {
          variants.push(
            await transaction.productVariant.create({
              data: {
                ...variant,
                productId: current.id,
                isActive: targetStatus === 'ACTIVE',
              },
            }),
          );
        }
        const warehouses = await transaction.warehouse.findMany({
          where: { isActive: true },
          select: { id: true },
        });
        await transaction.inventoryBalance.createMany({
          data: warehouses.flatMap((warehouse) =>
            variants.map((variant) => ({ warehouseId: warehouse.id, variantId: variant.id })),
          ),
        });
      } else {
        await transaction.product.update({
          where: { id: current.id },
          data: { officialName: targetName, status: targetStatus },
        });
        for (const variant of current.variants) {
          await transaction.productVariant.update({
            where: { id: variant.id },
            data: {
              displayName: variant.size === null ? targetName : `${targetName} ${variant.size}`,
              isActive: targetStatus === 'ACTIVE',
            },
          });
        }
      }

      const updated = await transaction.product.findUniqueOrThrow({
        where: { id: current.id },
        include: productInclude,
      });
      return catalogProductResponseSchema.parse({ product: toCatalogProduct(updated) });
    });
  }

  public async getImageReference(imageId: string) {
    const image = await this.database.productImageRef.findUnique({ where: { id: imageId } });
    if (image === null) {
      throw new CatalogDomainError('CATALOG_NOT_FOUND', 'The product image was not found.', {
        imageId,
      });
    }
    return image;
  }
}
