import { normalRequestDraftSchema } from '@glorychips/contracts';
import type {
  CatalogListResponse,
  InventoryQueryResponse,
  NormalRequestDraft,
  RequestStatus,
  RequestType,
  ReturnMode,
  WarehouseCode,
} from '@glorychips/contracts';

export interface RequestVariantOption {
  readonly productId: string;
  readonly variantId: string;
  readonly productName: string;
  readonly variantName: string;
  readonly category: 'SMART_RING' | 'SMART_WATCH';
  readonly availableQuantity: number;
}

export const requestTypeLabels: Readonly<Record<RequestType, string>> = {
  INTERNAL: '内部领用',
  GIFT: '外部赠送',
  SALE: '销售',
  EXHIBIT: '展品',
};

export const returnModeLabels: Readonly<Record<ReturnMode, string>> = {
  NOT_REQUIRED: '无需归还',
  BY_DATE: '指定日期归还',
  ON_DEPARTURE: '离职时归还',
};

export const requestStatusLabels: Readonly<Record<RequestStatus, string>> = {
  DRAFT: '草稿',
  PENDING_APPROVAL: '待审核',
  PENDING_RELEASE: '待发放',
  PENDING_PAPERWORK: '待补手续',
  COMPLETED: '已完成',
  REJECTED: '已退回',
  CANCELLED: '已取消',
};

export const buildRequestVariantOptions = (
  catalog: CatalogListResponse,
  inventory: InventoryQueryResponse,
  warehouse: WarehouseCode,
): readonly RequestVariantOption[] => {
  const catalogVariants = new Set(
    catalog.items.flatMap((product) => product.variants.map((variant) => variant.id)),
  );
  return inventory.products.flatMap((product) =>
    product.variants.flatMap((variant) => {
      const quantity = variant.warehouses.find((item) => item.warehouse === warehouse);
      if (
        product.status !== 'ACTIVE' ||
        !variant.isActive ||
        !catalogVariants.has(variant.id) ||
        quantity === undefined
      ) {
        return [];
      }
      return [
        {
          productId: product.id,
          variantId: variant.id,
          productName: product.name,
          variantName: variant.displayName,
          category: product.category,
          availableQuantity: quantity.availableQuantity,
        },
      ];
    }),
  );
};

export const normalizeReturnPolicy = (
  type: RequestType,
  currentMode: ReturnMode,
): { returnMode: ReturnMode; expectedReturnDate: string | null } => {
  if (type === 'GIFT' || type === 'SALE') {
    return { returnMode: 'NOT_REQUIRED', expectedReturnDate: null };
  }
  if (type === 'EXHIBIT') {
    return { returnMode: 'BY_DATE', expectedReturnDate: null };
  }
  return { returnMode: currentMode, expectedReturnDate: null };
};

export const validateNormalRequestDraft = (
  draft: NormalRequestDraft,
  today: string,
): readonly string[] => {
  const parsed = normalRequestDraftSchema.safeParse(draft);
  const messages = parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
  if (
    draft.returnMode === 'BY_DATE' &&
    draft.expectedReturnDate !== undefined &&
    draft.expectedReturnDate !== null &&
    draft.expectedReturnDate < today
  ) {
    messages.push('预计归还日期不能早于今天');
  }
  return [...new Set(messages)];
};

export const totalRequestQuantity = (draft: NormalRequestDraft): number =>
  draft.items.reduce((sum, item) => sum + item.quantity, 0);
