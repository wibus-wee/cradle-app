import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, delimiter, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type { Disposable, PluginDescriptor, PluginLayer, PluginManifest, PluginSourceDescriptor, PluginSourceKind } from '@cradle/plugin-sdk'
import { evaluatePluginPermissionPolicy } from '@cradle/plugin-sdk/permissions'
import type { ServerPluginRouteContext } from '@cradle/plugin-sdk/server'
import { Elysia } from 'elysia'

import { createChildLogger } from '../logging/logger'
import {
  stopAllConversationBridgeConnections,
  stopConversationBridgeConnectionsForOwner,
} from '../modules/conversation-bridge/runtime-supervisor'
import { readPluginActivationPolicy, setPluginActivationPolicy } from './activation-policy'
import { createServerPluginContext } from './context'
import { resetConversationBridgeAdapterRegistry } from './conversation-adapter-registry'
import type { DiscoveredPluginPackage } from './discovery'
import { discoverPluginPackages } from './discovery'
import { resetExternalIssueSourceRegistry } from './external-issue-source-registry'
import { resetExternalProviderSourceRegistry } from './external-provider-source-registry'
import { clearPluginRoutes, dispatchPluginRoute, resetPluginRouteRegistry } from './route-registry'
import {
  classifyPluginSource,
  createInvalidPluginDescriptor,
  createPluginDescriptor,
  getPluginDescriptor,
  listPluginDescriptors,
  registerPluginDescriptor,
  resetPluginRuntimeRegistry,
  setPluginActivationState,
  setPluginLayerState,
} from './runtime-registry'
import { resetPluginSkillRegistry } from './skill-registry'
import { createPluginStaticServer, rewritePluginWebBundleImports } from './static-server'
import { validatePluginModule } from './validation'

interface ActivePlugin {
  deactivate?: () => void | Promise<void>
  subscriptions: Disposable[]
}

const layerNames: PluginLayer[] = ['server', 'web', 'desktop']
const activePlugins = new Map<string, ActivePlugin>()
const discoveredPluginManifests = new Map<string, PluginManifest>()
const logger = createChildLogger({ module: 'plugins' })

interface PluginRouteDispatcherContext {
  params: {
    'routeSegment': string
    '*'?: string
  }
  request: Request
  body: unknown
  query: Record<string, unknown>
  headers: Record<string, string | undefined>
  set: {
    status?: number | string
    headers: Record<string, string | number>
  }
}

interface PluginDiscoverySource {
  pluginsDir: string
  kind?: PluginSourceKind
  trustMarketplaceGrants?: boolean
}

interface PackageWithSource {
  pkg: DiscoveredPluginPackage
  source: PluginSourceDescriptor
}

function readPrimaryPluginSourceKind(): PluginSourceKind | undefined {
  const value = process.env.CRADLE_PLUGINS_SOURCE_KIND
  if (value === 'workspaceDev' || value === 'bundledResource' || value === 'externalLocal') {
    return value
  }
  return process.env.CRADLE_PLUGINS_DIR ? 'externalLocal' : undefined
}

function readMarketplacePluginsDir(): string | undefined {
  const value = process.env.CRADLE_MARKETPLACE_PLUGINS_DIR?.trim()
  return value ? resolve(value) : undefined
}

function getPluginDiscoverySources(defaultPluginsDir: string): PluginDiscoverySource[] {
  const marketplacePluginsDir = readMarketplacePluginsDir()
  const externalDirs = (process.env.CRADLE_EXTERNAL_PLUGINS_DIRS ?? '')
    .split(delimiter)
    .map(dir => dir.trim())
    .filter(Boolean)

  const sources: PluginDiscoverySource[] = []
  const addSource = (pluginsDir: string, kind?: PluginSourceKind): void => {
    const normalizedDir = resolve(pluginsDir)
    if (sources.some(source => resolve(source.pluginsDir) === normalizedDir)) { return }
    sources.push({
      pluginsDir,
      kind,
      trustMarketplaceGrants: marketplacePluginsDir === normalizedDir,
    })
  }

  addSource(defaultPluginsDir, readPrimaryPluginSourceKind())
  for (const pluginsDir of externalDirs) {
    addSource(pluginsDir, 'externalLocal')
  }
  return sources
}

