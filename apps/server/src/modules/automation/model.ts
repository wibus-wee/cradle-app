import { t } from 'elysia'

const runtimeKindSchema = t.String({ minLength: 1 })

const automationInputSchema = t.Union([
  t.Object({
    type: t.Literal('file_ref'),
    path: t.String({ minLength: 1 }),
  }, { additionalProperties: false }),
  t.Object({
    type: t.Literal('inline_file'),
    name: t.String({ minLength: 1 }),
    content: t.String(),
  }, { additionalProperties: false }),
  t.Object({
    type: t.Literal('text'),
    name: t.String({ minLength: 1 }),
    content: t.String(),
  }, { additionalProperties: false }),
  t.Object({
    type: t.Literal('url'),
    url: t.String({ minLength: 1 }),
  }, { additionalProperties: false }),
])

const artifactRequestSchema = t.Object({
  kind: t.Union([t.Literal('markdown'), t.Literal('text'), t.Literal('json'), t.Literal('file_ref')]),
  name: t.String({ minLength: 1 }),
  description: t.Optional(t.String()),
}, { additionalProperties: false })

const triggerSchema = t.Object({
  type: t.Literal('rrule'),
  rrule: t.String({ minLength: 1 }),
  timezone: t.String({ minLength: 1 }),
  misfirePolicy: t.Optional(t.Union([t.Literal('skip'), t.Literal('run_latest')])),
}, { additionalProperties: false })

const recipeSchema = t.Object({
  kind: t.Literal('agent_task'),
  prompt: t.String({ minLength: 1 }),
  inputs: t.Array(automationInputSchema),
  artifactRequests: t.Array(artifactRequestSchema),
  agentId: t.Optional(t.String({ minLength: 1 })),
  providerTargetId: t.Optional(t.String({ minLength: 1 })),
  runtimeKind: t.Optional(runtimeKindSchema),
  modelId: t.Optional(t.String({ minLength: 1 })),
  thinkingEffort: t.Optional(t.Union([
    t.Literal('none'),
    t.Literal('minimal'),
    t.Literal('low'),
    t.Literal('medium'),
    t.Literal('high'),
    t.Literal('xhigh'),
    t.Literal('max'),
  ])),
  sessionPolicy: t.Optional(t.Union([t.Literal('new'), t.Literal('heartbeat')])),
  isolationPolicy: t.Optional(t.Union([t.Literal('workspace'), t.Literal('worktree_per_run')])),
  completionPolicy: t.Optional(t.Object({
    stopWhen: t.Optional(t.Literal('agent_complete')),
    noFindingsBehavior: t.Optional(t.Union([t.Literal('archive'), t.Literal('triage')])),
  }, { additionalProperties: false })),
}, { additionalProperties: false })

const createdByKindSchema = t.Union([t.Literal('agent'), t.Literal('user'), t.Literal('system')])
const runStatusSchema = t.Union([
  t.Literal('queued'),
  t.Literal('running'),
  t.Literal('complete'),
  t.Literal('failed'),
  t.Literal('cancelled'),
])

