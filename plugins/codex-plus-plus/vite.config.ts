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
      ],
    },
    target: 'node20',
    minify: false,
    outDir: 'dist',
  },
})
