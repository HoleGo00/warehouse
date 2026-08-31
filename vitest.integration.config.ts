import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@glorychips/contracts': fileURLToPath(
        new URL('./packages/contracts/src/index.ts', import.meta.url),
      ),
      '@glorychips/config': fileURLToPath(
        new URL('./packages/config/src/index.ts', import.meta.url),
      ),
      '@glorychips/database': fileURLToPath(
        new URL('./packages/database/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['packages/database/test/**/*.integration.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
