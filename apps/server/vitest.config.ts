import swc from 'unplugin-swc'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    maxConcurrency: 1,
  },
  esbuild: false,
  plugins: [tsconfigPaths(), swc.vite()],
})
