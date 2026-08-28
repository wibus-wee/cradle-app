import type {
  PostPluginsSourcesPreviewResponse,
  PostPluginsSourcesResponse,
} from '~/api-gen/types.gen'

type PreviewPlugin = PostPluginsSourcesPreviewResponse['plugins'][number]
type DeclaredPermission = PreviewPlugin['declaredPermissions'][number]

function permission(
  owner: string,
  localId: string,
  label: string,
  description: string,
  required = true,
): DeclaredPermission {
  return { id: `${owner}:${localId}`, owner, localId, label, description, required }
}

export const browserUsePreviewFixture = {
  name: 'browser-use',
  version: '2.3.1',
  displayName: 'Browser Use',
  description: 'Drive a real browser from chat — navigate pages, fill forms, click elements, and capture screenshots as evidence.',
  iconAvailable: true,
  trusted: true,
  trustReason: null,
  declaredPermissions: [
    permission('browser-use', 'browser.control', 'Control browser', 'Launch and drive a Chromium instance on this machine.'),
    permission('browser-use', 'network.read', 'Read page content', 'Read the content of pages you ask the agent to open.'),
  ],
  warnings: [],
  hasWeb: true,
  hasServer: true,
  hasDesktop: true,
} satisfies PreviewPlugin

export const slackBridgePreviewFixture = {
  name: 'slack-conversation-bridge',
  version: '0.9.4',
  displayName: 'Slack Conversation Bridge',
  description: 'Mirror Cradle conversations into Slack threads and bring channel replies back as agent input.',
  iconAvailable: true,
  trusted: false,
  trustReason: 'The source is not in the trusted plugin registry.',
  declaredPermissions: [
    permission('slack-conversation-bridge', 'network.egress', 'Call Slack API', 'Send conversation payloads to the configured Slack workspace.'),
    permission('slack-conversation-bridge', 'secrets.read', 'Read bot token', 'Read the stored Slack bot token from the keychain.'),
  ],
  warnings: ['Requests secrets.read — review the bot token scope before enabling.'],
  hasWeb: true,
  hasServer: true,
  hasDesktop: false,
} satisfies PreviewPlugin

export const systemInfoPreviewFixture = {
  name: 'system-info',
  version: '1.1.0',
  displayName: 'System Info',
  description: 'Adds CPU, memory, and battery readouts to the agent context, plus a compact status widget.',
  iconAvailable: false,
  trusted: true,
  trustReason: null,
  declaredPermissions: [
    permission('system-info', 'system.read', 'Read system metrics', 'Sample CPU, memory, and battery state locally.'),
  ],
  warnings: [],
  hasWeb: true,
  hasServer: false,
  hasDesktop: true,
} satisfies PreviewPlugin

export const legacyBridgePreviewFixture = {
  name: 'local-bridge',
  version: '0.8.2',
  displayName: 'Local Bridge',
  description: 'Connects the plugin to a local development process.',
  iconAvailable: false,
  trusted: false,
  trustReason: 'The source is not in the trusted plugin registry.',
  declaredPermissions: [
    permission('local-bridge', 'process.spawn', 'Start local process', 'Start the configured local bridge executable.'),
  ],
  warnings: [
    'Review local process permissions before enabling.',
    'This plugin bundles a prebuilt binary that cannot be verified.',
  ],
  hasWeb: true,
  hasServer: false,
  hasDesktop: true,
} satisfies PreviewPlugin

export const pluginPreviewFixture = {
  source: {
    kind: 'git',
    location: 'cradle-app/official-plugins',
    ref: null,
    subPath: null,
  },
  plugins: [
    browserUsePreviewFixture,
    slackBridgePreviewFixture,
    systemInfoPreviewFixture,
    legacyBridgePreviewFixture,
  ],
  warnings: ['Two plugins require trust confirmation before they can be enabled.'],
} satisfies PostPluginsSourcesPreviewResponse

