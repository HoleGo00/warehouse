import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient } from '@glorychips/database';
import { DatabaseLifecycle } from './database-lifecycle.js';

describe('worker database lifecycle', () => {
  it('disconnects the worker database when the application closes', async () => {
    const disconnect = vi.fn().mockResolvedValue(undefined);
    const lifecycle = new DatabaseLifecycle({
      $disconnect: disconnect,
    } as unknown as DatabaseClient);
    await lifecycle.onApplicationShutdown();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
