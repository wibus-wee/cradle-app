import { builtinModules } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'electron-vite'

const fixtureRoot = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(fixtureRoot, '../../..')
const nodeExternals = [
  ...builtinModules,
  ...builtinModules.map(moduleName => `node:${moduleName}`),
  'electron',
]

export default defineConfig({
  main: {
    ssr: { noExternal: true },
    build: {
      externalizeDeps: false,
      outDir: resolve(desktopRoot, 'dist/server-fetch-smoke/main'),
      rollupOptions: {
        external: nodeExternals,
        input: { index: resolve(fixtureRoot, 'main.ts') },
        output: { entryFileNames: '[name].js' },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      outDir: resolve(desktopRoot, 'dist/server-fetch-smoke/preload'),
      rollupOptions: {
        external: nodeExternals,
        input: { index: resolve(fixtureRoot, 'preload.ts') },
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
  renderer: {
    root: resolve(fixtureRoot, 'renderer'),
    base: './',
    build: {
      outDir: resolve(desktopRoot, 'dist/server-fetch-smoke/renderer'),
      rollupOptions: { input: resolve(fixtureRoot, 'renderer/index.html') },
    },
  },
})
