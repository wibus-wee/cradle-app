import { resolve } from 'node:path'

import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    // This plugin runs server-side (Node.js). Excluding the "browser"
    // export condition prevents libraries like decode-named-character-reference
    // from resolving to their DOM variant (index.dom.js) which references
    // `document.createElement` — unavailable in Node.
    conditions: ['node', 'default', 'import'],
  },
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
        '@slack/bolt',
        '@slack/bolt/dist/App',
        '@slack/bolt/dist/index',
      ],
    },
    target: 'node20',
    minify: false,
    outDir: 'dist',
  },
})
