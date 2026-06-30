import { resolve } from 'node:path'

import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: {
        'mcp-server': resolve(__dirname, 'src/mcp-server.ts'),
        'server': resolve(__dirname, 'src/server.ts'),
        'desktop': resolve(__dirname, 'src/desktop.ts'),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.mjs`,
    },
    rollupOptions: {
      external: [
        /^node:/,
        'net',
        'path',
        'os',
        'fs',
        'crypto',
        'stream',
        'events',
        'util',
        '@cradle/plugin-sdk/server',
        '@cradle/plugin-sdk/desktop',
      ],
    },
    target: 'node20',
    minify: false,
    outDir: 'dist',
  },
})
