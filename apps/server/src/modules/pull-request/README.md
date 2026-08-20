# Pull Request Module

Owns session-bound GitHub pull request lifecycle for isolated agent work:

1. Push the isolated worktree branch
2. Open a **draft** PR on GitHub
3. Persist PR linkage on `sessions.configJson.github.pullRequest`
4. Refresh status and mark ready for review
5. Project live GitHub PR summary, review/comment timeline, checks, and changed files
6. Own the **PR console** mutates (comment, whole-PR review, merge, assignees,
   reviewers, ready/draft) and the cheap fingerprint probe used for cache-aware
   detail refresh, including an explicit user-initiated cache bypass

The module consumes the shared asynchronous GitHub API client. GitHub Auth owns
the selected user credential and its lifecycle, so comments, reviews, and pull
request mutations use the connected App user identity when present.

The module also owns read-only delivery readiness (`baseRef..HEAD`, cleanliness,
changed files) and updating an existing open PR after pushing follow-up commits.
The Work module composes these APIs but does not duplicate Git or GitHub logic.

Detail lookup is generic by design: `fetchPullRequestDetailByRef(owner, repo,
number)` is the actual GitHub query, and `getPullRequestDetail(sessionId)` is
just a thin resolver on top of it for the one case where Cradle already knows
the PR's ref because it created/bound it. This module also separately owns
discovering pull requests the authenticated GitHub identity is involved in
*anywhere* (authored, requested as reviewer, or previously reviewed) via
GraphQL search - that
listing has no session or Work dependency at all. Whether a given PR happens
to have a bound Cradle session is an optional fact layered on top by callers
(matching owner/repo/number), never a precondition for reading it.

The GitHub App requires repository Contents read access because these global
feeds include the current head commit and its check-rollup state. Contents
write access is not required.

`listAuthoredPullRequests` and `listReviewingPullRequests` are cursor-paginated,
not fixed-size batches. The reviewing feed combines GitHub's independent
`review-requested` and `reviewed-by` searches because GitHub does not support
OR across those qualifiers. Its opaque Cradle cursor carries both underlying
GitHub cursors. The completed-review query excludes currently requested PRs,
making the streams disjoint; results are merged by update time and defensively
de-duplicated by PR ref. A viewer with a long PR history pages through all
results via repeated calls.

Branch push policy for create/update delivery:

- First publish of a missing remote branch uses an ordinary `--set-upstream` push.
- When the remote tip already exists, push uses `--force-with-lease=<branch>:<observedSha>`
  so local amend/rebase can republish Cradle-managed worktree branches without a
  bare `--force`. If the remote tip moved after inspection, push fails with
  `git_push_lease_rejected` instead of overwriting blindly.

Merge authority lives here. Diff Review may **delegate** merge / whole-PR review
submit to this module; it must not re-implement GitHub merge policy. Waiting for
CI remains a user/agent decision via `session await`. Detail responses include
`allowedMergeMethods`, `mergeBlockers`, and `canMerge` derived from repo merge
settings + PR mergeability + checks.

## Routes

| Method | Path | CLI | Notes |
|--------|------|-----|-------|
| `GET` | `/sessions/:id/pull-request` | `session pull-request get` | Bound PR + live refresh; CLI defaults session id from `CRADLE_CHAT_SESSION_ID` |
| `GET` | `/sessions/:id/pull-request/detail` | `session pull-request detail` | Live GitHub summary, timeline, checks, and file patches for the bound PR |
| `POST` | `/sessions/:id/pull-request` | `session pull-request create` | Requires isolation; always draft; CLI defaults session id from `CRADLE_CHAT_SESSION_ID` |
| `POST` | `/sessions/:id/pull-request/ready` | `session pull-request ready` | Converts draft → ready; CLI defaults session id from `CRADLE_CHAT_SESSION_ID` |
| `GET` | `/pull-requests/viewer` | `pull-request viewer` | Authenticated GitHub identity the `authored`/`reviewing` feeds below are scoped to |
| `GET` | `/pull-requests/authored?login&after` | `pull-request authored` | One cursor page of PRs authored by `login`, most recently updated first (GraphQL search, not session-bound) |
| `GET` | `/pull-requests/reviewing?login&after` | `pull-request reviewing` | Combined cursor page of PRs requested from or previously reviewed by `login`, most recently updated first |
| `POST` | `/pull-requests/refresh` | `pull-request refresh` | Force-refresh the authored and reviewing feed heads from GitHub |
| `GET` | `/pull-requests/:owner/:repo/:number/detail` | `pull-request detail` | Same detail projection as the session route, addressed directly by ref instead of by session |
| `POST` | `/pull-requests/:owner/:repo/:number/refresh` | `pull-request detail refresh` | Synchronously revalidate the full detail projection; force mode is the default, while `force=false` preserves rate-budget fallback for fingerprint probes |
| `GET` | `/pull-requests/:owner/:repo/:number/fingerprint` | `pull-request fingerprint` | Cheap PR version for cache-aware refresh |
| `POST` | `/pull-requests/:owner/:repo/:number/fingerprint/probe` | `pull-request fingerprint probe` | Visible-tab probe; returns `changed` vs optional previous fingerprint |
| `POST` | `/pull-requests/:owner/:repo/:number/comment` | `pull-request comment` | Post an issue comment |
| `POST` | `/pull-requests/:owner/:repo/:number/review` | `pull-request review` | Whole-PR approve / request-changes / comment |
| `POST` | `/pull-requests/:owner/:repo/:number/merge` | `pull-request merge` | Merge with a repo-allowed method; optional `commitTitle`/`commitMessage`; pre-blocks only impossible states (merged/closed/draft/conflicts/no methods) and otherwise relays GitHub's rejection reason |
| `POST` | `/pull-requests/:owner/:repo/:number/assignees` | `pull-request assignees` | Add/remove assignees |
| `POST` | `/pull-requests/:owner/:repo/:number/reviewers` | `pull-request reviewers` | Request/remove reviewers |
| `POST` | `/pull-requests/:owner/:repo/:number/ready` | `pull-request ready` | Draft → ready by ref |
| `POST` | `/pull-requests/:owner/:repo/:number/draft` | `pull-request draft` | Ready → draft by ref |
| `GET` | `/pull-requests/:owner/:repo/assignable-users` | `pull-request assignable-users` | Assignable users for people pickers |

Ready-for-review uses GitHub's GraphQL `markPullRequestReadyForReview` mutation;
the REST pull-request update endpoint does not transition Draft PR state. GitHub
requests have a bounded timeout so callers receive an actionable failure instead
of remaining pending indefinitely.

## Files

- **index.ts**: Two Elysia routers - session-bound routes under `/sessions/:id/pull-request*`, and the standalone `/pull-requests/*` router (feeds, detail, fingerprint, console mutates) - both with `x-cradle-cli` metadata.
- **model.ts**: TypeBox request/response schemas, including search views, detail merge capability fields, fingerprint, and console mutate bodies.
- **service.ts**: Isolation/readiness checks, remote resolution, push, GitHub create/update/ready, `configJson` persistence, plus session-independent detail/search reads.
- **console-actions.ts**: Fingerprint probe and PR console mutates (comment, review, merge, people, ready/draft).
- **merge-capability.ts**: Pure merge allow/block derivation for detail UI and merge route.
- **delivery-push.ts**: First-publish vs force-with-lease push arg selection for managed branches.
- **github-remote.ts**: Parse `owner/repo` from GitHub HTTPS/SSH remote URLs.
- **pr-body.ts**: Compose Work handoff fields into the repository PR template, including
  normalization that prevents a template-shaped summary from nesting duplicate sections.
