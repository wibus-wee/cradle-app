import { ipcMain } from 'electron'
import { z } from 'zod'

import {
  activateDevelopmentDesktopPlugin,
  deactivateDevelopmentDesktopPlugin,
  deactivateOneDesktopPlugin,
  discoverAndActivateDesktopPluginSource,
} from './plugin-loader'

const PLUGINS_SYNC_SOURCE_CHANNEL = 'desktop:plugins-sync-source'
const PLUGINS_UNSYNC_SOURCE_CHANNEL = 'desktop:plugins-unsync-source'

const PluginSourcePluginSchema = z.object({
  identity: z.string(),
  hasDesktop: z.boolean(),
  activation: z.object({ enabled: z.boolean() }),
  source: z.object({
    trusted: z.boolean(),
    grantedPermissions: z.array(z.string()),
  }),
  layers: z.object({
    desktop: z.object({
      status: z.enum(['discovered', 'invalid', 'skipped', 'disabled', 'activating', 'active', 'failed', 'partial']),
    }),
  }),
})

const PluginSourceSchema = z.object({
  id: z.string(),
  resolvedDirectory: z.string().nullable(),
  plugins: z.array(PluginSourcePluginSchema),
})

const PluginSourcesSchema = z.array(PluginSourceSchema)
const PluginLifecycleEventSchema = z.object({
  type: z.enum([
    'source-installed',
    'source-updated',
    'source-refreshed',
    'source-removed',
    'activation-changed',
    'review-completed',
  ]),
  pluginIdentities: z.array(z.string().min(1)),
})

const PluginDevSessionSchema = z.object({
  id: z.string().min(1),
  pluginName: z.string().min(1),
  packageDir: z.string().min(1),
  entries: z.object({ desktop: z.string().nullable() }).passthrough(),
  revisions: z.object({ desktop: z.number().int().nonnegative() }).passthrough(),
}).passthrough()

const PluginDevSessionsSchema = z.array(PluginDevSessionSchema)
const PluginDevSessionEventSchema = z.object({
  type: z.enum(['started', 'reloaded', 'stopped']),
  layer: z.enum(['server', 'web', 'desktop']).nullable(),
  session: PluginDevSessionSchema,
})
const PluginEventSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('lifecycle'), event: PluginLifecycleEventSchema }),
  z.object({ scope: z.literal('dev-session'), event: PluginDevSessionEventSchema }),
])

type PluginSourceView = z.infer<typeof PluginSourceSchema>

let serverUrl: string | null = null
let ipcHandlersRegistered = false
const persistedSourcePlugins = new Map<string, Set<string>>()

export function setPluginSourceSyncServerUrl(url: string): void {
  serverUrl = url
}

function requireServerUrl(): string {
  if (!serverUrl) {
    throw new Error('Plugin source sync server URL is not available.')
  }
  return serverUrl
}

async function fetchJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(new URL(path, requireServerUrl()))
  if (!response.ok) {
    throw new Error(`Plugin source sync request failed with status ${response.status}.`)
  }
  return schema.parse(await response.json())
}

async function fetchPluginSource(sourceId: string): Promise<PluginSourceView> {
  return fetchJson(`/plugins/sources/${encodeURIComponent(sourceId)}`, PluginSourceSchema)
}

async function fetchPluginSources(): Promise<PluginSourceView[]> {
  return fetchJson('/plugins/sources', PluginSourcesSchema)
}

async function syncSource(source: PluginSourceView): Promise<void> {
  const previousIdentities = persistedSourcePlugins.get(source.id) ?? new Set<string>()
  const desktopPluginIdentities = new Set(
    source.plugins
      .filter(plugin => plugin.hasDesktop
        && plugin.activation.enabled
        && plugin.source.trusted
        && !['invalid', 'disabled', 'failed', 'skipped'].includes(plugin.layers.desktop.status))
      .map(plugin => plugin.identity),
  )
  for (const identity of previousIdentities) {
    await deactivateOneDesktopPlugin(identity)
  }
  persistedSourcePlugins.set(source.id, desktopPluginIdentities)
  if (!source.resolvedDirectory) { return }
  if (desktopPluginIdentities.size === 0) { return }

  await discoverAndActivateDesktopPluginSource({
    pluginsDir: source.resolvedDirectory,
    kind: 'externalLocal',
    trusted: true,
    reason: 'Activation and checksum trust were approved by the Cradle server.',
  }, desktopPluginIdentities, new Map(source.plugins.map(plugin => [
    plugin.identity,
    plugin.source.grantedPermissions,
  ])))
}

export async function syncDesktopLayerForSource(sourceId: string): Promise<void> {
  await syncSource(await fetchPluginSource(sourceId))
}

