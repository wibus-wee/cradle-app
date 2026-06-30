import { t } from 'elysia'

const sourceStatusSchema = t.Union([
  t.Literal('never'),
  t.Literal('ok'),
  t.Literal('warning'),
  t.Literal('error'),
])

const recordStatusSchema = t.Union([
  t.Literal('active'),
  t.Literal('stale'),
  t.Literal('missing'),
  t.Literal('unsupported'),
  t.Literal('error'),
])
const nullableString = t.Union([t.String(), t.Null()])

const warningSchema = t.Object({
  code: t.String(),
  message: t.String(),
  severity: t.Union([t.Literal('info'), t.Literal('warning'), t.Literal('error')]),
})

const sourceCapabilitiesSchema = t.Object({
  refresh: t.Optional(t.Boolean()),
  revealSourceFile: t.Optional(t.Boolean()),
  importAsNative: t.Optional(t.Boolean()),
})

const recordMetadataSchema = t.Object({
  baseUrl: t.Optional(t.String()),
  model: t.Optional(t.String()),
  apiFormat: t.Optional(t.String()),
  iconSlug: t.Optional(t.String()),
  iconUrl: t.Optional(t.String()),
  avatarUrl: t.Optional(t.String()),
  sourceUpdatedAt: t.Optional(t.String()),
  rawFingerprintHint: t.Optional(t.String()),
})

const credentialSchema = t.Object({
  kind: t.Union([t.Literal('api-key'), t.Literal('chatgpt-auth')]),
  label: t.Optional(t.String()),
  value: t.String(),
})

const providerRecordSchema = t.Object({
  externalId: t.String(),
  app: t.String(),
  name: t.String(),
  providerKind: t.Union([t.Literal('anthropic'), t.Literal('openai-compatible'), t.Literal('universal'), t.Literal('cli-tool')]),
  config: t.Record(t.String(), t.Any()),
  credential: t.Optional(credentialSchema),
  current: t.Optional(t.Boolean()),
  readonly: t.Optional(t.Boolean()),
  metadata: t.Optional(recordMetadataSchema),
  warnings: t.Optional(t.Array(warningSchema)),
})

export const ExternalProviderSourcesModel = {
  source: t.Object({
    id: t.String(),
    pluginName: t.String(),
    sourceId: t.String(),
    label: t.String(),
    description: nullableString,
    enabled: t.Boolean(),
    capabilities: t.Record(t.String(), t.Any()),
    inventory: t.Record(t.String(), t.Any()),
    warnings: t.Array(warningSchema),
    lastSyncStatus: sourceStatusSchema,
    lastSyncMessage: nullableString,
    lastSyncError: nullableString,
    lastSyncAt: t.Union([t.Number(), t.Null()]),
    registeredAt: t.Number(),
  }),
  record: t.Object({
    id: t.String(),
    providerTargetId: nullableString,
    sourceKey: t.String(),
    externalId: t.String(),
    app: t.String(),
    name: t.String(),
    providerKind: t.Union([t.Literal('anthropic'), t.Literal('openai-compatible'), t.Literal('universal'), t.Literal('cli-tool')]),
    status: recordStatusSchema,
    runtimeTargetEnabled: t.Boolean(),
    fingerprint: t.String(),
    metadata: t.Record(t.String(), t.Any()),
    warnings: t.Array(warningSchema),
    lastSeenAt: t.Number(),
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),
  refreshResult: t.Object({
    sourceKey: t.String(),
    status: sourceStatusSchema,
    recordsSeen: t.Number(),
    recordsProjected: t.Number(),
    recordsMissing: t.Number(),
    message: t.Optional(t.String()),
  }),
  refreshParams: t.Object({
    sourceKey: t.String({ minLength: 1 }),
  }),
  recordParams: t.Object({
    sourceKey: t.String({ minLength: 1 }),
    externalRecordId: t.String({ minLength: 1 }),
  }),
  runtimeTargetPatch: t.Object({
    enabled: t.Boolean(),
  }),
  providerRecord: providerRecordSchema,
  sourceCapabilities: sourceCapabilitiesSchema,
}
