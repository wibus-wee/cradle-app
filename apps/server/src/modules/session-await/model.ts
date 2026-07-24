import { t } from 'elysia'

const nonBlankString = t.String({ minLength: 1, pattern: '.*\\S.*' })

const awaitStatusEnum = t.Union([
  t.Literal('pending'),
  t.Literal('triggered'),
  t.Literal('expired'),
  t.Literal('cancelled'),
  t.Literal('failed'),
])

const awaitFailureKindEnum = t.Union([
  t.Literal('source'),
  t.Literal('delivery'),
])

export const SessionAwaitModel = {
  sessionAwait: t.Object({
    id: t.String(),
    chatSessionId: t.String(),
    workspaceId: t.String(),
    source: t.String(),
    filterJson: t.String(),
    status: awaitStatusEnum,
    reason: t.Nullable(t.String()),
    resumeText: t.Nullable(t.String()),
    resumePayloadJson: t.Nullable(t.String()),
    failureKind: t.Nullable(awaitFailureKindEnum),
    bypassedChecksJson: t.Nullable(t.String()),
    createdAt: t.Number(),
    triggeredAt: t.Nullable(t.Number()),
    expiresAt: t.Nullable(t.Number()),
    fireAt: t.Nullable(t.Number()),
    lastCheckedAt: t.Nullable(t.Number()),
    lastErrorText: t.Nullable(t.String()),
    consecutiveErrorCount: t.Number(),
  }),

  summary: t.Object({
    awaiting: t.Boolean(),
    pendingCount: t.Number(),
    primaryAwaitId: t.Nullable(t.String()),
    primarySource: t.Nullable(t.String()),
    reason: t.Nullable(t.String()),
  }),

  idParams: t.Object({
    id: t.String({ minLength: 1 }),
  }),

  listQuery: t.Object({
    sessionId: t.String({ minLength: 1 }),
  }),

  createBody: t.Object({
    chatSessionId: t.String({ minLength: 1 }),
    workspaceId: t.String({ minLength: 1 }),
    source: t.String({ minLength: 1 }),
    filterJson: t.String({ minLength: 1 }),
    reason: t.Optional(t.Nullable(t.String())),
    expiresAt: t.Optional(t.Nullable(t.Number())),
    fireAt: t.Optional(t.Nullable(t.Number())),
  }),

  triggerBody: t.Object({
    resumeText: nonBlankString,
    resumePayloadJson: t.Optional(t.Nullable(t.String())),
  }),

  retryDeliveryBody: t.Object({
    resumeText: t.Optional(nonBlankString),
    resumePayloadJson: t.Optional(t.Nullable(t.String())),
  }),

  summaryQuery: t.Object({
    sessionId: t.String({ minLength: 1 }),
  }),

  bypassCheckBody: t.Object({
    checkName: t.String({ minLength: 1 }),
  }),

  bypassRule: t.Object({
    id: t.String(),
    workspaceId: t.String(),
    repo: t.String(),
    checkPattern: t.String(),
    enabled: t.Number(),
    createdAt: t.Number(),
  }),

  bypassRulesQuery: t.Object({
    workspaceId: t.String({ minLength: 1 }),
  }),

  createBypassRuleBody: t.Object({
    workspaceId: t.String({ minLength: 1 }),
    repo: t.String({ minLength: 1 }),
    checkPattern: t.String({ minLength: 1 }),
  }),

  toggleBypassRuleBody: t.Object({
    enabled: t.Boolean(),
  }),

  discoveredReposQuery: t.Object({
    workspaceId: t.String({ minLength: 1 }),
  }),

  availableChecksQuery: t.Object({
    owner: t.String({ minLength: 1 }),
    repo: t.String({ minLength: 1 }),
  }),

  availableCheck: t.Object({
    name: t.String(),
    required: t.Boolean(),
    source: t.Union([t.Literal('check-run'), t.Literal('status')]),
  }),

  availableChecksResponse: t.Object({
    owner: t.String(),
    repo: t.String(),
    defaultBranch: t.String(),
    checks: t.Array(t.Object({
      name: t.String(),
      required: t.Boolean(),
      source: t.Union([t.Literal('check-run'), t.Literal('status')]),
    })),
  }),
}
