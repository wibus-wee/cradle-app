import { t } from 'elysia'

const nullableString = t.Union([t.String(), t.Null()])
const nullableNumber = t.Union([t.Number(), t.Null()])

const syncStatus = t.Union([
  t.Literal('never'),
  t.Literal('ok'),
  t.Literal('warning'),
  t.Literal('error'),
  t.Literal('rate-limited'),
  t.Literal('not-modified'),
])

const registrationStatus = t.Union([
  t.Literal('registered'),
  t.Literal('unregistered'),
])

const itemSyncStatus = t.Union([
  t.Literal('active'),
  t.Literal('missing'),
  t.Literal('error'),
])

const warning = t.Object({
  code: t.String(),
  message: t.String(),
  severity: t.Union([t.Literal('info'), t.Literal('warning'), t.Literal('error')]),
})

export const ExternalIssueSourcesModel = {
  source: t.Object({
    id: t.String(),
    pluginName: t.String(),
    sourceId: t.String(),
    label: t.String(),
    description: nullableString,
    enabled: t.Boolean(),
    registrationStatus,
    capabilities: t.Record(t.String(), t.Any()),
    inventory: t.Record(t.String(), t.Any()),
    warnings: t.Array(warning),
    lastSyncStatus: syncStatus,
    lastSyncMessage: nullableString,
    lastSyncError: nullableString,
    lastSyncAt: nullableNumber,
    registeredAt: t.Number(),
  }),
  binding: t.Object({
    id: t.String(),
    workspaceId: t.String(),
    sourceKey: t.String(),
    repositoryOwner: t.String(),
    repositoryName: t.String(),
    enabled: t.Boolean(),
    scheduleEnabled: t.Boolean(),
    refreshIntervalSeconds: t.Number(),
    lastRefreshStatus: syncStatus,
    lastRefreshMessage: nullableString,
    lastRefreshError: nullableString,
    lastRefreshAt: nullableNumber,
    nextRefreshAfter: nullableNumber,
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),
  item: t.Object({
    id: t.String(),
    bindingId: t.String(),
    workspaceId: t.String(),
    statusId: nullableString,
    sourceKey: t.String(),
    externalId: t.String(),
    externalKey: t.String(),
    externalUrl: nullableString,
    repositoryOwner: t.String(),
    repositoryName: t.String(),
    number: t.Number(),
    title: t.String(),
    body: nullableString,
    sourceState: t.Union([t.Literal('open'), t.Literal('closed')]),
    labels: t.Array(t.String()),
    assignees: t.Array(t.String()),
    milestone: nullableString,
    sourceCreatedAt: nullableString,
    sourceUpdatedAt: nullableString,
    sourceClosedAt: nullableString,
    syncStatus: itemSyncStatus,
    fingerprint: t.String(),
    metadata: t.Record(t.String(), t.Any()),
    warnings: t.Array(warning),
    lastSeenAt: t.Number(),
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),
  refreshResult: t.Object({
    sourceKey: t.String(),
    bindingId: t.String(),
    workspaceId: t.String(),
    repositoryOwner: t.String(),
    repositoryName: t.String(),
    status: syncStatus,
    recordsSeen: t.Number(),
    recordsProjected: t.Number(),
    recordsMissing: t.Number(),
    notModified: t.Boolean(),
    rateLimitRemaining: nullableNumber,
    rateLimitResetAt: nullableNumber,
    message: t.Optional(t.String()),
  }),
  sourceParams: t.Object({
    sourceKey: t.String({ minLength: 1 }),
  }),
  bindingParams: t.Object({
    bindingId: t.String({ minLength: 1 }),
  }),
  itemParams: t.Object({
    id: t.String({ minLength: 1 }),
  }),
  listBindingsQuery: t.Object({
    workspaceId: t.Optional(t.String()),
    sourceKey: t.Optional(t.String()),
  }),
  listItemsQuery: t.Object({
    workspaceId: t.Optional(t.String()),
    sourceKey: t.Optional(t.String()),
    syncStatus: t.Optional(itemSyncStatus),
  }),
  createBindingBody: t.Object({
    workspaceId: t.String({ minLength: 1 }),
    repositoryOwner: t.String({ minLength: 1 }),
    repositoryName: t.String({ minLength: 1 }),
    scheduleEnabled: t.Optional(t.Boolean()),
    refreshIntervalSeconds: t.Optional(t.Number()),
    refreshNow: t.Optional(t.Boolean()),
  }),
  updateBindingBody: t.Object({
    enabled: t.Optional(t.Boolean()),
    scheduleEnabled: t.Optional(t.Boolean()),
    refreshIntervalSeconds: t.Optional(t.Number()),
  }),
  refreshSourceBody: t.Object({
    workspaceId: t.String({ minLength: 1 }),
    force: t.Optional(t.Boolean()),
  }),
  refreshBindingBody: t.Object({
    force: t.Optional(t.Boolean()),
  }),
  updateItemStatusBody: t.Object({
    statusId: t.String({ minLength: 1 }),
  }),
}
