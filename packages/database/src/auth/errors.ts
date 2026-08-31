import type { AuthErrorCode } from '@glorychips/contracts';

export class AuthDomainError extends Error {
  public constructor(
    public readonly code: AuthErrorCode,
    message: string,
    public readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
