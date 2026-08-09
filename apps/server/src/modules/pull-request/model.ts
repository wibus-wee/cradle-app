import { t } from 'elysia'

const nullableString = t.Nullable(t.String())

const githubActor = t.Object({
  login: t.String(),
  avatarUrl: nullableString,
  url: nullableString,
})

export const pullRequestViewSchema = t.Object({
  owner: t.String(),
  repo: t.String(),
  number: t.Number(),
  url: t.String(),
  title: t.String(),
  isDraft: t.Boolean(),
  state: t.Union([t.Literal('open'), t.Literal('closed')]),
  merged: t.Boolean(),
  headRef: t.String(),
  baseRef: t.String(),
  headSha: nullableString,
  createdAt: t.Number(),
  updatedAt: t.Number(),
  // Optional/nullable: only populated once GitHub has returned author data for
  // this PR (create/update/refresh) - older cached records may still lack it.
  author: t.Optional(t.Nullable(t.Object({
    login: t.String(),
    avatarUrl: t.String(),
    url: t.String(),
  }))),
  // Optional: only populated once a live GitHub fetch (or create/update) has
  // returned diff stats for this PR - older cached records may still lack it.
  additions: t.Optional(t.Number()),
  deletions: t.Optional(t.Number()),
})

const pullRequestCheck = t.Object({
  id: t.String(),
  name: t.String(),
  status: t.Union([
    t.Literal('queued'),
    t.Literal('in_progress'),
    t.Literal('completed'),
  ]),
  conclusion: nullableString,
  url: nullableString,
})

const pullRequestChecksState = t.Union([
  t.Literal('success'),
  t.Literal('failure'),
  t.Literal('pending'),
  t.Literal('neutral'),
])

// A PR discovered via GitHub search (author/review-requested), not
// necessarily bound to any Cradle session. Search only exposes a coarse
// checks rollup, so this carries `checksState` but not the full `checks`
// breakdown - fetch detail-by-ref for that.
export const pullRequestSearchViewSchema = t.Object({
  ...pullRequestViewSchema.properties,
  checksState: pullRequestChecksState,
})

const githubViewerSchema = t.Object({
  login: t.String(),
  avatarUrl: t.String(),
  url: t.String(),
})

const pullRequestSearchPageSchema = t.Object({
  items: t.Array(pullRequestSearchViewSchema),
  hasNextPage: t.Boolean(),
  endCursor: t.Nullable(t.String()),
})

const pullRequestDetail = t.Object({
  ...pullRequestViewSchema.properties,
  body: nullableString,
  author: t.Nullable(t.Object({
    login: t.String(),
    avatarUrl: t.String(),
    url: t.String(),
  })),
  additions: t.Number(),
  deletions: t.Number(),
  changedFiles: t.Number(),
  commits: t.Number(),
  comments: t.Number(),
  reviewComments: t.Number(),
  mergeable: t.Nullable(t.Boolean()),
  mergeableState: t.String(),
  createdAtIso: t.String(),
  updatedAtIso: t.String(),
  closedAtIso: nullableString,
  mergedAtIso: nullableString,
  reviewers: t.Array(t.Object({
    login: t.String(),
    avatarUrl: t.String(),
    url: t.String(),
  })),
  assignees: t.Array(t.Object({
    login: t.String(),
    avatarUrl: t.String(),
    url: t.String(),
  })),
  labels: t.Array(t.Object({
    name: t.String(),
    color: t.String(),
  })),
  checksState: pullRequestChecksState,
  checks: t.Array(pullRequestCheck),
  allowedMergeMethods: t.Array(t.Union([
    t.Literal('merge'),
    t.Literal('squash'),
    t.Literal('rebase'),
  ])),
  mergeBlockers: t.Array(t.String()),
  canMerge: t.Boolean(),
})

const pullRequestFingerprint = t.Object({
  updatedAt: t.String(),
  headSha: t.String(),
  state: t.Union([t.Literal('open'), t.Literal('closed')]),
  merged: t.Boolean(),
  isDraft: t.Boolean(),
  mergeableState: t.String(),
  comments: t.Number(),
  reviewComments: t.Number(),
  commits: t.Number(),
  checksState: pullRequestChecksState,
})

