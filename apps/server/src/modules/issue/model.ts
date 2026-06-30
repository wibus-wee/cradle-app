import { t } from 'elysia'

import { SessionModel } from '../session/model'

const priorityEnum = t.Union([
  t.Literal('none'),
  t.Literal('low'),
  t.Literal('medium'),
  t.Literal('high'),
  t.Literal('urgent'),
])

const categoryEnum = t.Union([
  t.Literal('triage'),
  t.Literal('backlog'),
  t.Literal('unstarted'),
  t.Literal('started'),
  t.Literal('completed'),
  t.Literal('canceled'),
])

const issueActorKindEnum = t.Union([
  t.Literal('user'),
  t.Literal('agent'),
  t.Literal('provider-target'),
  t.Literal('system'),
])

const issueCommentAuthorKindEnum = t.Union([
  t.Literal('user'),
  t.Literal('agent'),
  t.Literal('provider-target'),
  t.Literal('system'),
  t.Literal('system.delegated'),
  t.Literal('system.undelegated'),
])

const issueActivityValueTokenEnum = t.Union([
  t.Literal('changed'),
  t.Literal('current-user'),
  t.Literal('empty'),
  t.Literal('no-due-date'),
  t.Literal('no-labels'),
  t.Literal('no-milestone'),
  t.Literal('no-parent'),
  t.Literal('no-status'),
  t.Literal('priority-high'),
  t.Literal('priority-low'),
  t.Literal('priority-medium'),
  t.Literal('priority-none'),
  t.Literal('priority-urgent'),
  t.Literal('unassigned'),
  t.Literal('unknown-issue'),
  t.Literal('unknown-milestone'),
  t.Literal('unknown-status'),
  t.Literal('unknown-user'),
])

const issueActivityFieldEnum = t.Union([
  t.Literal('assignee'),
  t.Literal('description'),
  t.Literal('due-date'),
  t.Literal('labels'),
  t.Literal('metadata'),
  t.Literal('milestone'),
  t.Literal('parent'),
  t.Literal('priority'),
  t.Literal('status'),
  t.Literal('title'),
])

const issueActivityActionEnum = t.Union([
  t.Literal('added-description'),
  t.Literal('changed-field'),
  t.Literal('cleared-description'),
  t.Literal('renamed-issue'),
  t.Literal('updated-description'),
])

const issueActivityActor = t.Object({
  kind: issueActorKindEnum,
  id: t.Nullable(t.String()),
  displayName: t.String(),
  avatarUrl: t.Nullable(t.String()),
  label: t.Nullable(t.String()),
})

const issueActivityValue = t.Union([
  t.Object({
    kind: t.Literal('date'),
    timestamp: t.Number(),
  }),
  t.Object({
    kind: t.Literal('text'),
    text: t.String(),
  }),
  t.Object({
    kind: t.Literal('token'),
    token: issueActivityValueTokenEnum,
  }),
])

