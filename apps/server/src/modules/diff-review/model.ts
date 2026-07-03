import { t } from 'elysia'

const reviewStatus = t.Union([t.Literal('open'), t.Literal('merged'), t.Literal('closed'), t.Literal('abandoned')])
const reviewState = t.Union([
  t.Literal('unreviewed'),
  t.Literal('in-review'),
  t.Literal('changes-requested'),
  t.Literal('approved'),
  t.Literal('commented'),
])
const sourceKind = t.Union([
  t.Literal('local-working-tree'),
  t.Literal('local-branch-compare'),
  t.Literal('local-commit'),
  t.Literal('agent-change-set'),
  t.Literal('github-pull-request'),
  t.Literal('external-import'),
])
const fileStatus = t.Union([
  t.Literal('added'),
  t.Literal('modified'),
  t.Literal('deleted'),
  t.Literal('renamed'),
  t.Literal('untracked'),
])

const revision = t.Object({
  id: t.String(),
  reviewId: t.String(),
  sourceVersion: t.String(),
  patchHash: t.String(),
  fileCount: t.Number(),
  additions: t.Number(),
  deletions: t.Number(),
  generatedAt: t.Number(),
  patch: t.String(),
})

const file = t.Object({
  id: t.String(),
  revisionId: t.String(),
  path: t.String(),
  previousPath: t.Nullable(t.String()),
  status: fileStatus,
  additions: t.Number(),
  deletions: t.Number(),
  isGenerated: t.Boolean(),
  isBinary: t.Boolean(),
  isViewed: t.Boolean(),
})

const rangeAnchor = t.Object({
  revisionId: t.String(),
  fileId: t.String(),
  path: t.String(),
  side: t.Union([t.Literal('base'), t.Literal('head')]),
  startLine: t.Number(),
  endLine: t.Number(),
  startColumn: t.Optional(t.Number()),
  endColumn: t.Optional(t.Number()),
  hunkHeader: t.String(),
  lineHash: t.String(),
  contextBeforeHash: t.Optional(t.String()),
  contextAfterHash: t.Optional(t.String()),
})

const rangeAnchorInput = t.Object({
  fileId: t.String({ minLength: 1 }),
  side: t.Optional(t.Union([t.Literal('base'), t.Literal('head')])),
  startLine: t.Number({ minimum: 1 }),
  endLine: t.Optional(t.Number({ minimum: 1 })),
  startColumn: t.Optional(t.Number({ minimum: 1 })),
  endColumn: t.Optional(t.Number({ minimum: 1 })),
}, { additionalProperties: false })

const comment = t.Object({
  id: t.String(),
  threadId: t.String(),
  authorKind: t.Union([t.Literal('user'), t.Literal('agent'), t.Literal('external')]),
  authorId: t.String(),
  bodyMarkdown: t.String(),
  externalUrl: t.Nullable(t.String()),
  createdAt: t.Number(),
  updatedAt: t.Number(),
})

const reaction = t.Object({
  id: t.String(),
  threadId: t.String(),
  userId: t.String(),
  reaction: t.String(),
  createdAt: t.Number(),
})

const thread = t.Object({
  id: t.String(),
  reviewId: t.String(),
  originalRevisionId: t.String(),
  currentRevisionId: t.Nullable(t.String()),
  fileId: t.Nullable(t.String()),
  anchor: t.Nullable(rangeAnchor),
  state: t.Union([t.Literal('open'), t.Literal('resolved'), t.Literal('stale')]),
  createdBy: t.String(),
  createdAt: t.Number(),
  updatedAt: t.Number(),
  resolvedBy: t.Nullable(t.String()),
  resolvedAt: t.Nullable(t.Number()),
  comments: t.Array(comment),
  reactions: t.Array(reaction),
})

