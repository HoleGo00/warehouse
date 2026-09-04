import type { ApiErrorCode } from '@glorychips/contracts';

export class RequestDomainError extends Error {
  public constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
