import { builtinModules, createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'electron-vite'

const fixtureRoot = dirname(fileURLToPath(import.meta.url))
const desktopRoot = resolve(fixtureRoot, '../../../../..')
const repositoryRoot = resolve(desktopRoot, '../..')
const rootRequire = createRequire(resolve(repositoryRoot, 'package.json'))
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
      outDir: resolve(desktopRoot, 'dist/m0/main'),
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
      outDir: resolve(desktopRoot, 'dist/m0/preload'),
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
    resolve: {
      alias: [
        { find: 'react/jsx-runtime', replacement: rootRequire.resolve('react/jsx-runtime') },
        { find: 'react/jsx-dev-runtime', replacement: rootRequire.resolve('react/jsx-dev-runtime') },
        { find: 'react-dom/client', replacement: rootRequire.resolve('react-dom/client') },
        { find: 'react-dom', replacement: rootRequire.resolve('react-dom') },
        { find: 'react', replacement: rootRequire.resolve('react') },
      ],
    },
    build: {
      outDir: resolve(desktopRoot, 'dist/m0/renderer'),
      rollupOptions: {
        input: {
          index: resolve(fixtureRoot, 'renderer/index.html'),
          partition: resolve(fixtureRoot, 'renderer/partition.html'),
        },
      },
    },
  },
})