const submission = t.Object({
  id: t.String(),
  reviewId: t.String(),
  revisionId: t.String(),
  actorId: t.String(),
  decision: t.Union([t.Literal('approve'), t.Literal('request-changes'), t.Literal('comment')]),
  bodyMarkdown: t.Nullable(t.String()),
  submittedAt: t.Number(),
  sourceSyncState: t.Union([t.Literal('local-only'), t.Literal('pending'), t.Literal('synced'), t.Literal('failed')]),
})

const preferences = t.Object({
  id: t.String(),
  workspaceId: t.String(),
  userId: t.String(),
  diffStyle: t.Union([t.Literal('split'), t.Literal('unified')]),
  codeTheme: t.String(),
  fontSize: t.Number(),
  lineHeight: t.Number(),
  hideWhitespaceOnly: t.Boolean(),
  structuralHighlighting: t.Boolean(),
  collapseGeneratedFiles: t.Boolean(),
  notificationMode: t.Union([
    t.Literal('all-activity'),
    t.Literal('all-activity-by-people'),
    t.Literal('reviews-and-comments'),
    t.Literal('reviews-and-comments-by-people'),
    t.Literal('none'),
  ]),
  createdAt: t.Number(),
  updatedAt: t.Number(),
})

const event = t.Object({
  id: t.String(),
  reviewId: t.String(),
  eventKind: t.String(),
  actorKind: t.Union([t.Literal('user'), t.Literal('agent'), t.Literal('external'), t.Literal('system')]),
  actorId: t.Nullable(t.String()),
  payload: t.Any(),
  createdAt: t.Number(),
})

const guideRuntimeKind = t.String({ minLength: 1 })
const guideStatus = t.Union([
  t.Literal('pending'),
  t.Literal('running'),
  t.Literal('ready'),
  t.Literal('failed'),
  t.Literal('cancelled'),
])

const guide = t.Object({
  revisionId: t.Nullable(t.String()),
  status: t.Nullable(guideStatus),
  providerTargetId: t.Nullable(t.String()),
  runtimeKind: t.Nullable(guideRuntimeKind),
  modelId: t.Nullable(t.String()),
  sessionId: t.Nullable(t.String()),
  runId: t.Nullable(t.String()),
  errorMessage: t.Nullable(t.String()),
  createdAt: t.Nullable(t.Number()),
  updatedAt: t.Nullable(t.Number()),
  title: t.Nullable(t.String()),
  steps: t.Array(t.Object({
    id: t.String(),
    title: t.String(),
    rationale: t.String(),
    fileIds: t.Array(t.String()),
    threadIds: t.Array(t.String()),
    anchors: t.Array(rangeAnchor),
    order: t.Number(),
  })),
})

const agentFix = t.Object({
  id: t.String(),
  reviewId: t.String(),
  targetRevisionId: t.Nullable(t.String()),
  threadId: t.Nullable(t.String()),
  anchor: t.Nullable(rangeAnchor),
  instruction: t.String(),
  profileId: t.Nullable(t.String()),
  expectedOutput: t.Union([t.Literal('commit'), t.Literal('working-tree-change'), t.Literal('patch-artifact')]),
  status: t.Union([t.Literal('pending'), t.Literal('running'), t.Literal('completed'), t.Literal('failed'), t.Literal('cancelled')]),
  sessionId: t.Nullable(t.String()),
  runId: t.Nullable(t.String()),
  artifactId: t.Nullable(t.String()),
  resultRevisionId: t.Nullable(t.String()),
  errorMessage: t.Nullable(t.String()),
  createdAt: t.Number(),
  updatedAt: t.Number(),
})

const agentFixArtifact = t.Object({
  id: t.String(),
  reviewId: t.String(),
  agentFixId: t.String(),
  sessionId: t.String(),
  runId: t.String(),
  kind: t.Union([t.Literal('patch'), t.Literal('assistant-summary')]),
  mimeType: t.String(),
  content: t.String(),
  contentHash: t.String(),
  createdAt: t.Number(),
})