export async function syncAllDesktopLayerSources(): Promise<void> {
  const sources = await fetchPluginSources()
  const sourceIds = new Set(sources.map(source => source.id))
  for (const [sourceId, identities] of [...persistedSourcePlugins]) {
    if (sourceIds.has(sourceId)) { continue }
    for (const identity of identities) {
      await deactivateOneDesktopPlugin(identity)
    }
    persistedSourcePlugins.delete(sourceId)
  }
  for (const source of sources) {
    await syncSource(source)
  }
}

export function startPluginSync(): () => void {
  const appliedDevSessions = new Map<string, { pluginName: string, revision: number }>()
  const abortController = new AbortController()
  let disposed = false

  const applyDevSession = async (session: z.infer<typeof PluginDevSessionSchema>): Promise<void> => {
    if (!session.entries.desktop || session.revisions.desktop === 0) { return }
    if (appliedDevSessions.get(session.id)?.revision === session.revisions.desktop) { return }
    await activateDevelopmentDesktopPlugin({
      packageDir: session.packageDir,
      desktopEntry: session.entries.desktop,
      revision: session.revisions.desktop,
    })
    appliedDevSessions.set(session.id, {
      pluginName: session.pluginName,
      revision: session.revisions.desktop,
    })
  }

  const removeDevSession = async (sessionId: string, pluginName: string): Promise<void> => {
    if (!appliedDevSessions.delete(sessionId)) { return }
    await deactivateDevelopmentDesktopPlugin(pluginName)
  }

  const reconcileDevSessions = async (): Promise<void> => {
    const sessions = await fetchJson('/plugins/dev-sessions', PluginDevSessionsSchema)
    const activeIds = new Set(sessions.map(session => session.id))
    for (const [sessionId, state] of [...appliedDevSessions]) {
      if (activeIds.has(sessionId)) { continue }
      await removeDevSession(sessionId, state.pluginName)
    }
    for (const session of sessions) {
      await applyDevSession(session)
    }
  }

  const handleEvent = async (pluginEvent: z.infer<typeof PluginEventSchema>): Promise<void> => {
    if (pluginEvent.scope === 'lifecycle') {
      if (pluginEvent.event.type !== 'review-completed') {
        await syncAllDesktopLayerSources()
      }
      return
    }
    const event = pluginEvent.event
    if (event.type === 'stopped') {
      await removeDevSession(event.session.id, event.session.pluginName)
    }
    else if (event.type === 'started' || event.layer === 'desktop') {
      await applyDevSession(event.session)
    }
  }

  const consumeEvents = async (): Promise<void> => {
    const response = await fetch(new URL('/plugins/events', requireServerUrl()), {
      signal: abortController.signal,
    })
    if (!response.ok || !response.body) {
      throw new Error(`Plugin event stream failed with status ${response.status}.`)
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      if (disposed) { return }
      const result = await reader.read()
      if (result.done) { return }
      buffer += decoder.decode(result.value, { stream: true })
      for (;;) {
        const boundary = buffer.indexOf('\n\n')
        if (boundary < 0) { break }
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const data = frame.split('\n')
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice('data:'.length).trimStart())
          .join('\n')
        if (!data) { continue }
        await handleEvent(PluginEventSchema.parse(JSON.parse(data)))
      }
    }
  }

  void (async () => {
    for (;;) {
      if (disposed) { return }
      try {
        await syncAllDesktopLayerSources()
        await reconcileDevSessions()
        await consumeEvents()
      }
      catch (error) {
        if (disposed) { return }
        console.error('[plugins] desktop plugin sync failed:', error)
        await new Promise(resolvePromise => setTimeout(resolvePromise, 1_000))
      }
    }
  })()

  return () => {
    disposed = true
    abortController.abort()
  }
}

export async function unsyncDesktopLayerForSource(pluginName: string): Promise<void> {
  await deactivateOneDesktopPlugin(pluginName)
}

export function registerPluginSourceSyncIpcHandlers(): void {
  if (ipcHandlersRegistered) { return }
  ipcHandlersRegistered = true
  ipcMain.handle(PLUGINS_SYNC_SOURCE_CHANNEL, async (_event, sourceId: unknown) => {
    if (typeof sourceId !== 'string' || !sourceId.trim()) {
      throw new Error('Plugin source id is required.')
    }
    await syncDesktopLayerForSource(sourceId)
  })
  ipcMain.handle(PLUGINS_UNSYNC_SOURCE_CHANNEL, async (_event, pluginName: unknown) => {
    if (typeof pluginName !== 'string' || !pluginName.trim()) {
      throw new Error('Plugin name is required.')
    }
    await unsyncDesktopLayerForSource(pluginName)
  })
}
