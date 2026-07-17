import { t } from 'elysia'

import { sessionRuntimeSettingsPatchSchema } from '../chat-runtime/runtime-settings-model'
import { WorktreeModel } from '../worktree/model'

const runtimeKindSchema = t.String({ minLength: 1 })

const nullableString = t.Nullable(t.String())
const nullableRequiredString = t.Nullable(t.String({ minLength: 1 }))
const thinkingEffortSchema = t.Union([
  t.Literal('none'),
  t.Literal('minimal'),
  t.Literal('low'),
  t.Literal('medium'),
  t.Literal('high'),
  t.Literal('xhigh'),
  t.Literal('max'),
  t.Literal('ultra'),
])
const sessionStatusSchema = t.Union([t.Literal('idle'), t.Literal('streaming'), t.Literal('error')])
const sideContextSourceSchema = t.Union([t.Literal('provider-native'), t.Literal('cradle-context')])

const sessionExecutionSchema = t.Union([
  t.Object({
    kind: t.Literal('local'),
  }),
  t.Object({
    kind: t.Literal('remote-host'),
    hostId: t.String(),
    remoteSessionId: t.String(),
  }),
])

export const SessionModel = {
  session: t.Object({
    id: t.String(),
    execution: sessionExecutionSchema,
    parentSessionId: nullableString,
    sideContextSource: t.Nullable(sideContextSourceSchema),
    workspaceId: nullableString,
    title: nullableString,
    origin: t.String(),
    providerTargetId: nullableString,
    agentId: nullableString,
    modelId: nullableString,
    thinkingEffort: t.Nullable(thinkingEffortSchema),
    linkedIssueId: nullableString,
    sessionGroupId: nullableString,
    runtimeKind: runtimeKindSchema,
    status: sessionStatusSchema,
    pinned: t.Number(),
    archivedAt: t.Nullable(t.Number()),
    lastReadAt: t.Nullable(t.Number()),
    createdAt: t.Number(),
    updatedAt: t.Number(),
    latestUserMessageAt: t.Nullable(t.Number()),
    latestAssistantMessageAt: t.Nullable(t.Number()),
    unread: t.Boolean(),
    isIsolated: t.Boolean(),
    worktreeId: t.Nullable(t.String()),
    worktreeBranch: t.Nullable(t.String()),
    worktreePath: t.Nullable(t.String()),
    worktreeHealth: t.Nullable(WorktreeModel.worktreeHealth),
    pendingWorktreeId: t.Nullable(t.String()),
    isolationBoundaryRequired: t.Boolean(),
  }),

  isolationView: t.Object({
    isIsolated: t.Boolean(),
    worktreeId: t.Nullable(t.String()),
    worktreeBranch: t.Nullable(t.String()),
    worktreePath: t.Nullable(t.String()),
    worktreeHealth: t.Nullable(WorktreeModel.worktreeHealth),
    pendingWorktreeId: t.Nullable(t.String()),
    isolationBoundaryRequired: t.Boolean(),
  }),

  isolationStartBody: t.Object({
    slug: t.Optional(t.String({ minLength: 1 })),
  }),

  isolationStartResponse: t.Object({
    worktree: WorktreeModel.worktreeView,
    pending: t.Boolean(),
  }),

  isolationActivateBody: t.Object({
    mode: t.Union([
      t.Literal('migrate'),
      t.Literal('leave-main'),
      t.Literal('cancel'),
    ]),
  }),

  isolationAttachBody: t.Object({
    worktreeId: t.String({ minLength: 1 }),
  }),

  createBody: t.Object({
    workspaceId: t.Optional(nullableRequiredString),
    title: t.String({ minLength: 1 }),
    origin: t.Optional(t.String({ minLength: 1 })),
    providerTargetId: t.Optional(t.String({ minLength: 1 })),
    modelId: t.Optional(nullableRequiredString),
    agentId: t.Optional(t.String({ minLength: 1 })),
    acpAgentId: t.Optional(t.String({ minLength: 1 })),
    acpDraftSessionId: t.Optional(t.String({ minLength: 1 })),
    runtimeKind: t.Optional(runtimeKindSchema),
    runtimeSettings: t.Optional(sessionRuntimeSettingsPatchSchema),
    thinkingEffort: t.Optional(thinkingEffortSchema),
    linkedIssueId: t.Optional(nullableRequiredString),
    sessionGroupId: t.Optional(nullableRequiredString),
    worktreeId: t.Optional(t.String({ minLength: 1 })),
    id: t.Optional(t.String()),
  }),

  exportMarkdownResponse: t.Object({
    markdown: t.String(),
  }),

  idParams: t.Object({
    id: t.String({ minLength: 1 }),
  }),

  listQuery: t.Object({
    workspaceId: t.Optional(t.String({ minLength: 1 })),
    origin: t.Optional(t.String({ minLength: 1 })),
    sessionGroupId: t.Optional(t.String({ minLength: 1 })),
    archived: t.Optional(t.Boolean()),
  }),

  updateBody: t.Object({
    title: t.Optional(t.String({ minLength: 1 })),
    pinned: t.Optional(t.Boolean()),
    providerTargetId: t.Optional(t.String({ minLength: 1 })),
    modelId: t.Optional(nullableRequiredString),
    thinkingEffort: t.Optional(t.Nullable(thinkingEffortSchema)),
    sessionGroupId: t.Optional(nullableRequiredString),
  }),

  archiveBody: t.Object({
    archived: t.Boolean(),
  }),
}