const commitPlan = t.Object({
  id: t.String(),
  reviewId: t.String(),
  revisionId: t.String(),
  actorId: t.String(),
  strategy: t.Literal('manual'),
  status: t.Union([t.Literal('draft'), t.Literal('accepted'), t.Literal('applied'), t.Literal('abandoned')]),
  groups: t.Array(t.Object({
    id: t.String(),
    title: t.String(),
    message: t.String(),
    rationale: t.String(),
    fileIds: t.Array(t.String()),
    paths: t.Array(t.String()),
    dependsOn: t.Array(t.String()),
  })),
  conflicts: t.Array(t.Object({
    fileId: t.String(),
    path: t.String(),
    groupIds: t.Array(t.String()),
  })),
  rationale: t.String(),
  createdAt: t.Number(),
  updatedAt: t.Number(),
})

const commitPlanGroupInput = t.Object({
  id: t.String({ minLength: 1 }),
  title: t.String({ minLength: 1 }),
  message: t.String({ minLength: 1 }),
  rationale: t.String(),
  fileIds: t.Array(t.String({ minLength: 1 })),
  paths: t.Optional(t.Array(t.String())),
  dependsOn: t.Array(t.String()),
}, { additionalProperties: false })

const readiness = t.Object({
  sourceKind,
  workspaceId: t.String(),
  state: t.Union([
    t.Literal('ready'),
    t.Literal('workspace-integration-missing'),
    t.Literal('repository-code-access-missing'),
    t.Literal('personal-connection-missing'),
    t.Literal('permission-insufficient'),
  ]),
  actions: t.Array(t.Object({
    label: t.String(),
    url: t.Optional(t.String()),
    ownerKind: t.Union([t.Literal('workspace-admin'), t.Literal('github-org-owner'), t.Literal('current-user')]),
  })),
})

