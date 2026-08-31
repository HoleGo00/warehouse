import { describe, expect, it } from 'vitest';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('reports a healthy service without a configured database', async () => {
    const previous = process.env['DATABASE_URL'];
    delete process.env['DATABASE_URL'];
    try {
      const response = await new HealthController().health();
      expect(response).toMatchObject({ service: 'api', status: 'ok', database: 'not-configured' });
    } finally {
      if (previous === undefined) delete process.env['DATABASE_URL'];
      else process.env['DATABASE_URL'] = previous;
    }
  });
});
