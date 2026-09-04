import { Injectable } from '@nestjs/common';
import { CatalogDomainError } from '@glorychips/database';

export const productImageContentTypes = [
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export type ProductImageContentType = (typeof productImageContentTypes)[number];

export interface ProductImageSource {
  readonly attachmentToken: string;
  readonly fileName: string | null;
}

export interface ProductImageContent {
  readonly body: Uint8Array;
  readonly contentType: ProductImageContentType;
  readonly etag?: string;
}

export interface ProductImageContentProvider {
  load(source: ProductImageSource): Promise<ProductImageContent>;
}

@Injectable()
export class UnavailableProductImageContentProvider implements ProductImageContentProvider {
  public async load(): Promise<ProductImageContent> {
    throw new CatalogDomainError(
      'IMAGE_UNAVAILABLE',
      'The product image provider is not configured yet.',
    );
  }
}
