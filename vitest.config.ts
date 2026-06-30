import { resolve } from 'node:path'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@cradle/ipc': resolve('packages/ipc/src/index.ts'),
      '@cradle/tabs-next': resolve('packages/tabs-next/src/index.ts'),
      '@shared': resolve('src/shared'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'src/**/__tests__/**/*.test.ts',
      'src/**/__tests__/**/*.test.tsx',
      'apps/desktop/src/**/*.test.ts',
      'apps/desktop/src/**/*.test.tsx',
      'packages/**/*.test.ts',
      'packages/**/*.test.tsx',
      'packages/**/__tests__/**/*.test.ts',
      'packages/**/__tests__/**/*.test.tsx',
      'plugins/**/*.test.ts',
      'plugins/**/*.test.tsx',
      'plugins/**/__tests__/**/*.test.ts',
      'plugins/**/__tests__/**/*.test.tsx',
    ],
    mockReset: true,
  },
})