async function discoverPackagesFromSources(sources: PluginDiscoverySource[]): Promise<PackageWithSource[]> {
  const packages: PackageWithSource[] = []
  for (const source of sources) {
    const discovered = await discoverPluginPackages(source.pluginsDir)
    for (const pkg of discovered) {
      packages.push({
        pkg,
        source: {
          ...classifyPluginSource(pkg.packageDir, source.pluginsDir, source.kind),
          provenance: pkg.provenance,
          grantedPermissions: source.trustMarketplaceGrants ? pkg.provenance?.grantedPermissions : undefined,
        },
      })
    }
  }
  return packages
}

function disposeSubscriptions(name: string, subscriptions: Disposable[]): void {
  for (const subscription of [...subscriptions].reverse()) {
    try {
      subscription.dispose()
    }
 catch (err) {
      logger.error('plugin subscription disposal failed', { plugin: name, err })
    }
  }
  subscriptions.length = 0
}

function toDisabledReason(reason: string | null | undefined): string {
  return reason?.trim() || 'Disabled by user.'
}

function refreshPluginActivationState(pluginName: string): boolean {
  const policy = readPluginActivationPolicy(pluginName)
  setPluginActivationState(pluginName, policy
    ? {
        enabled: policy.enabled,
        source: 'user',
        reason: policy.reason ?? undefined,
        updatedAt: policy.updatedAt,
      }
    : { enabled: true, source: 'default' })
  return policy?.enabled ?? true
}

function markPluginLayersDisabled(manifest: PluginManifest, reason: string): void {
  for (const layer of layerNames) {
    if (manifest.cradle[layer] && getPluginDescriptor(manifest.name)?.layers[layer].status !== 'invalid') {
      setPluginLayerState(manifest.name, layer, 'disabled', reason)
    }
  }
}

function resetDiscoveredPluginLayers(manifest: PluginManifest): void {
  for (const layer of layerNames) {
    if (manifest.cradle[layer] && getPluginDescriptor(manifest.name)?.layers[layer].status !== 'invalid') {
      setPluginLayerState(manifest.name, layer, 'discovered')
    }
  }
}

function preparePluginWebLayer(manifest: PluginManifest): void {
  if (!manifest.cradle.web) { return }
  const descriptor = getPluginDescriptor(manifest.name)
  if (!descriptor || descriptor.layers.web.status === 'invalid') { return }
  setPluginLayerState(manifest.name, 'web', 'discovered')
  const entryPath = resolve(manifest.packageDir, manifest.cradle.web)
  if (!existsSync(entryPath)) {
    setPluginLayerState(manifest.name, 'web', 'failed', `Web entry is missing: ${manifest.cradle.web}`)
    logger.error('plugin web entry missing', { plugin: manifest.name, entryPath })
    return
  }
  const permissionDecision = evaluatePluginPermissionPolicy(descriptor, 'web', process.env)
  if (!permissionDecision.allowed) {
    setPluginLayerState(manifest.name, 'web', 'disabled', permissionDecision.reason)
    logger.warn('plugin web layer disabled by permission policy', {
      plugin: manifest.name,
      missingRequiredPermissions: permissionDecision.missingRequiredPermissions,
    })
  }
}

async function deactivatePluginServerLayer(pluginName: string): Promise<void> {
  const plugin = activePlugins.get(pluginName)
  activePlugins.delete(pluginName)
  try {
    await stopConversationBridgeConnectionsForOwner(pluginName)
  }
  catch (err) {
    logger.error('conversation bridge plugin runtime stop failed', { plugin: pluginName, err })
  }
  if (plugin) {
    try {
      await plugin.deactivate?.()
    }
 catch (err) {
      logger.error('plugin deactivation failed', { plugin: pluginName, err })
    }
 finally {
      disposeSubscriptions(pluginName, plugin.subscriptions)
    }
  }
  clearPluginRoutes(pluginName)
}

