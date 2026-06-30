import { builtinModules } from 'node:module'
import { resolve } from 'node:path'

import { defineConfig } from 'vite'

const nodeRuntimeExternals = [
  ...builtinModules,
  ...builtinModules.map(moduleName => `node:${moduleName}`),
]

export default defineConfig({
  build: {
    emptyOutDir: true,
    minify: false,
    outDir: 'dist',
    rollupOptions: {
      external: nodeRuntimeExternals,
      output: {
        banner: '#!/usr/bin/env node',
        entryFileNames: 'index.js',
        format: 'es',
      },
      treeshake: false,
    },
    sourcemap: true,
    ssr: resolve(__dirname, 'src/index.ts'),
    target: 'node22',
  },
  ssr: {
    noExternal: true,
  },
})