const activeLayer = {
  layer: 'web',
  status: 'active',
  entry: './dist/web.js',
  error: null,
  activatedAt: '2026-07-24T08:00:00.000Z',
} as const

const skippedServerLayer = {
  layer: 'server',
  status: 'skipped',
  entry: null,
  error: null,
  activatedAt: null,
} as const

const skippedDesktopLayer = {
  layer: 'desktop',
  status: 'skipped',
  entry: null,
  error: null,
  activatedAt: null,
} as const

export const installedPluginFixture = {
  identity: 'browser-use',
  routeSegment: 'browser-use',
  name: 'browser-use',
  version: '2.3.1',
  displayName: 'Browser Use',
  description: 'Drive a real browser from chat — navigate pages, fill forms, click elements, and capture screenshots as evidence.',
  iconUrl: null,
  source: {
    kind: 'externalLocal',
    packageDir: '/tmp/cradle/plugins/browser-use',
    trusted: true,
    reason: 'Installed from a reviewed source.',
    checksum: 'fixture-checksum',
    grantedPermissions: [],
  },
  activation: {
    enabled: true,
    source: 'user',
    reason: null,
    updatedAt: 1784880000,
  },
  layers: {
    server: skippedServerLayer,
    web: activeLayer,
    desktop: skippedDesktopLayer,
  },
  declaredCapabilities: [],
  declaredPermissions: [],
  capabilities: [],
  warnings: [],
  active: true,
  hasWeb: true,
  hasServer: false,
  hasDesktop: false,
  serverEntry: null,
  webEntry: './dist/web.js',
  desktopEntry: null,
} satisfies PostPluginsSourcesResponse['discoveredPlugins'][number]

export const systemInfoInstalledFixture = {
  ...installedPluginFixture,
  identity: 'system-info',
  routeSegment: 'system-info',
  name: 'system-info',
  version: '1.1.0',
  displayName: 'System Info',
  description: 'Adds CPU, memory, and battery readouts to the agent context, plus a compact status widget.',
} satisfies PostPluginsSourcesResponse['discoveredPlugins'][number]

export const disabledPluginFixture = {
  ...installedPluginFixture,
  identity: 'slack-conversation-bridge',
  routeSegment: 'slack-conversation-bridge',
  name: 'slack-conversation-bridge',
  version: '0.9.4',
  displayName: 'Slack Conversation Bridge',
  description: 'Mirror Cradle conversations into Slack threads and bring channel replies back as agent input.',
  source: {
    ...installedPluginFixture.source,
    trusted: false,
    reason: 'Trust has not been granted.',
  },
  activation: {
    enabled: false,
    source: 'default',
    reason: 'Awaiting user trust.',
    updatedAt: null,
  },
  layers: {
    server: skippedServerLayer,
    web: {
      ...activeLayer,
      status: 'disabled',
      activatedAt: null,
    },
    desktop: {
      ...skippedDesktopLayer,
      status: 'disabled',
    },
  },
  active: false,
  hasDesktop: true,
  desktopEntry: './dist/desktop.js',
} satisfies PostPluginsSourcesResponse['discoveredPlugins'][number]

export const pluginInstallResultFixture = {
  source: {
    id: 'source-official-plugins',
    kind: 'git',
    location: 'cradle-app/official-plugins',
    ref: null,
    subPath: null,
    label: null,
    addedReason: 'Added via Settings preview flow.',
    createdAt: 1784880000,
    updatedAt: 1784880000,
    resolvedDirectory: '/tmp/cradle/plugins/official-plugins',
    error: null,
    plugins: [installedPluginFixture, disabledPluginFixture, systemInfoInstalledFixture],
  },
  discoveredPlugins: [installedPluginFixture, disabledPluginFixture, systemInfoInstalledFixture],
  operation: {
    action: 'install',
    status: 'success',
    error: null,
    reviewRequired: true,
    reviewPath: '/plugins',
    previousSnapshotPreserved: false,
  },
} satisfies PostPluginsSourcesResponse
