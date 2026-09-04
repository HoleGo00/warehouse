import { catalogImageSchema } from '@glorychips/contracts';
import type { CatalogImage, ImageKind } from '@glorychips/contracts';

interface ImageReferenceRecord {
  readonly id: string;
  readonly kind: ImageKind;
  readonly sortOrder: number;
  readonly fileName: string | null;
}

export const toCatalogImage = (image: ImageReferenceRecord): CatalogImage =>
  catalogImageSchema.parse({
    id: image.id,
    kind: image.kind,
    sortOrder: image.sortOrder,
    fileName: image.fileName,
    url: `/catalog/images/${image.id}`,
  });