async function activatePluginServerLayer(manifest: PluginManifest): Promise<void> {
  if (!manifest.cradle.server) { return }
  const descriptor = getPluginDescriptor(manifest.name)
  if (!descriptor || descriptor.layers.server.status === 'invalid') { return }
  if (activePlugins.has(manifest.name)) { return }

  const permissionDecision = evaluatePluginPermissionPolicy(descriptor, 'server', process.env)
  if (!permissionDecision.allowed) {
    setPluginLayerState(manifest.name, 'server', 'disabled', permissionDecision.reason)
    logger.warn('plugin server layer disabled by permission policy', {
      plugin: manifest.name,
      missingRequiredPermissions: permissionDecision.missingRequiredPermissions,
    })
    return
  }

  const entryPath = resolve(manifest.packageDir, manifest.cradle.server)
  let subscriptions: Disposable[] = []
  try {
    setPluginLayerState(manifest.name, 'server', 'activating')
    const mod = await import(pathToFileURL(entryPath).href)
    validatePluginModule(mod, manifest.name, 'server')

    const ctx = createServerPluginContext(manifest, { routeSegment: descriptor.routeSegment })
    subscriptions = ctx.subscriptions
    await mod.activate(ctx)

    activePlugins.set(manifest.name, {
      deactivate: mod.deactivate as (() => void | Promise<void>) | undefined,
      subscriptions: ctx.subscriptions,
    })
    setPluginLayerState(manifest.name, 'server', 'active')
    logger.info('plugin activated', { plugin: manifest.name })
  }
 catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    setPluginLayerState(manifest.name, 'server', 'failed', message)
    disposeSubscriptions(manifest.name, subscriptions)
    clearPluginRoutes(manifest.name)
    logger.error('plugin activation failed', { plugin: manifest.name, err })
  }
}

export async function activateServerPlugins(app: Elysia): Promise<void> {
  for (const pluginName of [...activePlugins.keys()]) {
    await deactivatePluginServerLayer(pluginName)
  }
  resetPluginSkillRegistry()
  discoveredPluginManifests.clear()

  // Discover from plugins/ relative to workspace root
  // In dev: CRADLE_PLUGINS_DIR env or traverse up from this file. In prod: process.resourcesPath or cwd
  const thisDir = dirname(fileURLToPath(import.meta.url))
  const pluginsDir = process.env.CRADLE_PLUGINS_DIR
    ?? resolve(thisDir, '../../../../plugins')
  const packages = await discoverPackagesFromSources(getPluginDiscoverySources(pluginsDir))
  resetPluginRuntimeRegistry()
  resetPluginRouteRegistry()
  resetExternalProviderSourceRegistry()
  resetExternalIssueSourceRegistry()
  resetConversationBridgeAdapterRegistry()

  for (const { pkg, source } of packages) {
    if (!pkg.manifest) {
      const identity = `invalid:${basename(pkg.packageDir)}`
      registerPluginDescriptor(createInvalidPluginDescriptor(identity, '0.0.0', source, pkg.error ?? 'Invalid plugin package.'))
      continue
    }
    registerPluginDescriptor(createPluginDescriptor(pkg.manifest, source))
    discoveredPluginManifests.set(pkg.manifest.name, pkg.manifest)
  }

  const descriptors = listPluginDescriptors()
  const manifests: PluginManifest[] = packages.flatMap(({ pkg }) => pkg.manifest ? [pkg.manifest] : [])

  if (descriptors.length === 0) { return }

  for (const manifest of manifests) {
    const descriptor = getPluginDescriptor(manifest.name)
    if (!descriptor) { continue }
    const enabled = refreshPluginActivationState(manifest.name)
    if (!enabled) {
      markPluginLayersDisabled(manifest, toDisabledReason(descriptor.activation.reason))
      continue
    }
    preparePluginWebLayer(manifest)
  }

  for (const manifest of manifests) {
    if (!getPluginDescriptor(manifest.name)?.activation.enabled) { continue }
    await activatePluginServerLayer(manifest)
  }

  // Plugin static server — serves web entries + plugin list API
  const staticServer = createPluginStaticServer(manifests)

  const pluginRoutes = new Elysia({ prefix: '/api/plugins' })
    .get('/', () => staticServer.getPluginList())
    .get('/-/deps/:fileName', ({ params, set }) => {
      const content = staticServer.getSharedDependency(params.fileName)
      if (!content) {
        set.status = 404
        return 'Not found'
      }
      return new Response(content, {
        headers: {
          'access-control-allow-origin': '*',
          'cache-control': 'no-cache',
          'content-type': 'application/javascript; charset=utf-8',
        },
      })
    })
    .get('/:name/web.mjs', async ({ params, request, set }) => {
      const entryPath = staticServer.getWebEntry(params.name)
      if (!entryPath) {
        set.status = 404
        return 'Not found'
      }
      const content = await rewritePluginWebBundleImports(
        await readFile(entryPath, 'utf-8'),
        request.url,
      )
      return new Response(content, {
        headers: {
          'access-control-allow-origin': '*',
          'cache-control': 'no-cache',
          'content-type': 'application/javascript; charset=utf-8',
        },
      })
    })
    .all('/:routeSegment', context => dispatchPluginRouteFromElysia(context, '/'))
    .all('/:routeSegment/*', context => dispatchPluginRouteFromElysia(
      context,
      `/${context.params['*'] ?? ''}`,
    ))

  app.use(pluginRoutes)
}

