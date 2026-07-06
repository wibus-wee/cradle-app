import { ipcMain } from 'electron'
import { z } from 'zod'

import {
  deactivateOneDesktopPlugin,
  discoverAndActivateDesktopPluginSource,
} from './plugin-loader'

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
