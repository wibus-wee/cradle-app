import { builtinModules } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { pluginImportMap } from '@cradle/plugin-sdk/vite-plugin-import-map'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const __dirname = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(__dirname, '../web')
const desktopUpdateUrl = process.env.CRADLE_DESKTOP_UPDATE_URL ?? ''
const nodeRuntimeExternals = [
  ...builtinModules,
  ...builtinModules.map(moduleName => `node:${moduleName}`),
  'electron',
]

export default defineConfig({
  main: {
    ssr: {
      noExternal: true,
    },
    define: {
      __CRADLE_DESKTOP_UPDATE_URL__: JSON.stringify(desktopUpdateUrl),
    },
    build: {
      externalizeDeps: false,
      outDir: resolve(__dirname, 'dist/main'),
      rollupOptions: {
        external: nodeRuntimeExternals,
        input: {
          'index': resolve(__dirname, 'src/main/index.ts'),
          'managed-process-runner': resolve(__dirname, 'src/main/managed-process-runner.ts'),
        },
        output: {
          entryFileNames: '[name].js',
        },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      outDir: resolve(__dirname, 'dist/preload'),
      rollupOptions: {
        external: nodeRuntimeExternals,
        input: {
          'index': resolve(__dirname, 'src/preload/index.ts'),
          'browser-panel': resolve(__dirname, 'src/preload/browser-panel.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
        },
      },
    },
  },
  renderer: {
    root: webRoot,
    plugins: [
      tailwindcss(),
      tanstackRouter({
        target: 'react',
        autoCodeSplitting: true,
      }),
      viteReact({
        babel: {
          plugins: ['babel-plugin-react-compiler'],
        },
      }),
      pluginImportMap(),
    ],
    resolve: {
      alias: {
        '~': resolve(webRoot, 'src'),
      },
    },
    build: {
      outDir: resolve(__dirname, 'dist/renderer'),
      rollupOptions: {
        input: {
          main: resolve(webRoot, 'index.html'),
          tearoff: resolve(webRoot, 'tearoff.html'),
        },
      },
    },
    worker: {
      format: 'es',
    },
  },
})
