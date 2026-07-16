import { ipcMain } from 'electron'
import { z } from 'zod'

import {
  activateDevelopmentDesktopPlugin,
  deactivateDevelopmentDesktopPlugin,
  deactivateOneDesktopPlugin,
  discoverAndActivateDesktopPluginSource,
} from './plugin-loader'
import { getDesktopServerAuthHeaders } from './server-process'

const PLUGINS_SYNC_SOURCE_CHANNEL = 'desktop:plugins-sync-source'
const PLUGINS_UNSYNC_SOURCE_CHANNEL = 'desktop:plugins-unsync-source'

const PluginSourcePluginSchema = z.object({
  identity: z.string(),
  hasDesktop: z.boolean(),
})

const PluginSourceSchema = z.object({
  id: z.string(),
  resolvedDirectory: z.string().nullable(),
  plugins: z.array(PluginSourcePluginSchema),
})

const PluginSourcesSchema = z.array(PluginSourceSchema)

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

type PluginSourceView = z.infer<typeof PluginSourceSchema>

let serverUrl: string | null = null
let ipcHandlersRegistered = false

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
  const response = await fetch(new URL(path, requireServerUrl()), { headers: getDesktopServerAuthHeaders() })
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
  if (!source.resolvedDirectory) { return }
  const desktopPluginIdentities = new Set(
    source.plugins
      .filter(plugin => plugin.hasDesktop)
      .map(plugin => plugin.identity),
  )
  if (desktopPluginIdentities.size === 0) { return }

  await discoverAndActivateDesktopPluginSource({
    pluginsDir: source.resolvedDirectory,
    kind: 'externalLocal',
    trusted: true,
    reason: 'Resolved persisted plugin source from the Cradle server.',
  }, desktopPluginIdentities)
}

export async function syncDesktopLayerForSource(sourceId: string): Promise<void> {
  await syncSource(await fetchPluginSource(sourceId))
}

export async function syncAllDesktopLayerSources(): Promise<void> {
  const sources = await fetchPluginSources()
  for (const source of sources) {
    await syncSource(source)
  }
}

export async function unsyncDesktopLayerForSource(pluginName: string): Promise<void> {
  await deactivateOneDesktopPlugin(pluginName)
}

export function startPluginDevSessionSync(): () => void {
  const applied = new Map<string, { pluginName: string, revision: number }>()
  const abortController = new AbortController()
  let disposed = false

  const applySession = async (session: z.infer<typeof PluginDevSessionSchema>): Promise<void> => {
    if (!session.entries.desktop || session.revisions.desktop === 0) { return }
    if (applied.get(session.id)?.revision === session.revisions.desktop) { return }
    await activateDevelopmentDesktopPlugin({
      packageDir: session.packageDir,
      desktopEntry: session.entries.desktop,
      revision: session.revisions.desktop,
    })
    applied.set(session.id, {
      pluginName: session.pluginName,
      revision: session.revisions.desktop,
    })
  }

  const removeSession = async (sessionId: string, pluginName: string): Promise<void> => {
    if (!applied.delete(sessionId)) { return }
    await deactivateDevelopmentDesktopPlugin(pluginName)
  }

  const reconcileSnapshot = async (): Promise<void> => {
    const sessions = await fetchJson('/plugins/dev-sessions', PluginDevSessionsSchema)
    const activeIds = new Set(sessions.map(session => session.id))
    for (const [sessionId, state] of [...applied]) {
      if (activeIds.has(sessionId)) { continue }
      await removeSession(sessionId, state.pluginName)
    }
    for (const session of sessions) {
      await applySession(session)
    }
  }

  const consumeEvents = async (): Promise<void> => {
    const response = await fetch(new URL('/plugins/dev-sessions/events', requireServerUrl()), {
      headers: getDesktopServerAuthHeaders(),
      signal: abortController.signal,
    })
    if (!response.ok || !response.body) {
      throw new Error(`Plugin development event stream failed with status ${response.status}.`)
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
        if (data) {
          const event = PluginDevSessionEventSchema.parse(JSON.parse(data))
          if (event.type === 'stopped') {
            await removeSession(event.session.id, event.session.pluginName)
          }
          else if (event.type === 'started' || event.layer === 'desktop') {
            await applySession(event.session)
          }
        }
      }
    }
  }

  void (async () => {
    for (;;) {
      if (disposed) { return }
      try {
        await reconcileSnapshot()
        await consumeEvents()
      }
      catch (error) {
        if (disposed) { return }
        console.error('[plugins] desktop development session sync failed:', error)
        await new Promise(resolvePromise => setTimeout(resolvePromise, 1_000))
      }
    }
  })()

  return () => {
    disposed = true
    abortController.abort()
  }
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
