export type PluginMarketplaceLayer = 'server' | 'web' | 'desktop' | 'mcp' | 'skill'
export type PluginMarketplaceCategory
  = | 'automation'
    | 'diagnostics'
    | 'provider'
    | 'workspace'
export type PluginMarketplaceStatus = 'bundled' | 'beta'

export interface PluginMarketplaceEntry {
  id: string
  packageName: string
  displayName: string
  summary: string
  description: string
  version: string
  status: PluginMarketplaceStatus
  category: PluginMarketplaceCategory
  layers: PluginMarketplaceLayer[]
  capabilities: string[]
  owner: string
  namespace: string
  repositoryPath: string
  docsHref: string
  trustNotes: string[]
  install: {
    source: 'github'
    repository: string
    path: string
    channel: 'bundled'
  }
}

export const marketplaceInstallProtocol = 'cradle://plugins/install'
export const marketplaceWebFallbackPath = '/plugin-marketplace'

export const pluginMarketplaceEntries = [
  {
    id: 'browser-use',
    packageName: '@cradle/browser-use',
    displayName: 'Browser Use',
    summary: 'Expose Cradle desktop browser tabs as MCP automation tools.',
    description:
      'Browser Use connects the desktop embedded browser to agent-facing MCP tools for navigation, clicks, typing, screenshots, text extraction, and DOM inspection.',
    version: '0.0.1',
    status: 'bundled',
    category: 'automation',
    layers: ['desktop', 'server', 'mcp', 'skill'],
    capabilities: [
      'Desktop browser tab control',
      'MCP browser automation tools',
      'Agent skill trigger for browser tasks',
    ],
    owner: 'plugins/browser-use',
    namespace: 'plugins/browser-use/**',
    repositoryPath: 'plugins/browser-use',
    docsHref: '/docs/developers/plugins/browser-use',
    trustNotes: [
      'Controls local desktop browser tabs through the Cradle desktop runtime.',
      'Requires trust in the plugin owner because it can inspect page state.',
    ],
    install: {
      source: 'github',
      repository: 'wibus-wee/Cradle',
      path: 'plugins/browser-use',
      channel: 'bundled',
    },
  },
  {
    id: 'cc-switch',
    packageName: '@cradle/cc-switch',
    displayName: 'CC Switch',
    summary: 'Mirror CC Switch providers into Cradle as read-only external sources.',
    description:
      'CC Switch projects provider records from the CC Switch namespace into Cradle external provider sources without taking ownership of that upstream data.',
    version: '0.0.1',
    status: 'beta',
    category: 'provider',
    layers: ['server'],
    capabilities: [
      'Read-only provider source projection',
      'External provider source registration',
      'Namespace-compatible provider discovery',
    ],
    owner: 'plugins/cc-switch',
    namespace: 'plugins/cc-switch/**',
    repositoryPath: 'plugins/cc-switch',
    docsHref: '/docs/developers/plugins/examples',
    trustNotes: [
      'Reads provider data from the CC Switch namespace.',
      'Must keep Cradle writes inside Cradle-owned provider source APIs.',
    ],
    install: {
      source: 'github',
      repository: 'wibus-wee/Cradle',
      path: 'plugins/cc-switch',
      channel: 'bundled',
    },
  },
  {
    id: 'system-info',
    packageName: '@cradle/system-info',
    displayName: 'System Info',
    summary: 'Expose host runtime information through a server route and web command.',
    description:
      'System Info publishes OS, CPU, memory, uptime, and Node.js runtime information through a scoped plugin API and a web command panel.',
    version: '0.0.1',
    status: 'bundled',
    category: 'diagnostics',
    layers: ['server', 'web'],
    capabilities: [
      'Host runtime diagnostics',
      'Scoped plugin API route',
      'Web command and panel integration',
    ],
    owner: 'plugins/system-info',
    namespace: 'plugins/system-info/**',
    repositoryPath: 'plugins/system-info',
    docsHref: '/docs/integrations/system-info',
    trustNotes: [
      'Reads local host runtime information.',
      'Serves data through the plugin-owned route segment only.',
    ],
    install: {
      source: 'github',
      repository: 'wibus-wee/Cradle',
      path: 'plugins/system-info',
      channel: 'bundled',
    },
  },
] satisfies PluginMarketplaceEntry[]

export function createPluginInstallUrl(plugin: PluginMarketplaceEntry) {
  const params = new URLSearchParams({
    source: plugin.install.source,
    repository: plugin.install.repository,
    path: plugin.install.path,
    package: plugin.packageName,
    version: plugin.version,
    channel: plugin.install.channel,
  })

  return `${marketplaceInstallProtocol}?${params.toString()}`
}

export function createPluginMarketplaceWebUrl(plugin: PluginMarketplaceEntry) {
  return `${marketplaceWebFallbackPath}?plugin=${encodeURIComponent(plugin.id)}`
}

export function getPluginMarketplacePayload() {
  return {
    schemaVersion: 1,
    generatedFrom: 'documentations/lib/plugin-marketplace.ts',
    installProtocol: marketplaceInstallProtocol,
    webFallbackPath: marketplaceWebFallbackPath,
    plugins: pluginMarketplaceEntries.map(plugin => ({
      ...plugin,
      installUrl: createPluginInstallUrl(plugin),
      webUrl: createPluginMarketplaceWebUrl(plugin),
    })),
  }
}
