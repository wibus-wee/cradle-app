import type {
  PostPluginsSourcesPreviewResponse,
  PostPluginsSourcesResponse,
} from '~/api-gen/types.gen'

export const pluginPreviewFixture = {
  source: {
    kind: 'git',
    location: 'cradle-app/example-plugin',
    ref: null,
    subPath: null,
  },
  plugins: [
    {
      name: 'example-tools',
      version: '1.4.0',
      displayName: 'Example Tools',
      description: 'Adds issue triage actions and a compact activity panel.',
      iconAvailable: false,
      trusted: true,
      trustReason: null,
      declaredPermissions: [
        {
          id: 'example-tools:issues.read',
          owner: 'example-tools',
          localId: 'issues.read',
          label: 'Read issues',
          description: 'Read issue metadata in the active workspace.',
          required: true,
        },
      ],
      warnings: [],
      hasWeb: true,
      hasServer: true,
      hasDesktop: false,
    },
    {
      name: 'local-bridge',
      version: '0.8.2',
      displayName: 'Local Bridge',
      description: 'Connects the plugin to a local development process.',
      iconAvailable: false,
      trusted: false,
      trustReason: 'The source is not in the trusted plugin registry.',
      declaredPermissions: [
        {
          id: 'local-bridge:process.spawn',
          owner: 'local-bridge',
          localId: 'process.spawn',
          label: 'Start local process',
          description: 'Start the configured local bridge executable.',
          required: true,
        },
      ],
      warnings: ['Review local process permissions before enabling.'],
      hasWeb: true,
      hasServer: false,
      hasDesktop: true,
    },
  ],
  warnings: ['One plugin requires trust confirmation before it can be enabled.'],
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
  identity: 'example-tools',
  routeSegment: 'example-tools',
  name: 'example-tools',
  version: '1.4.0',
  displayName: 'Example Tools',
  description: 'Adds issue triage actions and a compact activity panel.',
  iconUrl: null,
  source: {
    kind: 'externalLocal',
    packageDir: '/tmp/cradle/plugins/example-tools',
    trusted: true,
    reason: 'Installed from a reviewed source.',
    checksum: 'fixture-checksum',
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

export const disabledPluginFixture = {
  ...installedPluginFixture,
  identity: 'local-bridge',
  routeSegment: 'local-bridge',
  name: 'local-bridge',
  version: '0.8.2',
  displayName: 'Local Bridge',
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
    id: 'source-example-tools',
    kind: 'git',
    location: 'cradle-app/example-plugin',
    ref: null,
    subPath: null,
    label: null,
    addedReason: 'Added via Settings preview flow.',
    createdAt: 1784880000,
    updatedAt: 1784880000,
    resolvedDirectory: '/tmp/cradle/plugins/example-tools',
    error: null,
    plugins: [installedPluginFixture, disabledPluginFixture],
  },
  discoveredPlugins: [installedPluginFixture, disabledPluginFixture],
} satisfies PostPluginsSourcesResponse
