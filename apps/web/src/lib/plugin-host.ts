import type { Disposable, PluginDescriptor } from '@cradle/plugin-sdk'
import { derivePluginRouteSegment } from '@cradle/plugin-sdk'
import { evaluatePluginRuntimeCapabilityPolicy } from '@cradle/plugin-sdk/permissions'
import type {
  PluginNotification,
  WebPlugin,
  WebPluginContext,
  WebPluginRouteClient,
  WebPluginStorage,
} from '@cradle/plugin-sdk/web'
import { z } from 'zod'

import { toastManager } from '~/components/ui/toast'
import { readPluginDevSessions } from '~/features/plugins/api/plugin-dev'

import { getAuthenticatedEventSourceUrl, getServerUrl } from './electron'
import { usePluginStore } from './plugin-store'

type WebPluginDescriptor = Pick<PluginDescriptor, 'name' | 'version' | 'displayName' | 'hasWeb'>
  & Partial<Pick<PluginDescriptor, 'identity' | 'routeSegment' | 'layers'>>

const WebPluginActivateSchema = z.function()
  .transform(fn => fn as NonNullable<WebPlugin['activate']>)
const WebPluginDeactivateSchema = z.function()
  .transform(fn => fn as NonNullable<WebPlugin['deactivate']>)

const WebPluginModuleSchema = z.object({
  activate: WebPluginActivateSchema,
  deactivate: WebPluginDeactivateSchema.optional(),
  __cradleDevDispose: z.function().transform(fn => fn as () => void).optional(),
}).passthrough()

const WebPluginModuleWithDefaultSchema = z.union([
  WebPluginModuleSchema,
  z.object({ default: WebPluginModuleSchema }).passthrough().transform(mod => mod.default),
])

const activeWebPlugins = new Map<string, {
  deactivate?: () => void | Promise<void>
  devDispose?: () => void
  subscriptions: Disposable[]
}>()

const PluginDevSessionSchema = z.object({
  id: z.string().min(1),
  pluginName: z.string().min(1),
  routeSegment: z.string().min(1),
  entries: z.object({ web: z.string().nullable() }).passthrough(),
  revisions: z.object({ web: z.number().int().nonnegative() }).passthrough(),
}).passthrough()

const PluginDevSessionEventSchema = z.object({
  type: z.enum(['started', 'reloaded', 'stopped']),
  layer: z.enum(['server', 'web', 'desktop']).nullable(),
  session: PluginDevSessionSchema,
})

type PluginDevSession = z.infer<typeof PluginDevSessionSchema>

interface WebRuntimeCapabilityRegistration {
  type: string
  localId: string
  candidateDeclaredLocalIds?: string[]
}

function setWebLayerState(owner: string, status: 'activating' | 'active' | 'failed' | 'discovered', error?: string): void {
  usePluginStore.getState().setWebLayerState(owner, status, error)
}

function disposeSubscriptions(owner: string, subscriptions: Disposable[]): void {
  for (const subscription of [...subscriptions].reverse()) {
    try {
      subscription.dispose()
    }
 catch (err) {
      console.error(`[plugin-host] failed to dispose ${owner} web subscription:`, err)
    }
  }
  subscriptions.length = 0
}

function createWebPluginStorage(pluginName: string): WebPluginStorage {
  const prefix = `cradle-plugin:${pluginName}:`
  return {
    get(key: string) {
      return localStorage.getItem(prefix + key)
    },
    set(key: string, value: string) {
      localStorage.setItem(prefix + key, value)
    },
    delete(key: string) {
      localStorage.removeItem(prefix + key)
    },
  }
}

