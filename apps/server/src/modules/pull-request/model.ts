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
})

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

  searchPageQuery: t.Object({
    login: t.String({ minLength: 1 }),
    after: t.Optional(t.String()),
  }),

  createBody: t.Object({
    title: t.String({ minLength: 1 }),
    body: t.Optional(t.String()),
    base: t.Optional(t.String({ minLength: 1 })),
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

  mutationResponse: t.Object({
    pullRequest: pullRequestViewSchema,
  }),

  viewerResponse: t.Object({
    viewer: githubViewerSchema,
  }),

  searchPageResponse: pullRequestSearchPageSchema,
}