export const IssueModel = {
  status: t.Object({
    id: t.String(),
    workspaceId: t.String(),
    name: t.String(),
    color: t.Nullable(t.String()),
    category: t.String(),
    order: t.Number(),
    createdAt: t.Number(),
  }),

  milestone: t.Object({
    id: t.String(),
    workspaceId: t.String(),
    title: t.String(),
    description: t.Nullable(t.String()),
    dueDate: t.Nullable(t.Number()),
    status: t.Union([t.Literal('open'), t.Literal('closed')]),
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),

  issue: t.Object({
    id: t.String(),
    workspaceId: t.String(),
    number: t.Number(),
    statusId: t.Nullable(t.String()),
    milestoneId: t.Nullable(t.String()),
    parentIssueId: t.Nullable(t.String()),
    title: t.String(),
    description: t.Nullable(t.String()),
    priority: priorityEnum,
    labels: t.Array(t.String()),
    assigneeKind: t.Nullable(t.String()),
    assigneeId: t.Nullable(t.String()),
    dueDate: t.Nullable(t.Number()),
    createdByKind: issueActorKindEnum,
    createdById: t.String(),
    sourceChatSessionId: t.Nullable(t.String()),
    delegateAgentId: t.Nullable(t.String()),
    delegateProviderTargetId: t.Nullable(t.String()),
    contextRefs: t.String(),
    order: t.Number(),
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),

  linkedSession: SessionModel.session,

  commentAuthor: t.Object({
    kind: issueActorKindEnum,
    id: t.Nullable(t.String()),
    displayName: t.String(),
    avatarUrl: t.Nullable(t.String()),
    label: t.Nullable(t.String()),
  }),

  comment: t.Object({
    id: t.String(),
    issueId: t.String(),
    content: t.String(),
    authorKind: issueCommentAuthorKindEnum,
    authorId: t.Nullable(t.String()),
    author: issueActivityActor,
    sourceChatSessionId: t.Nullable(t.String()),
    agentActivityId: t.Nullable(t.String()),
    createdAt: t.Number(),
  }),

  activityItem: t.Object({
    id: t.String(),
    issueId: t.String(),
    kind: t.Union([t.Literal('comment'), t.Literal('created'), t.Literal('field-change')]),
    actor: issueActivityActor,
    comment: t.Nullable(t.Object({
      content: t.String(),
      systemKind: t.Nullable(t.Union([t.Literal('delegated'), t.Literal('system'), t.Literal('undelegated')])),
    })),
    fieldChange: t.Nullable(t.Object({
      action: issueActivityActionEnum,
      field: t.Nullable(issueActivityFieldEnum),
      fromValue: t.Nullable(issueActivityValue),
      toValue: t.Nullable(issueActivityValue),
    })),
    sourceChatSessionId: t.Nullable(t.String()),
    createdAt: t.Number(),
  }),

  relation: t.Object({
    id: t.String(),
    sourceIssueId: t.String(),
    targetIssueId: t.String(),
    type: t.Union([t.Literal('blocks'), t.Literal('duplicates'), t.Literal('relates_to')]),
    createdAt: t.Number(),
  }),

  fieldChange: t.Object({
    id: t.String(),
    issueId: t.String(),
    field: t.String(),
    fromValue: t.Nullable(t.String()),
    toValue: t.Nullable(t.String()),
    actorKind: issueActorKindEnum,
    actorId: t.Nullable(t.String()),
    sourceChatSessionId: t.Nullable(t.String()),
    createdAt: t.Number(),
  }),

  requiredWorkspaceIdQuery: t.Object({
    workspaceId: t.String({ minLength: 1 }),
  }),

  optionalWorkspaceIdQuery: t.Object({
    workspaceId: t.Optional(t.String({ minLength: 1 })),
  }),

  idParams: t.Object({
    id: t.String({ minLength: 1 }),
  }),

  moveIssueByStatusNameParams: t.Object({
    id: t.String({ minLength: 1 }),
    statusName: t.String({
      minLength: 1,
      description: 'Issue status name or slug, for example "In Progress" or "in_progress".',
    }),
  }),

  createStatusBody: t.Object({
    workspaceId: t.String({ minLength: 1 }),
    name: t.String({ minLength: 1 }),
    color: t.Optional(t.Nullable(t.String())),
    category: t.Optional(categoryEnum),
  }),

  updateStatusBody: t.Object({
    name: t.Optional(t.String({ minLength: 1 })),
    color: t.Optional(t.Nullable(t.String())),
  }),

  reorderStatusesBody: t.Object({
    workspaceId: t.String({ minLength: 1 }),
    orderedIds: t.Array(t.String()),
  }),

  createIssueBody: t.Object({
    workspaceId: t.String({ minLength: 1 }),
    title: t.String({ minLength: 1 }),
    description: t.Optional(t.Nullable(t.String())),
    priority: t.Optional(priorityEnum),
    labels: t.Optional(t.Array(t.String())),
    milestoneId: t.Optional(t.Nullable(t.String())),
    parentIssueId: t.Optional(t.Nullable(t.String())),
    statusId: t.Optional(t.Nullable(t.String())),
    statusName: t.Optional(t.Nullable(t.String({
      minLength: 1,
      description: 'Issue status name or slug, for example "In Progress" or "in_progress".',
    }))),
    dueDate: t.Optional(t.Nullable(t.Number())),
    assigneeKind: t.Optional(t.Nullable(t.String())),
    assigneeId: t.Optional(t.Nullable(t.String())),
  }),

  updateIssueBody: t.Object({
    title: t.Optional(t.String({ minLength: 1 })),
    description: t.Optional(t.Nullable(t.String())),
    priority: t.Optional(priorityEnum),
    labels: t.Optional(t.Array(t.String())),
    milestoneId: t.Optional(t.Nullable(t.String())),
    parentIssueId: t.Optional(t.Nullable(t.String())),
    statusId: t.Optional(t.Nullable(t.String())),
    statusName: t.Optional(t.Nullable(t.String({
      minLength: 1,
      description: 'Issue status name or slug, for example "In Progress" or "in_progress".',
    }))),
    assigneeKind: t.Optional(t.Nullable(t.String())),
    assigneeId: t.Optional(t.Nullable(t.String())),
    dueDate: t.Optional(t.Nullable(t.Number())),
    order: t.Optional(t.Number()),
  }),

  bulkUpdateBody: t.Object({
    issueIds: t.Array(t.String()),
    update: t.Object({
      statusId: t.Optional(t.Nullable(t.String())),
      priority: t.Optional(priorityEnum),
      labels: t.Optional(t.Array(t.String())),
      milestoneId: t.Optional(t.Nullable(t.String())),
      assigneeKind: t.Optional(t.Nullable(t.String())),
      assigneeId: t.Optional(t.Nullable(t.String())),
      dueDate: t.Optional(t.Nullable(t.Number())),
    }),
  }),

  addCommentBody: t.Object({
    content: t.String({ minLength: 1 }),
  }),

  createMilestoneBody: t.Object({
    workspaceId: t.String({ minLength: 1 }),
    title: t.String({ minLength: 1 }),
    description: t.Optional(t.Nullable(t.String())),
    dueDate: t.Optional(t.Nullable(t.Number())),
    status: t.Optional(t.Union([t.Literal('open'), t.Literal('closed')])),
  }),

  updateMilestoneBody: t.Object({
    title: t.Optional(t.String({ minLength: 1 })),
    description: t.Optional(t.Nullable(t.String())),
    dueDate: t.Optional(t.Nullable(t.Number())),
    status: t.Optional(t.Union([t.Literal('open'), t.Literal('closed')])),
  }),

  createRelationBody: t.Object({
    sourceIssueId: t.String({ minLength: 1 }),
    targetIssueId: t.String({ minLength: 1 }),
    type: t.Union([t.Literal('blocks'), t.Literal('duplicates'), t.Literal('relates_to')]),
  }),

  addContextRefBody: t.Object({
    ref: t.String({ minLength: 1 }),
  }),

  contextRefIndexParams: t.Object({
    id: t.String({ minLength: 1 }),
    index: t.String(),
  }),

  linkedIssueResponse: t.Object({
    issueId: t.Nullable(t.String()),
  }),

  linkIssueBody: t.Object({
    issueId: t.String({ minLength: 1 }),
  }),

  listIssuesQuery: t.Object({
    workspaceId: t.Optional(t.String({ minLength: 1 })),
    milestoneId: t.Optional(t.String()),
    parentIssueId: t.Optional(t.String()),
    priority: t.Optional(t.String()),
    labels: t.Optional(t.Union([t.Array(t.String()), t.String()])),
    statusId: t.Optional(t.String()),
  }),
}