function normalizePluginRoutePath(path: string): string {
  const trimmed = path.trim()
  if (trimmed === '') {
    throw new Error('Plugin route path must not be empty.')
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('//')) {
    throw new Error('Plugin route path must be relative to the plugin route scope.')
  }
  if (trimmed.includes('\\')) {
    throw new Error('Plugin route path must use forward slashes.')
  }
  const normalizedPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  const pathname = normalizedPath.split(/[?#]/, 1)[0] ?? ''
  const segments = pathname.split('/')
  if (segments.some((segment) => {
    try {
      return decodeURIComponent(segment) === '..'
    }
 catch {
      return segment === '..'
    }
  })) {
    throw new Error('Plugin route path must not contain traversal segments.')
  }
  return normalizedPath
}

function createWebPluginRouteClient(pluginName: string, descriptor?: PluginDescriptor): WebPluginRouteClient {
  const routeSegment = descriptor?.routeSegment ?? derivePluginRouteSegment(descriptor?.identity ?? pluginName)
  const routeBase = `${getServerUrl().replace(/\/$/, '')}/api/plugins/${routeSegment}`
  const routeUrl = (path: string) => `${routeBase}${normalizePluginRoutePath(path)}`
  return {
    url(path) {
      return routeUrl(path)
    },
    fetch(path, init) {
      return fetch(routeUrl(path), init)
    },
  }
}

function notifyFromPlugin(pluginName: string, notification: PluginNotification): void {
  const title = notification.title.trim()
  if (!title) {
    throw new Error('Plugin notification title must not be empty.')
  }

  toastManager.add({
    id: notification.id ? `${pluginName}:${notification.id}` : undefined,
    title,
    description: notification.description,
    type: notification.type ?? 'info',
    timeout: notification.timeout,
  })
}

function validateWebRuntimeCapability(
  descriptor: PluginDescriptor | undefined,
  registration: WebRuntimeCapabilityRegistration,
): void {
  if (!descriptor) { return }
  const policy = evaluatePluginRuntimeCapabilityPolicy(descriptor, {
    type: registration.type,
    layer: 'web',
    localId: registration.localId,
    candidateDeclaredLocalIds: registration.candidateDeclaredLocalIds,
  })
  if (!policy.allowed) {
    throw new Error(policy.reason ?? `Runtime capability ${registration.type}:${registration.localId} is not allowed.`)
  }
  if (policy.warning && !descriptor.warnings.includes(policy.warning)) {
    descriptor.warnings.push(policy.warning)
  }
}

function createWebPluginContext(pluginName: string, descriptor?: PluginDescriptor): WebPluginContext {
  const store = usePluginStore.getState()
  const subscriptions: Disposable[] = []
  const routeSegment = descriptor?.routeSegment ?? derivePluginRouteSegment(descriptor?.identity ?? pluginName)
  const track = (disposable: Disposable): Disposable => {
    subscriptions.push(disposable)
    return disposable
  }
  const logger = {
    info: (msg: string, ...args: unknown[]) => console.log(`[plugin:${pluginName}]`, msg, ...args),
    warn: (msg: string, ...args: unknown[]) => console.warn(`[plugin:${pluginName}]`, msg, ...args),
    error: (msg: string, ...args: unknown[]) => console.error(`[plugin:${pluginName}]`, msg, ...args),
    debug: (msg: string, ...args: unknown[]) => console.debug(`[plugin:${pluginName}]`, msg, ...args),
  }

  return {
    routes: createWebPluginRouteClient(pluginName, descriptor),
    notifications: {
      show(notification) {
        notifyFromPlugin(pluginName, notification)
      },
    },
    subscriptions,
    panels: {
      register(panel) {
        validateWebRuntimeCapability(descriptor, {
          type: 'web-panel',
          localId: panel.id,
          candidateDeclaredLocalIds: [`panel.${panel.id}`],
        })
        const dispose = store.registerPanel(pluginName, routeSegment, panel)
        return track({ dispose })
      },
    },
    commands: {
      register(cmd) {
        validateWebRuntimeCapability(descriptor, {
          type: 'web-command',
          localId: cmd.id,
          candidateDeclaredLocalIds: [`command.${cmd.id}`],
        })
        const dispose = store.registerCommand(pluginName, cmd)
        return track({ dispose })
      },
    },
    storage: createWebPluginStorage(pluginName),
    logger,
  }
}

export async function activateWebPluginModule(
  owner: string,
  rawModule: unknown,
  descriptor?: PluginDescriptor,
): Promise<void> {
  let mod: z.infer<typeof WebPluginModuleSchema>
  try {
    mod = WebPluginModuleWithDefaultSchema.parse(rawModule)
  }
  catch {
    setWebLayerState(owner, 'failed', `Plugin ${owner} web entry does not export 'activate'`)
    throw new Error(`Plugin ${owner} web entry does not export 'activate'`)
  }

  await deactivateWebPlugin(owner)
  setWebLayerState(owner, 'activating')

  const ctx = createWebPluginContext(owner, descriptor)
  try {
    await mod.activate(ctx)
  }
 catch (err) {
    setWebLayerState(owner, 'failed', err instanceof Error ? err.message : String(err))
    disposeSubscriptions(owner, ctx.subscriptions)
    throw err
  }

  activeWebPlugins.set(owner, {
    deactivate: mod.deactivate,
    devDispose: mod.__cradleDevDispose,
    subscriptions: ctx.subscriptions,
  })
  setWebLayerState(owner, 'active')
}

export async function deactivateWebPlugin(owner: string): Promise<void> {
  const plugin = activeWebPlugins.get(owner)
  if (!plugin) { return }
  activeWebPlugins.delete(owner)
  try {
    await plugin.deactivate?.()
  }
 catch (err) {
    console.error(`[plugin-host] failed to deactivate ${owner}:`, err)
  }
  finally {
    disposeSubscriptions(owner, plugin.subscriptions)
    plugin.devDispose?.()
    setWebLayerState(owner, 'discovered')
  }
}

export async function deactivateWebPlugins(): Promise<void> {
  for (const owner of [...activeWebPlugins.keys()].reverse()) {
    await deactivateWebPlugin(owner)
  }
}

function getWebBundleRouteSegment(plugin: WebPluginDescriptor): string {
  return plugin.routeSegment ?? derivePluginRouteSegment(plugin.identity ?? plugin.name)
}

export function isWebLayerLoadable(plugin: WebPluginDescriptor): boolean {
  const status = plugin.layers?.web.status
  return plugin.hasWeb && status !== 'invalid' && status !== 'disabled' && status !== 'failed'
}

/**
 * Load and activate all web plugins.
 * Called after the React shell renders so plugin networking never blocks first paint.
 */
export async function loadWebPlugins(): Promise<void> {
  const baseUrl = getServerUrl()
  const plugins = await readPluginDescriptors()
  const webPlugins = plugins.filter(isWebLayerLoadable)

  await Promise.all(
    webPlugins.map(async (plugin) => {
      const owner = plugin.identity ?? plugin.name
      const moduleUrl = `${baseUrl}/api/plugins/${getWebBundleRouteSegment(plugin)}/web.mjs`
      try {
        setWebLayerState(owner, 'activating')
        const mod = await import(/* @vite-ignore */ moduleUrl)

        await activateWebPluginModule(owner, mod, plugin)
        console.log(`[plugin-host] activated: ${owner}`)
      }
 catch (err) {
        setWebLayerState(owner, 'failed', err instanceof Error ? err.message : String(err))
        console.error(`[plugin-host] failed to activate ${owner}:`, err)
      }
    }),
  )
}

async function readPluginDescriptors(): Promise<PluginDescriptor[]> {
  const response = await fetch(`${getServerUrl()}/api/plugins`)
  if (!response.ok) {
    throw new Error(`Failed to read plugin descriptors: HTTP ${response.status}`)
  }
  return z.array(z.custom<PluginDescriptor>()).parse(await response.json())
}

async function reloadDevelopmentWebPlugin(session: PluginDevSession): Promise<void> {
  if (!session.entries.web || session.revisions.web === 0) { return }
  const descriptor = (await readPluginDescriptors())
    .find(plugin => plugin.identity === session.pluginName)
  if (!descriptor || !isWebLayerLoadable(descriptor)) { return }

  const moduleUrl = new URL(
    `/api/plugins/${session.routeSegment}/web.mjs`,
    getServerUrl(),
  )
  moduleUrl.searchParams.set('cradleDevRevision', String(session.revisions.web))
  setWebLayerState(session.pluginName, 'activating')
  const mod = await import(/* @vite-ignore */ moduleUrl.toString())
  await activateWebPluginModule(session.pluginName, mod, descriptor)
  console.log(`[plugin-host] development web reloaded: ${session.pluginName}@${session.revisions.web}`)
}

export async function startPluginDevSessionWatcher(): Promise<() => void> {
  let source: EventSource | null = null
  let disposed = false
  const appliedRevisions = new Map<string, number>()
  let reconcileQueue = Promise.resolve()

  const reconcile = (session: PluginDevSession): void => {
    if (!session.entries.web || appliedRevisions.get(session.id) === session.revisions.web) { return }
    appliedRevisions.set(session.id, session.revisions.web)
    reconcileQueue = reconcileQueue
      .then(() => reloadDevelopmentWebPlugin(session))
      .catch((error: unknown) => {
        appliedRevisions.delete(session.id)
        setWebLayerState(session.pluginName, 'failed', error instanceof Error ? error.message : String(error))
        console.error(`[plugin-host] development reload failed for ${session.pluginName}:`, error)
      })
  }

  const sessions = z.array(PluginDevSessionSchema).parse(await readPluginDevSessions())
  for (const session of sessions) { reconcile(session) }

  const eventsUrl = await getAuthenticatedEventSourceUrl('/plugins/dev-sessions/events')
  if (disposed) { return () => undefined }
  source = new EventSource(eventsUrl)
  source.onmessage = (message) => {
    const event = PluginDevSessionEventSchema.parse(JSON.parse(message.data))
    if (event.type === 'stopped') {
      appliedRevisions.delete(event.session.id)
      void deactivateWebPlugin(event.session.pluginName)
      return
    }
    if (event.type === 'started' || event.layer === 'web') {
      reconcile(event.session)
    }
  }
  source.onerror = () => {
    console.warn('[plugin-host] plugin development event stream disconnected; EventSource will retry')
  }

  return () => {
    disposed = true
    source?.close()
  }
}
