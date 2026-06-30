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
        // @slack/bolt is CJS; bundling it forces rolldown to emit `__require("node:...")`
        // calls inside a CJS wrapper, which throw in our pure-ESM runtime. Letting Node's
        // native CJS↔ESM interop load it avoids the `Calling require for ...` error.
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