export const AutomationModel = {
  trigger: triggerSchema,
  recipe: recipeSchema,

  idParams: t.Object({
    id: t.String({ minLength: 1 }),
  }, { additionalProperties: false }),

  runIdParams: t.Object({
    id: t.String({ minLength: 1 }),
    runId: t.String({ minLength: 1 }),
  }, { additionalProperties: false }),

  artifactIdParams: t.Object({
    id: t.String({ minLength: 1 }),
    artifactId: t.String({ minLength: 1 }),
  }, { additionalProperties: false }),

  cronJobIdParams: t.Object({
    id: t.String({ minLength: 1 }),
  }, { additionalProperties: false }),

  cronRunsQuery: t.Object({
    jobId: t.String({ minLength: 1 }),
  }, { additionalProperties: false }),

  listQuery: t.Object({
    workspaceId: t.Optional(t.String({ minLength: 1 })),
    enabled: t.Optional(t.Boolean()),
  }, { additionalProperties: false }),

  createBody: t.Object({
    id: t.Optional(t.String({ minLength: 1 })),
    workspaceId: t.Optional(t.Nullable(t.String({ minLength: 1 }))),
    title: t.String({ minLength: 1 }),
    description: t.Optional(t.String()),
    enabled: t.Optional(t.Boolean()),
    trigger: triggerSchema,
    recipe: recipeSchema,
    createdByKind: t.Optional(createdByKindSchema),
    createdById: t.Optional(t.Nullable(t.String({ minLength: 1 }))),
  }, { additionalProperties: false }),

  updateBody: t.Object({
    title: t.Optional(t.String({ minLength: 1 })),
    description: t.Optional(t.String()),
    trigger: t.Optional(triggerSchema),
    recipe: t.Optional(recipeSchema),
    createdByKind: t.Optional(createdByKindSchema),
    createdById: t.Optional(t.Nullable(t.String({ minLength: 1 }))),
  }, { additionalProperties: false }),

  cronCreateBody: t.Object({
    id: t.String({ minLength: 1 }),
    workspaceId: t.Optional(t.Nullable(t.String({ minLength: 1 }))),
    title: t.String({ minLength: 1 }),
    description: t.Optional(t.String()),
    enabled: t.Optional(t.Boolean()),
    scheduleKind: t.Literal('rrule'),
    scheduleConfig: t.String({ minLength: 1 }),
    timezone: t.String({ minLength: 1 }),
    prompt: t.String({ minLength: 1 }),
    providerTargetId: t.Optional(t.String({ minLength: 1 })),
    modelId: t.Optional(t.String({ minLength: 1 })),
  }, { additionalProperties: false }),

  cronUpdateBody: t.Object({
    title: t.Optional(t.String({ minLength: 1 })),
    description: t.Optional(t.String()),
    enabled: t.Optional(t.Boolean()),
    scheduleKind: t.Optional(t.Literal('rrule')),
    scheduleConfig: t.Optional(t.String({ minLength: 1 })),
    timezone: t.Optional(t.String({ minLength: 1 })),
    prompt: t.Optional(t.String({ minLength: 1 })),
    providerTargetId: t.Optional(t.String({ minLength: 1 })),
    modelId: t.Optional(t.String({ minLength: 1 })),
  }, { additionalProperties: false }),

  runNowBody: t.Object({
    occurrenceKey: t.Optional(t.String({ minLength: 1 })),
    scheduledFor: t.Optional(t.Number()),
  }, { additionalProperties: false }),

  triageQuery: t.Object({
    workspaceId: t.Optional(t.String({ minLength: 1 })),
    status: t.Optional(t.Union([t.Literal('unread'), t.Literal('read'), t.Literal('resolved'), t.Literal('archived'), t.Literal('all')])),
  }, { additionalProperties: false }),

  triageBody: t.Object({
    status: t.Union([t.Literal('unread'), t.Literal('read'), t.Literal('resolved'), t.Literal('archived')]),
  }, { additionalProperties: false }),

  definition: t.Object({
    id: t.String(),
    workspaceId: t.Nullable(t.String()),
    title: t.String(),
    description: t.String(),
    enabled: t.Boolean(),
    trigger: triggerSchema,
    recipe: recipeSchema,
    createdByKind: createdByKindSchema,
    createdById: t.Nullable(t.String()),
    lastRunAt: t.Nullable(t.Number()),
    nextRunAt: t.Nullable(t.Number()),
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),

  run: t.Object({
    id: t.String(),
    automationDefinitionId: t.String(),
    workspaceId: t.Nullable(t.String()),
    triggerType: t.Union([t.Literal('manual'), t.Literal('scheduled')]),
    occurrenceKey: t.Nullable(t.String()),
    status: runStatusSchema,
    triggerSnapshot: triggerSchema,
    recipeSnapshot: recipeSchema,
    chatSessionId: t.Nullable(t.String()),
    backendRunId: t.Nullable(t.String()),
    artifactCount: t.Number(),
    errorText: t.Nullable(t.String()),
    resultKind: t.Nullable(t.Union([t.Literal('findings'), t.Literal('no_findings'), t.Literal('stopped'), t.Literal('error')])),
    resultSummary: t.Nullable(t.String()),
    triageStatus: t.Nullable(t.Union([t.Literal('unread'), t.Literal('read'), t.Literal('resolved'), t.Literal('archived')])),
    triagedAt: t.Nullable(t.Number()),
    scheduledFor: t.Nullable(t.Number()),
    claimedAt: t.Nullable(t.Number()),
    startedAt: t.Nullable(t.Number()),
    finishedAt: t.Nullable(t.Number()),
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),

  artifact: t.Object({
    id: t.String(),
    automationRunId: t.String(),
    automationDefinitionId: t.Nullable(t.String()),
    kind: t.Union([t.Literal('markdown'), t.Literal('text'), t.Literal('json'), t.Literal('file_ref')]),
    name: t.String(),
    mimeType: t.Nullable(t.String()),
    content: t.Nullable(t.String()),
    metadata: t.Record(t.String(), t.Any()),
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),

  ok: t.Object({
    ok: t.Literal(true),
  }),
}
