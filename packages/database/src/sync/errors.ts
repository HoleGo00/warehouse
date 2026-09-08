import type { ApiErrorCode } from '@glorychips/contracts';

export class FeishuSyncError extends Error {
  public constructor(public readonly code: ApiErrorCode) {
    super(code);
    this.name = 'FeishuSyncError';
  }
}