export const DiffReviewModel = {
  workspaceParams: t.Object({
    workspaceId: t.String({ minLength: 1 }),
  }, { additionalProperties: false }),

  reviewParams: t.Object({
    workspaceId: t.String({ minLength: 1 }),
    reviewId: t.String({ minLength: 1 }),
  }, { additionalProperties: false }),

  fileParams: t.Object({
    workspaceId: t.String({ minLength: 1 }),
    reviewId: t.String({ minLength: 1 }),
    fileId: t.String({ minLength: 1 }),
  }, { additionalProperties: false }),

  threadParams: t.Object({
    workspaceId: t.String({ minLength: 1 }),
    reviewId: t.String({ minLength: 1 }),
    threadId: t.String({ minLength: 1 }),
  }, { additionalProperties: false }),

  agentFixParams: t.Object({
    workspaceId: t.String({ minLength: 1 }),
    reviewId: t.String({ minLength: 1 }),
    agentFixId: t.String({ minLength: 1 }),
  }, { additionalProperties: false }),

  commitPlanParams: t.Object({
    workspaceId: t.String({ minLength: 1 }),
    reviewId: t.String({ minLength: 1 }),
    commitPlanId: t.String({ minLength: 1 }),
  }, { additionalProperties: false }),

  localWorkingTreeBody: t.Object({
    repo: t.Optional(t.String({ minLength: 1 })),
  }, { additionalProperties: false }),

  localBranchCompareBody: t.Object({
    repo: t.Optional(t.String({ minLength: 1 })),
    baseRef: t.String({ minLength: 1 }),
    headRef: t.String({ minLength: 1 }),
  }, { additionalProperties: false }),

  localCommitBody: t.Object({
    repo: t.Optional(t.String({ minLength: 1 })),
    commitRef: t.String({ minLength: 1 }),
  }, { additionalProperties: false }),

  setViewedBody: t.Object({
    viewed: t.Boolean(),
  }, { additionalProperties: false }),

  createThreadBody: t.Object({
    fileId: t.Optional(t.Nullable(t.String({ minLength: 1 }))),
    anchor: t.Optional(t.Nullable(rangeAnchorInput)),
    bodyMarkdown: t.String({ minLength: 1 }),
  }, { additionalProperties: false }),

  addCommentBody: t.Object({
    bodyMarkdown: t.String({ minLength: 1 }),
  }, { additionalProperties: false }),

  addReactionBody: t.Object({
    reaction: t.String({ minLength: 1 }),
  }, { additionalProperties: false }),

  submitBody: t.Object({
    decision: t.Union([t.Literal('approve'), t.Literal('request-changes'), t.Literal('comment')]),
    bodyMarkdown: t.Optional(t.Nullable(t.String())),
  }, { additionalProperties: false }),

  updatePreferencesBody: t.Object({
    diffStyle: t.Optional(t.Union([t.Literal('split'), t.Literal('unified')])),
    codeTheme: t.Optional(t.String({ minLength: 1 })),
    fontSize: t.Optional(t.Number({ minimum: 9, maximum: 24 })),
    lineHeight: t.Optional(t.Number({ minimum: 12, maximum: 36 })),
    hideWhitespaceOnly: t.Optional(t.Boolean()),
    structuralHighlighting: t.Optional(t.Boolean()),
    collapseGeneratedFiles: t.Optional(t.Boolean()),
    notificationMode: t.Optional(t.Union([
      t.Literal('all-activity'),
      t.Literal('all-activity-by-people'),
      t.Literal('reviews-and-comments'),
      t.Literal('reviews-and-comments-by-people'),
      t.Literal('none'),
    ])),
  }, { additionalProperties: false }),

  createAgentFixBody: t.Object({
    threadId: t.Optional(t.Nullable(t.String({ minLength: 1 }))),
    anchor: t.Optional(t.Nullable(rangeAnchorInput)),
    instruction: t.String({ minLength: 1 }),
    agentId: t.Optional(t.Nullable(t.String({ minLength: 1 }))),
    expectedOutput: t.Union([t.Literal('commit'), t.Literal('working-tree-change'), t.Literal('patch-artifact')]),
  }, { additionalProperties: false }),

  startAgentFixBody: t.Object({
    agentId: t.Optional(t.Nullable(t.String({ minLength: 1 }))),
    providerTargetId: t.Optional(t.Nullable(t.String({ minLength: 1 }))),
    runtimeKind: t.Optional(t.Nullable(t.String({ minLength: 1 }))),
    modelId: t.Optional(t.Nullable(t.String({ minLength: 1 }))),
  }, { additionalProperties: false }),

  cancelAgentFixBody: t.Object({}, { additionalProperties: false }),

  updateCommitPlanBody: t.Object({
    groups: t.Optional(t.Array(commitPlanGroupInput)),
    rationale: t.Optional(t.String()),
    status: t.Optional(t.Union([t.Literal('draft'), t.Literal('accepted'), t.Literal('abandoned')])),
  }, { additionalProperties: false }),

  applyCommitPlanBody: t.Object({
    idempotencyKey: t.Optional(t.String({ minLength: 1 })),
  }, { additionalProperties: false }),

  generateGuideBody: t.Object({
    providerTargetId: t.String({ minLength: 1 }),
    runtimeKind: t.Optional(guideRuntimeKind),
    modelId: t.Optional(t.Nullable(t.String({ minLength: 1 }))),
    force: t.Optional(t.Boolean()),
  }, { additionalProperties: false }),

  revision,

  file,
  rangeAnchor,
  thread,
  submission,
  preferences,
  event,
  guide,
  agentFix,
  agentFixArtifact,
  commitPlan,
  readiness,

  review: t.Object({
    id: t.String(),
    workspaceId: t.String(),
    sourceId: t.Nullable(t.String()),
    repositoryPath: t.String(),
    sourceKind,
    title: t.String(),
    status: reviewStatus,
    reviewState,
    currentRevisionId: t.Nullable(t.String()),
    createdAt: t.Number(),
    updatedAt: t.Number(),
    currentRevision: t.Nullable(revision),
    files: t.Array(file),
    threads: t.Array(thread),
    submissions: t.Array(submission),
    events: t.Array(event),
    preferences,
    guide,
    agentFixes: t.Array(agentFix),
    commitPlans: t.Array(commitPlan),
  }),
}
