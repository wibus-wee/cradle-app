import { resolve } from 'node:path'

import { defineConfig } from 'vitest/config'

/**
 * Lightweight Vitest config for Plan 063 transport-boundary unit tests.
 * Avoids the full Vite app plugin graph (TanStack Router / React Compiler),
 * which hangs or starves under forks+jsdom pool contention.
 *
 * Usage:
 *   pnpm exec vitest run --config vitest.transport.config.ts <files...>
 */
export default defineConfig({
  test: {
    environment: 'node',
    pool: 'threads',
    maxWorkers: 1,
    fileParallelism: false,
    // Isolate forks hang under this repo's Vite graph; threads + no isolate is reliable.
    isolate: false,
    testTimeout: 10_000,
    hookTimeout: 5_000,
    setupFiles: [resolve(__dirname, 'src/test-setup.ts')],
  },
  resolve: {
    alias: {
      '~': resolve(__dirname, 'src'),
    },
  },
})
