import { t } from 'elysia'

const pluginCapabilityLayer = t.Union([
  t.Literal('server'),
  t.Literal('web'),
  t.Literal('desktop'),
])

const pluginLayerStatus = t.Union([
  t.Literal('discovered'),
  t.Literal('invalid'),
  t.Literal('skipped'),
  t.Literal('disabled'),
  t.Literal('activating'),
  t.Literal('active'),
  t.Literal('failed'),
  t.Literal('partial'),
])

const pluginActivationState = t.Object({
  enabled: t.Boolean(),
  source: t.Union([t.Literal('default'), t.Literal('user')]),
  reason: t.Union([t.String(), t.Null()]),
  updatedAt: t.Union([t.Number(), t.Null()]),
}, { additionalProperties: false })

const pluginLayerState = t.Object({
  layer: pluginCapabilityLayer,
  status: pluginLayerStatus,
  entry: t.Union([t.String(), t.Null()]),
  error: t.Union([t.String(), t.Null()]),
  activatedAt: t.Union([t.String(), t.Null()]),
}, { additionalProperties: false })

const pluginSourceKind = t.Union([
  t.Literal('workspaceDev'),
  t.Literal('bundledResource'),
  t.Literal('externalLocal'),
])

const pluginSource = t.Object({
  kind: pluginSourceKind,
  packageDir: t.String(),
  trusted: t.Boolean(),
  reason: t.Union([t.String(), t.Null()]),
  checksum: t.Union([t.String(), t.Null()]),
}, { additionalProperties: false })

const pluginMentionCapability = t.Object({
  id: t.String({ minLength: 1 }),
  type: t.String({ minLength: 1 }),
  layer: pluginCapabilityLayer,
  label: t.Union([t.String(), t.Null()]),
}, { additionalProperties: false })

const pluginMentionCandidate = t.Object({
  pluginName: t.String({ minLength: 1 }),
  displayName: t.String({ minLength: 1 }),
  description: t.Union([t.String(), t.Null()]),
  iconUrl: t.Union([t.String({ minLength: 1 }), t.Null()]),
  routeSegment: t.String({ minLength: 1 }),
  capabilities: t.Array(pluginMentionCapability),
  mcpServers: t.Array(t.String({ minLength: 1 })),
  active: t.Boolean(),
}, { additionalProperties: false })

const pluginCapability = t.Object({
  id: t.String({ minLength: 1 }),
  owner: t.String({ minLength: 1 }),
  type: t.String({ minLength: 1 }),
  layer: pluginCapabilityLayer,
  status: t.Union([
    t.Literal('registered'),
    t.Literal('failed'),
    t.Literal('unsupported'),
  ]),
  label: t.Union([t.String(), t.Null()]),
  metadata: t.Record(t.String(), t.Unknown()),
}, { additionalProperties: false })

const pluginDeclaredCapability = t.Object({
  id: t.String({ minLength: 1 }),
  owner: t.String({ minLength: 1 }),
  localId: t.String({ minLength: 1 }),
  type: t.String({ minLength: 1 }),
  layer: t.Union([pluginCapabilityLayer, t.Null()]),
  label: t.Union([t.String(), t.Null()]),
  description: t.Union([t.String(), t.Null()]),
  permissions: t.Array(t.String()),
  metadata: t.Record(t.String(), t.Unknown()),
}, { additionalProperties: false })

const pluginDeclaredPermission = t.Object({
  id: t.String({ minLength: 1 }),
  owner: t.String({ minLength: 1 }),
  localId: t.String({ minLength: 1 }),
  label: t.Union([t.String(), t.Null()]),
  description: t.Union([t.String(), t.Null()]),
  required: t.Boolean(),
}, { additionalProperties: false })

const pluginDescriptor = t.Object({
  identity: t.String({ minLength: 1 }),
  routeSegment: t.String({ minLength: 1 }),
  name: t.String({ minLength: 1 }),
  version: t.String({ minLength: 1 }),
  displayName: t.String({ minLength: 1 }),
  description: t.Union([t.String(), t.Null()]),
  iconUrl: t.Union([t.String({ minLength: 1 }), t.Null()]),
  source: pluginSource,
  activation: pluginActivationState,
  layers: t.Object({
    server: pluginLayerState,
    web: pluginLayerState,
    desktop: pluginLayerState,
  }, { additionalProperties: false }),
  declaredCapabilities: t.Array(pluginDeclaredCapability),
  declaredPermissions: t.Array(pluginDeclaredPermission),
  capabilities: t.Array(pluginCapability),
  warnings: t.Array(t.String()),
  active: t.Boolean(),
  hasWeb: t.Boolean(),
  hasServer: t.Boolean(),
  hasDesktop: t.Boolean(),
  serverEntry: t.Union([t.String(), t.Null()]),
  webEntry: t.Union([t.String(), t.Null()]),
  desktopEntry: t.Union([t.String(), t.Null()]),
}, { additionalProperties: false })

const updatePluginActivationBody = t.Object({
  enabled: t.Boolean(),
  reason: t.Optional(t.Union([t.String(), t.Null()])),
}, { additionalProperties: false })

const pluginSourceRegistryKind = t.Union([
  t.Literal('localPath'),
  t.Literal('git'),
  t.Literal('npm'),
])

const pluginSourceRegistryEntry = t.Object({
  id: t.String({ minLength: 1 }),
  kind: pluginSourceRegistryKind,
  location: t.String({ minLength: 1 }),
  ref: t.Union([t.String(), t.Null()]),
  subPath: t.Union([t.String(), t.Null()]),
  label: t.Union([t.String(), t.Null()]),
  addedReason: t.String(),
  createdAt: t.Number(),
  updatedAt: t.Number(),
  resolvedDirectory: t.Union([t.String(), t.Null()]),
  error: t.Union([t.String(), t.Null()]),
  plugins: t.Array(pluginDescriptor),
}, { additionalProperties: false })

const addPluginSourceBody = t.Object({
  kind: pluginSourceRegistryKind,
  location: t.String({ minLength: 1 }),
  ref: t.Optional(t.Union([t.String(), t.Null()])),
  subPath: t.Optional(t.Union([t.String(), t.Null()])),
  label: t.Optional(t.Union([t.String(), t.Null()])),
  addedReason: t.Optional(t.Union([t.String(), t.Null()])),
}, { additionalProperties: false })

const addPluginSourceResult = t.Object({
  source: pluginSourceRegistryEntry,
  discoveredPlugins: t.Array(pluginDescriptor),
}, { additionalProperties: false })

export const PluginsModel = {
  addPluginSourceBody,
  addPluginSourceResult,
  pluginActivationState,
  pluginDescriptor,
  pluginMentionCapability,
  pluginMentionCandidate,
  pluginSourceRegistryEntry,
  updatePluginActivationBody,
} as const
