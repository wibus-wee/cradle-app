import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import type { PluginManifest } from '@cradle/plugin-sdk'
import { init, parse } from 'es-module-lexer'

import { getPluginDescriptorByRouteSegment, listPluginDescriptors, setPluginLayerState, setPluginSourceDescriptor } from './runtime-registry'
import { evaluatePluginSourceTrust } from './trust-policy'

const sharedDependencyRoutes = {
  'react': 'react.mjs',
  'react-dom': 'react-dom.mjs',
  'react/jsx-runtime': 'react-jsx-runtime.mjs',
  'react/jsx-dev-runtime': 'react-jsx-dev-runtime.mjs',
  'react-dom/client': 'react-dom-client.mjs',
} as const

const sharedDependencySpecifiers = new Map<string, string>(
  Object.entries(sharedDependencyRoutes),
)

const sharedDependencyRegistryKeys = new Map<string, string>(
  Object.entries(sharedDependencyRoutes).map(([specifier, fileName]) => [fileName, specifier]),
)

const sharedDependencyNamedExports: Record<string, string[]> = {
  'react': [
    'Activity',
    'Children',
    'Component',
    'Fragment',
    'Profiler',
    'PureComponent',
    'StrictMode',
    'Suspense',
    'act',
    'cache',
    'captureOwnerStack',
    'cloneElement',
    'createContext',
    'createElement',
    'createRef',
    'experimental_useEffectEvent',
    'forwardRef',
    'isValidElement',
    'lazy',
    'memo',
    'startTransition',
    'unstable_useCacheRefresh',
    'use',
    'useActionState',
    'useCallback',
    'useContext',
    'useDebugValue',
    'useDeferredValue',
    'useEffect',
    'useId',
    'useImperativeHandle',
    'useInsertionEffect',
    'useLayoutEffect',
    'useMemo',
    'useOptimistic',
    'useReducer',
    'useRef',
    'useState',
    'useSyncExternalStore',
    'useTransition',
    'version',
  ],
  'react-dom': [
    'createPortal',
    'flushSync',
    'preconnect',
    'prefetchDNS',
    'preinit',
    'preinitModule',
    'preload',
    'preloadModule',
    'requestFormReset',
    'unstable_batchedUpdates',
    'useFormState',
    'useFormStatus',
    'version',
  ],
  'react/jsx-runtime': ['Fragment', 'jsx', 'jsxs'],
  'react/jsx-dev-runtime': ['Fragment', 'jsxDEV'],
  'react-dom/client': ['createRoot', 'hydrateRoot', 'version'],
}

function createSharedDependencyUrl(requestUrl: string, fileName: string): string {
  return new URL(`/api/plugins/-/deps/${fileName}`, requestUrl).toString()
}

function buildSharedDependencyWrapper(registryKey: string): string {
  const namedExports = sharedDependencyNamedExports[registryKey] ?? []
  const exportLines = namedExports
    .map(exportName => `export const ${exportName} = __mod.${exportName};`)
    .join('\n')
  return [
    `const __registry = window[Symbol.for('cradle:modules')];`,
    `const __mod = __registry?.[${JSON.stringify(registryKey)}];`,
    `if (!__mod) { throw new Error(${JSON.stringify(`Cradle shared module is not available: ${registryKey}`)}); }`,
    `export default __mod;`,
    exportLines,
    '',
  ].filter(Boolean).join('\n')
}

export async function rewritePluginWebBundleImports(source: string, requestUrl: string): Promise<string> {
  await init
  const [imports] = parse(source)
  let rewritten = ''
  let cursor = 0
  for (const importRecord of imports) {
    if (importRecord.n === undefined) { continue }
    const fileName = sharedDependencySpecifiers.get(importRecord.n)
    if (!fileName) { continue }
    rewritten += source.slice(cursor, importRecord.s)
    rewritten += createSharedDependencyUrl(requestUrl, fileName)
    cursor = importRecord.e
  }
  if (cursor === 0) { return source }
  return rewritten + source.slice(cursor)
}

/**
 * Creates a plugin static server that serves web plugin entries as static assets.
 * GET /api/plugins/:name/web.mjs → returns the plugin's web bundle
 * GET /api/plugins → returns list of active plugins
 */
export function createPluginStaticServer(readManifests: () => PluginManifest[]) {
  return {
    async getWebEntry(pluginName: string): Promise<string | null> {
      const manifests = readManifests()
      const descriptor = getPluginDescriptorByRouteSegment(pluginName)
      if (descriptor?.layers.web.status === 'invalid' || descriptor?.layers.web.status === 'disabled') {
        return null
      }
      const manifest = descriptor
        ? manifests.find(m => m.name === descriptor.identity)
        : manifests.find(m => m.name === pluginName)
      if (!manifest?.cradle.web) { return null }
      if (descriptor) {
        try {
          const source = await evaluatePluginSourceTrust({
            pluginName: descriptor.identity,
            source: descriptor.source,
          })
          setPluginSourceDescriptor(descriptor.identity, source)
          if (!source.trusted) {
            setPluginLayerState(descriptor.identity, 'web', 'disabled', source.reason ?? 'Plugin source is not trusted.')
            return null
          }
        }
        catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          setPluginLayerState(descriptor.identity, 'web', 'failed', message)
          return null
        }
      }
      const entryPath = resolve(manifest.packageDir, manifest.cradle.web)
      if (existsSync(entryPath)) {
        return entryPath
      }

      setPluginLayerState(manifest.name, 'web', 'failed', `Web entry is missing: ${manifest.cradle.web}`)
      return null
    },
    getPluginList() {
      return listPluginDescriptors()
    },
    getSharedDependency(fileName: string): string | null {
      const registryKey = sharedDependencyRegistryKeys.get(fileName)
      return registryKey ? buildSharedDependencyWrapper(registryKey) : null
    },
  }
}
