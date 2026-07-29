import { resolve } from 'node:path'

import { defineConfig } from 'vitest/config'

const nodeTestIncludes = [
  'src/**/*.test.ts',
  'src/**/*.test.tsx',
  'src/**/__tests__/**/*.test.ts',
  'src/**/__tests__/**/*.test.tsx',
  'apps/desktop/src/**/*.test.ts',
  'apps/desktop/src/**/*.test.tsx',
  'apps/mobile/src/**/*.test.ts',
  'apps/mobile/src/**/*.test.tsx',
  'packages/**/*.test.ts',
  'packages/**/*.test.tsx',
  'packages/**/__tests__/**/*.test.ts',
  'packages/**/__tests__/**/*.test.tsx',
  'plugins/**/*.test.ts',
  'plugins/**/*.test.tsx',
  'plugins/**/__tests__/**/*.test.ts',
  'plugins/**/__tests__/**/*.test.tsx',
]

export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          alias: {
            '@cradle/ipc': resolve('packages/ipc/src/index.ts'),
            '@cradle/tabs-next': resolve('packages/tabs-next/src/index.ts'),
            '@shared': resolve('src/shared'),
          },
        },
        test: {
          name: 'node',
          globals: true,
          environment: 'node',
          include: nodeTestIncludes,
          mockReset: true,
        },
      },
      {
        extends: './apps/web/vite.config.ts',
        root: resolve('apps/web'),
        test: {
          name: 'apps/web',
          globals: true,
          environment: 'jsdom',
          include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
          mockReset: true,
        },
      },
      {
        extends: './apps/server/vitest.config.ts',
        root: resolve('apps/server'),
        test: {
          name: 'apps/server',
        },
      },
    ],
  },
})
