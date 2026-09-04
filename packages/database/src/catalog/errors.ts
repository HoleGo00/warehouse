import type { CatalogErrorCode } from '@glorychips/contracts';

export class CatalogDomainError extends Error {
  public constructor(
    public readonly code: CatalogErrorCode,
    message: string,
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
