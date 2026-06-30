import { t } from 'elysia'

const nullableString = t.Union([t.String(), t.Null()])
const jsonRecord = t.Record(t.String(), t.Any())

const healthStatus = t.Union([
  t.Literal('unknown'),
  t.Literal('starting'),
  t.Literal('running'),
  t.Literal('stopped'),
  t.Literal('error'),
])

export const ConversationBridgeModel = {
  adapter: t.Object({
    key: t.String(),
    owner: t.String(),
    id: t.String(),
    platform: t.String(),
    label: t.String(),
    description: nullableString,
    capabilities: jsonRecord,
    registeredAt: t.Number(),
  }),

  connection: t.Object({
    id: t.String(),
    platform: t.String(),
    adapterOwner: t.String(),
    adapterId: t.String(),
    displayName: t.String(),
    enabled: t.Boolean(),
    secretRefs: jsonRecord,
    config: jsonRecord,
    healthStatus,
    healthMessage: nullableString,
    lastStartedAt: t.Union([t.Number(), t.Null()]),
    lastStoppedAt: t.Union([t.Number(), t.Null()]),
    lastErrorAt: t.Union([t.Number(), t.Null()]),
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),

  channelBinding: t.Object({
    id: t.String(),
    connectionId: t.String(),
    externalWorkspaceId: t.String(),
    externalChannelId: t.String(),
    cradleWorkspaceId: t.String(),
    sessionAgentId: nullableString,
    sessionProviderTargetId: nullableString,
    sessionRuntimeKind: nullableString,
    sessionModelId: nullableString,
    boundByExternalActorId: nullableString,
    metadata: jsonRecord,
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),

  threadBinding: t.Object({
    id: t.String(),
    connectionId: t.String(),
    externalWorkspaceId: t.String(),
    externalChannelId: t.String(),
    externalThreadId: t.String(),
    sessionId: t.String(),
    cradleWorkspaceId: nullableString,
    createdByExternalActorId: nullableString,
    metadata: jsonRecord,
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),

  deliveryAttempt: t.Object({
    id: t.String(),
    connectionId: t.String(),
    externalWorkspaceId: t.String(),
    externalChannelId: t.String(),
    externalThreadId: t.String(),
    sessionId: t.String(),
    cradleMessageId: nullableString,
    runId: nullableString,
    payload: jsonRecord,
    status: t.Union([t.Literal('pending'), t.Literal('delivered'), t.Literal('failed')]),
    attemptCount: t.Number(),
    externalMessageId: nullableString,
    errorText: nullableString,
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),

  idParams: t.Object({
    id: t.String({ minLength: 1 }),
  }),

  connectionChannelParams: t.Object({
    id: t.String({ minLength: 1 }),
    externalWorkspaceId: t.String({ minLength: 1 }),
    externalChannelId: t.String({ minLength: 1 }),
  }),

  limitQuery: t.Object({
    limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
  }),

  createConnectionBody: t.Object({
    platform: t.String({ minLength: 1 }),
    adapterOwner: t.String({ minLength: 1 }),
    adapterId: t.String({ minLength: 1 }),
    displayName: t.String({ minLength: 1 }),
    enabled: t.Optional(t.Boolean()),
    secretRefs: t.Optional(jsonRecord),
    config: t.Optional(jsonRecord),
  }),

  updateConnectionBody: t.Object({
    displayName: t.Optional(t.String({ minLength: 1 })),
    enabled: t.Optional(t.Boolean()),
    secretRefs: t.Optional(jsonRecord),
    config: t.Optional(jsonRecord),
  }),

  bindChannelBody: t.Object({
    cradleWorkspaceId: t.String({ minLength: 1 }),
    sessionAgentId: t.Optional(nullableString),
    sessionProviderTargetId: t.Optional(nullableString),
    sessionRuntimeKind: t.Optional(nullableString),
    sessionModelId: t.Optional(nullableString),
    boundByExternalActorId: t.Optional(nullableString),
    metadata: t.Optional(jsonRecord),
  }),

  retryResult: t.Object({
    attempted: t.Number(),
    delivered: t.Number(),
    failed: t.Number(),
  }),

  ok: t.Object({
    ok: t.Literal(true),
  }),
}
