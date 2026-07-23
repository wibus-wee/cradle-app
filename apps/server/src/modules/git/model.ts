import { t } from 'elysia'

const nullableString = t.Nullable(t.String())
const fileStatusView = t.Object({
  path: t.String(),
  workspacePath: t.String(),
  status: t.Union([
    t.Literal('added'),
    t.Literal('modified'),
    t.Literal('deleted'),
    t.Literal('renamed'),
    t.Literal('untracked'),
  ]),
})

export const GitModel = {
  idParams: t.Object({
    id: t.String({ minLength: 1 }),
  }),

  workspaceIdParams: t.Object({
    workspaceId: t.String({ minLength: 1 }),
  }),

  graphQuery: t.Object({
    repo: t.Optional(t.String({ minLength: 1 })),
    limit: t.Optional(t.Numeric({ minimum: 1 })),
  }),

  checkoutBody: t.Object({
    repo: t.Optional(t.String({ minLength: 1 })),
    branch: t.String({ minLength: 1 }),
  }),

  createBranchBody: t.Object({
    repo: t.Optional(t.String({ minLength: 1 })),
    name: t.String({ minLength: 1 }),
    from: t.Optional(t.String({ minLength: 1 })),
  }),

  fetchBody: t.Optional(t.Object({
    repo: t.Optional(t.String({ minLength: 1 })),
  })),

  repositoryQuery: t.Object({
    repo: t.Optional(t.String({ minLength: 1 })),
    sessionId: t.Optional(t.String({ minLength: 1 })),
  }),

  diffQuery: t.Object({
    repo: t.Optional(t.String({ minLength: 1 })),
    paths: t.Optional(t.String()),
    sessionId: t.Optional(t.String({ minLength: 1 })),
  }),

  mergeBaseQuery: t.Object({
    repo: t.Optional(t.String({ minLength: 1 })),
    baseBranch: t.String({ minLength: 1 }),
  }),

  branchCompareQuery: t.Object({
    repo: t.Optional(t.String({ minLength: 1 })),
    baseRef: t.String({ minLength: 1 }),
    headRef: t.String({ minLength: 1 }),
  }),

  fileStatusView,

  statusView: t.Object({
    repositoryPath: t.String(),
    repositoryName: t.String(),
    branch: t.String(),
    tracking: nullableString,
    ahead: t.Number(),
    behind: t.Number(),
    isDetached: t.Boolean(),
    files: t.Array(fileStatusView),
  }),

  repositoryView: t.Object({
    path: t.String(),
    name: t.String(),
    absolutePath: t.String(),
    branch: t.String(),
    tracking: nullableString,
    ahead: t.Number(),
    behind: t.Number(),
    isDetached: t.Boolean(),
    files: t.Array(fileStatusView),
  }),

  branchesView: t.Object({
    local: t.Array(t.Object({
      name: t.String(),
      isCurrent: t.Boolean(),
      tracking: t.Optional(t.String()),
    })),
    remote: t.Array(t.Object({
      name: t.String(),
    })),
  }),

  remotesView: t.Array(t.Object({
    name: t.String(),
    fetchUrl: nullableString,
    pushUrl: nullableString,
  })),

  graphCommitView: t.Object({
    sha: t.String(),
    shortSha: t.String(),
    parents: t.Array(t.String()),
    refs: t.Array(t.String()),
    subject: t.String(),
    authorName: t.String(),
    authorEmail: t.String(),
    gravatarHash: t.String(),
    date: t.String(),
    timestamp: t.Number(),
  }),

  mergeBaseView: t.Object({
    mergeBaseSha: nullableString,
  }),

  branchCompareView: t.Object({
    repositoryPath: t.String(),
    repositoryName: t.String(),
    baseRef: t.String(),
    headRef: t.String(),
    baseSha: t.String(),
    headSha: t.String(),
    mergeBaseSha: nullableString,
    patch: t.String(),
  }),
}
