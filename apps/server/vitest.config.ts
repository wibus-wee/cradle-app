import swc from 'unplugin-swc'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./vitest.global-setup.ts'],
    setupFiles: ['./vitest.setup.ts'],
    maxConcurrency: 1,
    // Cold SWC transforms + first infra import regularly exceed Vitest defaults
    // (5s tests / 10s hooks) on this package; keep suite shutdown from failing green tests.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  esbuild: false,
  plugins: [tsconfigPaths(), swc.vite()],
})
