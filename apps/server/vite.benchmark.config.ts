import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'

import serverConfig from './vite.config'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const sourceDirectory = process.env.CRADLE_BENCH_SOURCE_DIR
  ? resolve(process.env.CRADLE_BENCH_SOURCE_DIR)
  : currentDirectory

export default defineConfig({
  ...serverConfig,
  build: {
    ...serverConfig.build,
    outDir: process.env.CRADLE_BENCH_OUT_DIR ?? 'dist-benchmark',
    emptyOutDir: true,
    rollupOptions: {
      ...serverConfig.build?.rollupOptions,
      input: {
        'benchmark-app': resolve(sourceDirectory, 'src/benchmark-entry.ts'),
      },
    },
  },
})
