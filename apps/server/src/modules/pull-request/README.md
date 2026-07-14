# Pull Request Module

Owns session-bound GitHub pull request lifecycle for isolated agent work:

1. Push the isolated worktree branch
2. Open a **draft** PR on GitHub
3. Persist PR linkage on `sessions.configJson.github.pullRequest`
4. Refresh status and mark ready for review
5. Project live GitHub PR summary, review/comment timeline, checks, and changed files

The module also owns read-only delivery readiness (`baseRef..HEAD`, cleanliness,
changed files) and updating an existing open PR after pushing follow-up commits.
The Work module composes these APIs but does not duplicate Git or GitHub logic.

Detail lookup is generic by design: `fetchPullRequestDetailByRef(owner, repo,
number)` is the actual GitHub query, and `getPullRequestDetail(sessionId)` is
just a thin resolver on top of it for the one case where Cradle already knows
the PR's ref because it created/bound it. This module also separately owns
discovering pull requests the authenticated GitHub identity is involved in
*anywhere* (authored, or requested as reviewer) via GraphQL search - that
listing has no session or Work dependency at all. Whether a given PR happens
to have a bound Cradle session is an optional fact layered on top by callers
(matching owner/repo/number), never a precondition for reading it.

`listAuthoredPullRequests`/`listReviewRequestedPullRequests` are each their
own GitHub-search cursor pagination, not a single fixed-size batch: GitHub
search results are sorted `sort:updated-desc` and paged via `after`/
`endCursor`, with no server-side item cap. A viewer with a long PR history
pages through all of it via repeated calls, rather than having anything past
an arbitrary cutoff silently dropped.

Branch push policy for create/update delivery:

- First publish of a missing remote branch uses an ordinary `--set-upstream` push.
- When the remote tip already exists, push uses `--force-with-lease=<branch>:<observedSha>`
  so local amend/rebase can republish Cradle-managed worktree branches without a
  bare `--force`. If the remote tip moved after inspection, push fails with
  `git_push_lease_rejected` instead of overwriting blindly.

Does **not** own merge, CI awaits, or Diff Review sync. Waiting for CI remains a user/agent decision via `session await`.

## Routes

| Method | Path | CLI | Notes |
|--------|------|-----|-------|
| `GET` | `/sessions/:id/pull-request` | `session pull-request get` | Bound PR + live refresh; CLI defaults session id from `CRADLE_CHAT_SESSION_ID` |
| `GET` | `/sessions/:id/pull-request/detail` | `session pull-request detail` | Live GitHub summary, timeline, checks, and file patches for the bound PR |
| `POST` | `/sessions/:id/pull-request` | `session pull-request create` | Requires isolation; always draft; CLI defaults session id from `CRADLE_CHAT_SESSION_ID` |
| `POST` | `/sessions/:id/pull-request/ready` | `session pull-request ready` | Converts draft → ready; CLI defaults session id from `CRADLE_CHAT_SESSION_ID` |
| `GET` | `/pull-requests/viewer` | `pull-request viewer` | Authenticated GitHub identity the `authored`/`reviewing` feeds below are scoped to |
| `GET` | `/pull-requests/authored?login&after` | `pull-request authored` | One cursor page of PRs authored by `login`, most recently updated first (GraphQL search, not session-bound) |
| `GET` | `/pull-requests/reviewing?login&after` | `pull-request reviewing` | One cursor page of PRs where `login` is a requested reviewer, most recently updated first |
| `GET` | `/pull-requests/:owner/:repo/:number/detail` | `pull-request detail` | Same detail projection as the session route, addressed directly by ref instead of by session |

Ready-for-review uses GitHub's GraphQL `markPullRequestReadyForReview` mutation;
the REST pull-request update endpoint does not transition Draft PR state. GitHub
requests have a bounded timeout so callers receive an actionable failure instead
of remaining pending indefinitely.

## Files

- **index.ts**: Two Elysia routers - session-bound routes under `/sessions/:id/pull-request*`, and the standalone `/pull-requests/*` router (viewer identity, paginated authored/reviewing feeds, ref-based detail) - both with `x-cradle-cli` metadata.
- **model.ts**: TypeBox request/response schemas, including the search-derived `pullRequestSearchViewSchema` (adds `checksState` to the base view) and the cursor-paginated `pullRequestSearchPageSchema`.
- **service.ts**: Isolation/readiness checks, remote resolution, push, GitHub create/update/ready, `configJson` persistence, plus the session-independent `fetchPullRequestDetailByRef`, `getViewerIdentity`, `listAuthoredPullRequests`, and `listReviewRequestedPullRequests`.
- **delivery-push.ts**: First-publish vs force-with-lease push arg selection for managed branches.
- **github-remote.ts**: Parse `owner/repo` from GitHub HTTPS/SSH remote URLs.
