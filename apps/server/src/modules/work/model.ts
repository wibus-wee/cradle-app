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

const work = t.Object({
  id: t.String(),
  title: t.String(),
  objective: t.String(),
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
})

const detail = t.Object({
  work,
  primaryThread: SessionModel.session,
  execution: SessionModel.isolationView,
  readiness,
  pullRequest: t.Nullable(pullRequestViewSchema),
  activity,
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
  detail,
  activity,
  readiness,

  idParams: t.Object({
    id: t.String({ minLength: 1 }),
  }),

  listQuery: t.Object({
    workspaceId: t.Optional(t.String({ minLength: 1 })),
    linkedIssueId: t.Optional(t.String({ minLength: 1 })),
    archived: t.Optional(t.Boolean()),
  }),

  createBody: t.Object({
    workspaceId: t.String({ minLength: 1 }),
    title: t.String({ minLength: 1 }),
    goal: t.Optional(t.String({ minLength: 1 })),
    objective: t.Optional(t.String({ minLength: 1 })),
    linkedIssueId: t.Optional(t.String({ minLength: 1 })),
    /**
     * How to choose the isolation base commit.
     * - `source-head` (default): local HEAD; requires a clean source checkout.
     * - `remote-default`: remote-tracking default branch tip (e.g. origin/main);
     *   allowed even when the source checkout is dirty.
     */
    baseStrategy: t.Optional(t.Union([
      t.Literal('source-head'),
      t.Literal('remote-default'),
    ])),
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
