import { t } from 'elysia'

const nullableString = t.Nullable(t.String())
const nullableRequiredString = t.Nullable(t.String({ minLength: 1 }))
const sessionGroupStatusSchema = t.Union([t.Literal('active'), t.Literal('archived')])
const aggregateStatusSchema = t.Union([
  t.Literal('idle'),
  t.Literal('streaming'),
  t.Literal('error'),
])

const sessionMemberSummarySchema = t.Object({
  id: t.String(),
  title: t.Nullable(t.String()),
  status: aggregateStatusSchema,
  latestUserMessageAt: t.Nullable(t.Number()),
})

/**
 * Issue–execution association transition produced when an update writes
 * `linkedIssueId`. The shape matches `IssueModel.executionAssociationTransition`;
 * it is declared here because Session Group owns its own wire contract and
 * must not depend on Issue module internals.
 */
const sessionGroupAssociationTransitionSchema = t.Object({
  participantKind: t.Literal('session-group'),
  participantId: t.String(),
  previousIssueId: t.Nullable(t.String()),
  nextIssueId: t.Nullable(t.String()),
})

const sessionGroupDetailSchema = t.Object({
  id: t.String(),
  workspaceId: t.String(),
  title: t.String(),
  description: nullableString,
  linkedIssueId: nullableString,
  status: sessionGroupStatusSchema,
  configJson: t.String(),
  archivedAt: t.Nullable(t.Number()),
  createdAt: t.Number(),
  updatedAt: t.Number(),
  sessionCount: t.Number(),
  statusAggregate: aggregateStatusSchema,
  latestActivityAt: t.Nullable(t.Number()),
  sessions: t.Array(sessionMemberSummarySchema),
})

export const SessionGroupModel = {
  sessionGroup: t.Object({
    id: t.String(),
    workspaceId: t.String(),
    title: t.String(),
    description: nullableString,
    linkedIssueId: nullableString,
    status: sessionGroupStatusSchema,
    configJson: t.String(),
    archivedAt: t.Nullable(t.Number()),
    createdAt: t.Number(),
    updatedAt: t.Number(),
    sessionCount: t.Number(),
    statusAggregate: aggregateStatusSchema,
    latestActivityAt: t.Nullable(t.Number()),
  }),

  sessionGroupDetail: sessionGroupDetailSchema,

  createBody: t.Object({
    workspaceId: t.String({ minLength: 1 }),
    title: t.String({ minLength: 1 }),
    description: t.Optional(nullableRequiredString),
    linkedIssueId: t.Optional(nullableRequiredString),
    sessionIds: t.Optional(t.Array(t.String({ minLength: 1 }))),
  }),

  updateBody: t.Object({
    title: t.Optional(t.String({ minLength: 1 })),
    description: t.Optional(nullableRequiredString),
    linkedIssueId: t.Optional(nullableRequiredString),
    archived: t.Optional(t.Boolean()),
  }),

  updateResponse: t.Object({
    group: sessionGroupDetailSchema,
    association: t.Union([sessionGroupAssociationTransitionSchema, t.Null()]),
  }),

  addMembersBody: t.Object({
    sessionIds: t.Array(t.String({ minLength: 1 }), { minItems: 1 }),
  }),

  listQuery: t.Object({
    workspaceId: t.Optional(t.String({ minLength: 1 })),
    linkedIssueId: t.Optional(t.String({ minLength: 1 })),
    archived: t.Optional(t.Boolean()),
  }),

  idParams: t.Object({
    id: t.String({ minLength: 1 }),
  }),

  memberParams: t.Object({
    id: t.String({ minLength: 1 }),
    sessionId: t.String({ minLength: 1 }),
  }),
}
