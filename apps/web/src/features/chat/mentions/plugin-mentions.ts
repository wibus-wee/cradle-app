import { getPluginsMentions } from '~/api-gen/sdk.gen'
import { getServerUrl } from '~/lib/electron'

import { loadCodexInstalledPluginResult } from '../runtime/codex-app-server-bridge'
import type { PluginMentionItem } from './mention-panel'

function readPluginMentionItems(value: unknown): PluginMentionItem[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return []
    }
    const record = item as PluginMentionItem
    if (
      typeof record.pluginName !== 'string'
      || typeof record.displayName !== 'string'
      || typeof record.routeSegment !== 'string'
      || !Array.isArray(record.capabilities)
      || !Array.isArray(record.mcpServers)
    ) {
      return []
    }
    return [{
      kind: 'plugin' as const,
      provider: record.provider ?? 'cradle',
      pluginName: record.pluginName,
      displayName: record.displayName,
      description: typeof record.description === 'string' ? record.description : null,
      iconUrl: normalizePluginIconUrl(record.iconUrl),
      routeSegment: record.routeSegment,
      capabilities: record.capabilities,
      mcpServers: record.mcpServers,
      nativeMention: readNativeMention(record.nativeMention),
      active: record.active === true,
    }]
  })
}

function normalizePluginIconUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null
  }
  return new URL(value, getServerUrl()).toString()
}

function readNativeMention(value: unknown): { name: string, path: string } | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const record = value as { name?: unknown, path?: unknown }
  if (typeof record.name !== 'string' || typeof record.path !== 'string') {
    return null
  }
  return {
    name: record.name,
    path: record.path,
  }
}

export async function searchPluginMentions(query: string, signal?: AbortSignal): Promise<PluginMentionItem[]> {
  const result = await getPluginsMentions({ signal })
  if (result.error || !result.data) {
    throw new Error(`Failed to load plugin mentions (${result.response?.status ?? 'unknown'}).`)
  }
  return filterPluginMentionItems(readPluginMentionItems(result.data), query)
}

export async function searchSessionPluginMentions(input: {
  sessionId: string
  supportsCodexPluginMentions: boolean
  providerTargetId?: string | null
  modelId?: string | null
  query: string
  signal?: AbortSignal
}): Promise<PluginMentionItem[]> {
  const cradlePluginsPromise = searchPluginMentions(input.query, input.signal)
  if (!input.supportsCodexPluginMentions) {
    return cradlePluginsPromise
  }

  const [cradlePlugins, codexPlugins] = await Promise.all([
    cradlePluginsPromise,
    searchCodexPluginMentions(input).catch(() => []),
  ])
  return filterPluginMentionItems(dedupePluginMentions([...codexPlugins, ...cradlePlugins]), input.query)
}

function filterPluginMentionItems(items: PluginMentionItem[], query: string): PluginMentionItem[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return items
  }
  return items.filter(item =>
    item.displayName.toLowerCase().includes(normalizedQuery)
    || item.pluginName.toLowerCase().includes(normalizedQuery)
    || item.routeSegment.toLowerCase().includes(normalizedQuery)
    || item.nativeMention?.path.toLowerCase().includes(normalizedQuery)
    || (item.provider ?? 'cradle').includes(normalizedQuery)
    || item.capabilities.some(capability => capability.type.toLowerCase().includes(normalizedQuery))
    || item.mcpServers.some(server => server.toLowerCase().includes(normalizedQuery)))
}

async function searchCodexPluginMentions(input: {
  sessionId: string
  providerTargetId?: string | null
  modelId?: string | null
  signal?: AbortSignal
}): Promise<PluginMentionItem[]> {
  const result = await loadCodexInstalledPluginResult(input)
  return readCodexPluginMentionItems(result)
}

function readCodexPluginMentionItems(value: unknown): PluginMentionItem[] {
  if (!value || typeof value !== 'object') {
    return []
  }
  const marketplaces = Array.isArray((value as { marketplaces?: unknown }).marketplaces)
    ? (value as { marketplaces: unknown[] }).marketplaces
    : []
  return marketplaces.flatMap((marketplace) => {
    if (!marketplace || typeof marketplace !== 'object') {
      return []
    }
    const marketplaceName = typeof (marketplace as { name?: unknown }).name === 'string'
      ? (marketplace as { name: string }).name
      : 'codex'
    const plugins = Array.isArray((marketplace as { plugins?: unknown }).plugins)
      ? (marketplace as { plugins: unknown[] }).plugins
      : []
    return plugins.flatMap(plugin => toCodexPluginMentionItem(plugin, marketplaceName))
  })
}

function toCodexPluginMentionItem(value: unknown, _marketplaceName: string): PluginMentionItem[] {
  if (!value || typeof value !== 'object') {
    return []
  }
  const plugin = value as {
    id?: unknown
    name?: unknown
    installed?: unknown
    enabled?: unknown
    interface?: unknown
    keywords?: unknown
  }
  const id = typeof plugin.id === 'string' ? plugin.id : ''
  const name = typeof plugin.name === 'string' ? plugin.name : id
  if (!id || !name || plugin.installed !== true || plugin.enabled === false) {
    return []
  }
  const pluginInterface = plugin.interface && typeof plugin.interface === 'object'
    ? plugin.interface as {
        displayName?: unknown
        shortDescription?: unknown
        composerIconUrl?: unknown
        capabilities?: unknown
      }
    : null
  const displayName = typeof pluginInterface?.displayName === 'string' && pluginInterface.displayName
    ? pluginInterface.displayName
    : name
  const capabilities = Array.isArray(pluginInterface?.capabilities)
    ? pluginInterface.capabilities
      .filter((capability): capability is string => typeof capability === 'string' && capability.length > 0)
      .map(capability => ({
        id: `codex:${id}:${capability}`,
        type: capability,
        layer: 'server' as const,
        label: capability,
      }))
    : []

  return [{
    kind: 'plugin',
    provider: 'codex',
    pluginName: name,
    displayName,
    description: typeof pluginInterface?.shortDescription === 'string' ? pluginInterface.shortDescription : null,
    iconUrl: typeof pluginInterface?.composerIconUrl === 'string' ? pluginInterface.composerIconUrl : null,
    routeSegment: name,
    capabilities,
    mcpServers: [],
    nativeMention: {
      name: displayName,
      path: id,
    },
    active: true,
  }]
}

function dedupePluginMentions(items: PluginMentionItem[]): PluginMentionItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${item.provider ?? 'cradle'}:${item.pluginName}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}
