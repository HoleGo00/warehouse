import {
  ringSizes,
  type BaseTarget,
  type ProductCategoryCode,
  type ProductStatus,
  type SpecificationMode,
} from './enums.js';

export interface CatalogProduct {
  readonly code: string;
  readonly name: string;
  readonly category: ProductCategoryCode;
  readonly specificationMode: SpecificationMode;
  readonly status: ProductStatus;
  readonly baseTarget: BaseTarget;
  readonly aliases: readonly string[];
}

export const productCatalog: readonly CatalogProduct[] = [
  {
    code: 'RING_YEARS_TRIBUTE_ROSE_GOLD',
    name: '岁月礼赞·磨砂玫瑰金',
    category: 'SMART_RING',
    specificationMode: 'RING_SIZE',
    status: 'ACTIVE',
    baseTarget: 'RING',
    aliases: [],
  },
  {
    code: 'RING_BUSINESS_ELITE_KUNLUN_GREY',
    name: '商务精英·间金昆仑灰',
    category: 'SMART_RING',
    specificationMode: 'RING_SIZE',
    status: 'ACTIVE',
    baseTarget: 'RING',
    aliases: ['昆仑款'],
  },
  {
    code: 'RING_PROMOTION_SAPPHIRE_STARRY_SKY',
    name: '御路荣升·蓝宝石星空',
    category: 'SMART_RING',
    specificationMode: 'RING_SIZE',
    status: 'ACTIVE',
    baseTarget: 'RING',
    aliases: ['蓝宝石款'],
  },
  {
    code: 'RING_PARIS_CLASSIC_DIAMOND_ROSE_GOLD',
    name: '巴黎经典·星钻永恒玫瑰金',
    category: 'SMART_RING',
    specificationMode: 'RING_SIZE',
    status: 'ACTIVE',
    baseTarget: 'RING',
    aliases: ['钻石款'],
  },
  {
    code: 'RING_LEADER_TITANIUM_GOLD',
    name: '领袖江山·指定乾坤钛金',
    category: 'SMART_RING',
    specificationMode: 'RING_SIZE',
    status: 'ACTIVE',
    baseTarget: 'RING',
    aliases: ['黄金款'],
  },
  {
    code: 'RING_ROYAL_ENAMEL_ELIZABETH',
    name: '皇室珐琅·贵族伊丽莎白',
    category: 'SMART_RING',
    specificationMode: 'RING_SIZE',
    status: 'ACTIVE',
    baseTarget: 'RING',
    aliases: [],
  },
  {
    code: 'RING_ROYAL_ENAMEL_OBSIDIAN_BLACK',
    name: '皇室珐琅·国王曜石黑',
    category: 'SMART_RING',
    specificationMode: 'RING_SIZE',
    status: 'ACTIVE',
    baseTarget: 'RING',
    aliases: [],
  },
  {
    code: 'RING_ROYAL_ENAMEL_ROSE_PINK',
    name: '皇室珐琅·贵族玫瑰粉',
    category: 'SMART_RING',
    specificationMode: 'RING_SIZE',
    status: 'ACTIVE',
    baseTarget: 'RING',
    aliases: [],
  },
  {
    code: 'RING_INTANGIBLE_HERITAGE_IMPERIAL_GREEN',
    name: '国礼非遗·珐琅帝王绿',
    category: 'SMART_RING',
    specificationMode: 'RING_SIZE',
    status: 'ACTIVE',
    baseTarget: 'RING',
    aliases: [],
  },
  {
    code: 'RING_INTANGIBLE_HERITAGE_PALACE_RED',
    name: '国礼非遗·珐琅宫廷红',
    category: 'SMART_RING',
    specificationMode: 'RING_SIZE',
    status: 'ACTIVE',
    baseTarget: 'RING',
    aliases: [],
  },
  {
    code: 'WATCH_HEALTH',
    name: '健康腕表',
    category: 'SMART_WATCH',
    specificationMode: 'NONE',
    status: 'ACTIVE',
    baseTarget: 'WATCH',
    aliases: [],
  },
  {
    code: 'WATCH_HISTORICAL_ROSE',
    name: '玫瑰',
    category: 'SMART_WATCH',
    specificationMode: 'NONE',
    status: 'INACTIVE_HISTORICAL',
    baseTarget: 'WATCH',
    aliases: [],
  },
  {
    code: 'WATCH_HISTORICAL_STARRY_SKY',
    name: '满天星',
    category: 'SMART_WATCH',
    specificationMode: 'NONE',
    status: 'INACTIVE_HISTORICAL',
    baseTarget: 'WATCH',
    aliases: [],
  },
  {
    code: 'WATCH_HISTORICAL_BLACK_GOLD',
    name: '黑金',
    category: 'SMART_WATCH',
    specificationMode: 'NONE',
    status: 'INACTIVE_HISTORICAL',
    baseTarget: 'WATCH',
    aliases: [],
  },
] as const;

export const catalogRingSizes = ringSizes;
