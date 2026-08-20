import { t } from 'elysia'

import { sessionRuntimeSettingsPatchSchema } from '../chat-runtime/runtime-settings-model'
import { pullRequestViewSchema } from '../pull-request/model'
import { SessionModel } from '../session/model'

const nullableString = t.Nullable(t.String())
const nullableTimestamp = t.Nullable(t.Number())
const activity = t.Union([
  t.Literal('idle'),
  t.Literal('running'),
  t.Literal('waiting'),
  t.Literal('blocked'),
])

const state = t.Union([
  t.Literal('draft'),
  t.Literal('queued'),
  t.Literal('preparing'),
  t.Literal('running'),
  t.Literal('awaiting_human'),
  t.Literal('awaiting_dependency'),
  t.Literal('verifying'),
  t.Literal('ready_for_review'),
  t.Literal('merging'),
  t.Literal('done'),
  t.Literal('failed'),
  t.Literal('cancelled'),
  t.Literal('archived'),
  t.Literal('unknown'),
])

const stateAuthority = t.Union([
  t.Literal('official_hook'),
  t.Literal('runtime_integration'),
  t.Literal('terminal_recognizer'),
  t.Literal('user_override'),
  t.Literal('derived'),
])

const stateExplanation = t.Object({
  trigger: t.String(),
  evidence: t.String(),
  authority: stateAuthority,
  responsible: t.Union([
    t.Literal('user'),
    t.Literal('agent'),
    t.Literal('dependency'),
    t.Literal('system'),
  ]),
  nextAction: t.String(),
  observedAt: t.Number(),
})

const recovery = t.Object({
  level: t.Union([
    t.Literal('live'),
    t.Literal('resumable'),
    t.Literal('restorable'),
    t.Literal('reproducible'),
    t.Literal('unknown'),
  ]),
  evidence: t.String(),
  lastHeartbeatAt: nullableTimestamp,
})

const projection = {
  state,
  stateSinceAt: t.Number(),
  stateExplanation,
  recovery,
}

const work = t.Object({
  id: t.String(),
  title: t.String(),
  objective: t.String(),
  acceptanceCriteria: t.Array(t.String()),
  linkedIssueId: nullableString,
  handoffTitle: nullableString,
  handoffSummary: nullableString,
  handoffTestPlan: nullableString,
  preparedAt: nullableTimestamp,
  lastSubmittedAt: nullableTimestamp,
  closedAt: nullableTimestamp,
  archivedAt: nullableTimestamp,
  createdAt: t.Number(),
  updatedAt: t.Number(),
})

const readiness = t.Object({
  isolated: t.Boolean(),
  clean: t.Boolean(),
  branch: nullableString,
  baseRef: nullableString,
  commitsAhead: t.Number(),
  changedFiles: t.Number(),
})

const summary = t.Object({
  ...work.properties,
  workspaceId: t.String(),
  primarySessionId: t.String(),
  activity,
  pullRequest: t.Nullable(pullRequestViewSchema),
  ...projection,
})

const detail = t.Object({
  work,
  primaryThread: SessionModel.session,
  execution: SessionModel.isolationView,
  readiness,
  pullRequest: t.Nullable(pullRequestViewSchema),
  activity,
  ...projection,
})

const attentionItem = t.Object({
  id: t.String(),
  category: t.Union([
    t.Literal('approve_or_answer'),
    t.Literal('handle_failure'),
    t.Literal('review_work'),
    t.Literal('merge_or_archive'),
  ]),
  risk: t.Union([t.Literal('low'), t.Literal('medium'), t.Literal('high')]),
  workId: t.String(),
  workTitle: t.String(),
  workspaceId: t.String(),
  sessionId: t.String(),
  runtimeKind: t.String(),
  providerTargetId: nullableString,
  agentId: nullableString,
  state,
  stateSinceAt: t.Number(),
  waitingSeconds: t.Number(),
  reason: t.String(),
  authority: stateAuthority,
  nextAction: t.String(),
  recovery,
})

const thinkingEffort = t.Union([
  t.Literal('none'),
  t.Literal('minimal'),
  t.Literal('low'),
  t.Literal('medium'),
  t.Literal('high'),
  t.Literal('xhigh'),
  t.Literal('max'),
  t.Literal('ultra'),
])

export const WorkModel = {
  work,
  summary,
  page: t.Object({
    items: t.Array(summary),
    nextCursor: t.Nullable(t.String()),
  }),
  detail,
  activity,
  readiness,
  state,
  stateExplanation,
  recovery,
  attentionItem,

  idParams: t.Object({
    id: t.String({ minLength: 1 }),
  }),

  listQuery: t.Object({
    workspaceId: t.Optional(t.String({ minLength: 1 })),
    linkedIssueId: t.Optional(t.String({ minLength: 1 })),
    archived: t.Optional(t.Boolean()),
    cursor: t.Optional(t.String({ minLength: 1 })),
    limit: t.Optional(t.Numeric({ minimum: 1, maximum: 200 })),
  }),

  createBody: t.Object({
    workspaceId: t.String({ minLength: 1 }),
    title: t.String({ minLength: 1 }),
    goal: t.Optional(t.String({ minLength: 1 })),
    objective: t.Optional(t.String({ minLength: 1 })),
    acceptanceCriteria: t.Optional(t.Array(t.String({ minLength: 1 }), { maxItems: 50 })),
    linkedIssueId: t.Optional(t.String({ minLength: 1 })),
    /**
     * Exact local or remote branch ref to use as the isolation base.
     * When omitted, the current workspace HEAD is used.
     */
    baseBranch: t.Optional(t.String({ minLength: 1 })),
    providerTargetId: t.Optional(t.String({ minLength: 1 })),
    modelId: t.Optional(t.Nullable(t.String({ minLength: 1 }))),
    thinkingEffort: t.Optional(thinkingEffort),
    runtimeKind: t.Optional(t.String({ minLength: 1 })),
    runtimeSettings: t.Optional(sessionRuntimeSettingsPatchSchema),
    agentId: t.Optional(t.String({ minLength: 1 })),
  }),

  archiveBody: t.Object({
    archived: t.Boolean(),
  }),

  prepareBody: t.Object({
    title: t.String({ minLength: 1 }),
    summary: t.String({ minLength: 1 }),
    testPlan: t.String({ minLength: 1 }),
  }),

  submitBody: t.Object({
    title: t.Optional(t.String({ minLength: 1 })),
    summary: t.Optional(t.String({ minLength: 1 })),
    testPlan: t.Optional(t.String({ minLength: 1 })),
    base: t.Optional(t.String({ minLength: 1 })),
  }),

  renameBranchBody: t.Object({
    branch: t.String({ minLength: 1 }),
  }),

  sessionResolution: t.Object({
    work: t.Nullable(summary),
  }),
}