const pullRequestMergeMethod = t.Union([
  t.Literal('merge'),
  t.Literal('squash'),
  t.Literal('rebase'),
])

const pullRequestReviewEvent = t.Union([
  t.Literal('APPROVE'),
  t.Literal('REQUEST_CHANGES'),
  t.Literal('COMMENT'),
])

const githubLoginList = t.Array(t.String({ minLength: 1 }))

const pullRequestTimelineItem = t.Object({
  id: t.String(),
  kind: t.Union([t.Literal('comment'), t.Literal('review')]),
  author: t.Nullable(githubActor),
  body: nullableString,
  state: nullableString,
  createdAt: t.String(),
  url: nullableString,
})

const pullRequestFile = t.Object({
  sha: t.String(),
  filename: t.String(),
  previousFilename: nullableString,
  status: t.String(),
  additions: t.Number(),
  deletions: t.Number(),
  changes: t.Number(),
  patch: nullableString,
  blobUrl: t.String(),
  rawUrl: t.String(),
})

export const PullRequestModel = {
  idParams: t.Object({
    id: t.String({ minLength: 1 }),
  }),

  refParams: t.Object({
    owner: t.String({ minLength: 1 }),
    repo: t.String({ minLength: 1 }),
    number: t.String({ minLength: 1 }),
  }),

  ownerRepoParams: t.Object({
    owner: t.String({ minLength: 1 }),
    repo: t.String({ minLength: 1 }),
  }),

  searchPageQuery: t.Object({
    login: t.String({ minLength: 1 }),
    after: t.Optional(t.String()),
  }),

  feedRefreshBody: t.Object({
    login: t.String({ minLength: 1 }),
  }),

  detailRefreshBody: t.Object({
    force: t.Optional(t.Boolean()),
  }),

  createBody: t.Object({
    title: t.String({ minLength: 1 }),
    body: t.Optional(t.String()),
    base: t.Optional(t.String({ minLength: 1 })),
  }),

  commentBody: t.Object({
    body: t.String({ minLength: 1 }),
  }),

  reviewBody: t.Object({
    event: pullRequestReviewEvent,
    body: t.Optional(t.String()),
  }),

  mergeBody: t.Object({
    mergeMethod: pullRequestMergeMethod,
    commitTitle: t.Optional(t.String({ minLength: 1 })),
    commitMessage: t.Optional(t.String()),
  }),

  assigneesBody: t.Object({
    add: t.Optional(githubLoginList),
    remove: t.Optional(githubLoginList),
  }),

  reviewersBody: t.Object({
    add: t.Optional(githubLoginList),
    remove: t.Optional(githubLoginList),
  }),

  fingerprintProbeBody: t.Object({
    previous: t.Optional(t.Nullable(pullRequestFingerprint)),
  }),

  pullRequestView: pullRequestViewSchema,

  getResponse: t.Object({
    pullRequest: t.Nullable(pullRequestViewSchema),
  }),

  detailResponse: t.Object({
    pullRequest: pullRequestDetail,
    timeline: t.Array(pullRequestTimelineItem),
    files: t.Array(pullRequestFile),
  }),

  refreshResponse: t.Object({
    refreshed: t.Literal(true),
  }),

  fingerprintResponse: t.Object({
    fingerprint: pullRequestFingerprint,
    changed: t.Boolean(),
  }),

  commentResponse: t.Object({
    id: t.String(),
    body: t.String(),
    url: t.String(),
    createdAt: t.String(),
  }),

  reviewResponse: t.Object({
    id: t.Number(),
    state: t.String(),
    body: nullableString,
    htmlUrl: t.String(),
  }),

  mergeResponse: t.Object({
    sha: t.String(),
    merged: t.Literal(true),
    message: t.String(),
  }),

  peopleMutationResponse: t.Object({
    added: githubLoginList,
    removed: githubLoginList,
  }),

  assignableUsersResponse: t.Object({
    users: t.Array(t.Object({
      login: t.String(),
      avatarUrl: t.String(),
      url: t.String(),
    })),
  }),

  mutationResponse: t.Object({
    pullRequest: pullRequestViewSchema,
  }),

  viewerResponse: t.Object({
    viewer: githubViewerSchema,
  }),

  searchPageResponse: pullRequestSearchPageSchema,
}
