import { t } from 'elysia'

const worktreeStatusSchema = t.Union([
  t.Literal('active'),
  t.Literal('merged'),
  t.Literal('abandoned'),
])

const worktreeHealthSchema = t.Union([
  t.Literal('ok'),
  t.Literal('missing'),
  t.Literal('stale'),
])

const managedWorktreeViewSchema = t.Object({
  id: t.String(),
  sourceWorkspaceId: t.String(),
  workspaceName: t.String(),
  name: t.String(),
  path: t.String(),
  branch: t.String(),
  baseRef: t.String(),
  status: worktreeStatusSchema,
  createdBySessionId: t.Nullable(t.String()),
  createdAt: t.Number(),
  updatedAt: t.Number(),
  sizeBytes: t.Number(),
  sessionCount: t.Number(),
})

export const WorktreeModel = {
  worktreeView: t.Object({
    id: t.String(),
    sourceWorkspaceId: t.String(),
    name: t.String(),
    path: t.String(),
    branch: t.String(),
    baseRef: t.String(),
    status: worktreeStatusSchema,
    createdBySessionId: t.Nullable(t.String()),
    createdAt: t.Number(),
    updatedAt: t.Number(),
  }),

  workspaceIdParams: t.Object({
    workspaceId: t.String({ minLength: 1 }),
  }),

  worktreeIdParams: t.Object({
    worktreeId: t.String({ minLength: 1 }),
  }),

  sessionIdParams: t.Object({
    sessionId: t.String({ minLength: 1 }),
  }),

  createBody: t.Object({
    sessionId: t.String({ minLength: 1 }),
    slug: t.Optional(t.String({ minLength: 1 })),
    confirmedSetupHooks: t.Optional(t.Boolean()),
  }),

  cleanupBody: t.Object({
    mode: t.Union([t.Literal('merge-and-close'), t.Literal('abandon')]),
    targetBranch: t.Optional(t.String({ minLength: 1 })),
  }),

  managedWorktreeView: managedWorktreeViewSchema,

  managedWorktreeCleanupBody: t.Object({
    maxWorktrees: t.Number({ minimum: 0 }),
    maxTotalSizeGb: t.Number({ minimum: 0 }),
  }),

  managedWorktreeListResponse: t.Object({
    worktrees: t.Array(managedWorktreeViewSchema),
    totalSizeBytes: t.Number(),
  }),

  managedWorktreeCleanupResponse: t.Object({
    cleaned: t.Array(managedWorktreeViewSchema),
    skipped: t.Number(),
    totalSizeBytes: t.Number(),
  }),

  isolationStartBody: t.Object({
    slug: t.Optional(t.String({ minLength: 1 })),
  }),

  isolationActivateBody: t.Object({
    mode: t.Union([
      t.Literal('migrate'),
      t.Literal('leave-main'),
      t.Literal('cancel'),
    ]),
  }),

  attachWorktreeBody: t.Object({
    worktreeId: t.String({ minLength: 1 }),
  }),

  issueIsolationContextGroup: t.Object({
    worktreeId: t.String(),
    name: t.String(),
    branch: t.String(),
    sessionIds: t.Array(t.String()),
    sessionTitles: t.Array(t.String()),
  }),

  worktreeHealth: worktreeHealthSchema,
}
