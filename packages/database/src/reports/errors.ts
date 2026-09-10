import type { ExportErrorCode } from '@glorychips/contracts';

export class ReportError extends Error {
  public constructor(
    public readonly code: ExportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ReportError';
  }
}
