import { describe, expect, it } from 'vitest';
import {
  movementOutboxPayloadSchema,
  retrySyncJobSchema,
  runSyncReconciliationSchema,
  syncJobsQuerySchema,
  syncReconciliationsQuerySchema,
  syncJobIdSchema,
} from './feishu-sync.js';

describe('synchronization contracts', () => {
  it('bounds query limits and accepts only known targets and states', () => {
    expect(syncJobsQuerySchema.parse({}).limit).toBe(50);
    expect(syncJobsQuerySchema.parse({ limit: '200', target: 'RING_BASE' }).limit).toBe(200);
    for (const limit of [0, -1, 201, 1.5, 'bad']) {
      expect(syncJobsQuerySchema.safeParse({ limit }).success).toBe(false);
    }
    expect(syncJobsQuerySchema.safeParse({ target: 'raw-base-token' }).success).toBe(false);
    expect(syncJobsQuerySchema.safeParse({ status: 'SYNCED' }).success).toBe(false);
    expect(syncReconciliationsQuerySchema.safeParse({ warehouse: 'unknown' }).success).toBe(false);
  });
  it('requires a bounded reason and validates mutation targets and UUIDs', () => {
    expect(retrySyncJobSchema.parse({ reason: ' retry ' })).toEqual({ reason: 'retry' });
    for (const reason of ['', ' ', 'x'.repeat(501)]) {
      expect(retrySyncJobSchema.safeParse({ reason }).success).toBe(false);
    }
    expect(runSyncReconciliationSchema.safeParse({ target: 'ALL' }).success).toBe(false);
    expect(syncJobIdSchema.safeParse('../jobs').success).toBe(false);
  });
  it('rejects duplicate, missing or malformed movement references', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(
      movementOutboxPayloadSchema.safeParse({ businessNumber: 'IN-1', movementIds: [id] }).success,
    ).toBe(true);
    for (const movementIds of [[], [id, id], ['not-a-uuid']]) {
      expect(
        movementOutboxPayloadSchema.safeParse({ businessNumber: 'IN-1', movementIds }).success,
      ).toBe(false);
    }
  });
});
