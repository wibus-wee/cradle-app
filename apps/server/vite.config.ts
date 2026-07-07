import { builtinModules, createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import swc from 'unplugin-swc'
import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const desktopRuntimeExternals = require('./desktop-runtime.externals.json') as {
  packages?: string[]
}

const NODE_BUILT_IN_MODULES = new Set(builtinModules
  .filter(moduleName => !moduleName.startsWith('_'))
  .flatMap(moduleName => [moduleName, `node:${moduleName}`]))
const SERVER_EXTERNAL_DEPENDENCIES = desktopRuntimeExternals.packages ?? []

function isExternalDependency(id: string): boolean {
  return SERVER_EXTERNAL_DEPENDENCIES.some(packageName => (
    id === packageName || id.startsWith(`${packageName}/`)
  ))
}

export default defineConfig({
  plugins: [tsconfigPaths(), swc.vite()],
  esbuild: false,
  ssr: {
    noExternal: true,
  },
  build: {
    ssr: true,
    rollupOptions: {
      external: (id) => {
        return NODE_BUILT_IN_MODULES.has(id) || isExternalDependency(id)
      },
      input: {
        'main': resolve(__dirname, 'src/index.ts'),
        'managed-process-runner': resolve(__dirname, 'src/infra/managed-process-runner.ts'),
      },
    },
  },
})
