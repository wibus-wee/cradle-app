import { readFileSync } from 'node:fs'
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
const packageJson: { version: string } = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'))
const desktopUpdateUrl = process.env.CRADLE_DESKTOP_UPDATE_URL ?? ''
const isE2E = process.env.CRADLE_E2E === '1'
const nodeRuntimeExternals = [
  ...builtinModules,
  ...builtinModules.map(moduleName => `node:${moduleName}`),
  'electron',
]

/** Observability keys that may be baked into packaged main-process defaults. */
const PACKAGED_OBSERVABILITY_ENV_KEYS = [
  'CRADLE_OTEL_ENABLED',
  'CRADLE_OTEL_TRACES_ENABLED',
  'CRADLE_POSTHOG_AI_OBSERVABILITY_ENABLED',
  'CRADLE_POSTHOG_AI_CAPTURE_MODE',
  'CRADLE_POSTHOG_PROJECT_TOKEN',
  'CRADLE_POSTHOG_HOST',
] as const

function readPackagedObservabilityEnv(): Record<string, string> {
  const baked: Record<string, string> = {}
  for (const key of PACKAGED_OBSERVABILITY_ENV_KEYS) {
    const value = process.env[key]?.trim()
    if (value) {
      baked[key] = value
    }
  }

  // Only bake AI Observability when explicitly enabled for this build.
  if (baked.CRADLE_POSTHOG_AI_OBSERVABILITY_ENABLED !== '1') {
    return {}
  }

  return baked
}

export default defineConfig({
  main: {
    ssr: {
      noExternal: true,
    },
    define: {
      __CRADLE_DESKTOP_UPDATE_URL__: JSON.stringify(desktopUpdateUrl),
      __CRADLE_DESKTOP_PACKAGED_OBSERVABILITY_ENV__: JSON.stringify(readPackagedObservabilityEnv()),
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
    envDir: webRoot,
    define: {
      'import.meta.env.PACKAGE_VERSION': JSON.stringify(packageJson.version),
      'import.meta.env.CRADLE_E2E': JSON.stringify(isE2E ? '1' : '0'),
    },
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
