/* Builds the CC Switch external provider source plugin for packaged desktop use. */

import { resolve } from 'node:path'

import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: {
        server: resolve(__dirname, 'src/server.ts'),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.mjs`,
    },
    rollupOptions: {
      external: [
        /^node:/,
        '@cradle/plugin-sdk/server',
        'better-sqlite3',
      ],
    },
    target: 'node20',
    minify: false,
    outDir: 'dist',
  },
})