async function dispatchPluginRouteFromElysia(
  context: PluginRouteDispatcherContext,
  path: string,
): Promise<unknown> {
  const pluginSet: ServerPluginRouteContext['set'] = {}
  const result = await dispatchPluginRoute({
    routeSegment: context.params.routeSegment,
    method: context.request.method,
    path,
    body: context.body,
    query: context.query,
    headers: context.headers,
    set: pluginSet,
  })
  if (pluginSet.status !== undefined) {
    context.set.status = pluginSet.status
  }
  if (pluginSet.headers) {
    Object.assign(context.set.headers, pluginSet.headers)
  }
  if (!result.found) {
    context.set.status = 404
    return { error: 'Plugin route not found.' }
  }
  return result.body
}

function requirePluginDescriptor(pluginName: string): PluginDescriptor {
  const descriptor = getPluginDescriptor(pluginName)
  if (!descriptor) {
    throw new Error(`Plugin not found: ${pluginName}`)
  }
  return descriptor
}

function requirePluginManifest(pluginName: string): PluginManifest {
  const manifest = discoveredPluginManifests.get(pluginName)
  if (!manifest) {
    throw new Error(`Plugin manifest not found: ${pluginName}`)
  }
  return manifest
}

export async function disablePlugin(pluginName: string, reason?: string): Promise<PluginDescriptor> {
  const descriptor = requirePluginDescriptor(pluginName)
  const manifest = requirePluginManifest(descriptor.identity)
  const policy = setPluginActivationPolicy(descriptor.identity, {
    enabled: false,
    reason: toDisabledReason(reason),
  })
  setPluginActivationState(descriptor.identity, {
    enabled: false,
    source: 'user',
    reason: policy.reason ?? undefined,
    updatedAt: policy.updatedAt,
  })

  await deactivatePluginServerLayer(descriptor.identity)
  markPluginLayersDisabled(manifest, toDisabledReason(policy.reason))
  return requirePluginDescriptor(descriptor.identity)
}

export async function enablePlugin(pluginName: string): Promise<PluginDescriptor> {
  const descriptor = requirePluginDescriptor(pluginName)
  const manifest = requirePluginManifest(descriptor.identity)
  const policy = setPluginActivationPolicy(descriptor.identity, {
    enabled: true,
    reason: null,
  })
  setPluginActivationState(descriptor.identity, {
    enabled: true,
    source: 'user',
    updatedAt: policy.updatedAt,
  })

  await deactivatePluginServerLayer(descriptor.identity)
  resetDiscoveredPluginLayers(manifest)
  preparePluginWebLayer(manifest)
  await activatePluginServerLayer(manifest)
  return requirePluginDescriptor(descriptor.identity)
}

export async function deactivateAllPlugins(): Promise<void> {
  await stopAllConversationBridgeConnections()
  for (const name of [...activePlugins.keys()]) {
    await deactivatePluginServerLayer(name)
  }
  activePlugins.clear()
  resetPluginSkillRegistry()
  resetPluginRouteRegistry()
  resetExternalProviderSourceRegistry()
  resetExternalIssueSourceRegistry()
  resetConversationBridgeAdapterRegistry()
}
