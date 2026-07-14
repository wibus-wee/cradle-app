# Pull Requests feature

This feature owns the dedicated Pull Requests surface: every GitHub pull
request the signed-in user is involved in, not only ones created through
Cradle Work. Authored and reviewing are each their own cursor-paginated
GraphQL search feed on the server (`/pull-requests/authored`,
`/pull-requests/reviewing`, scoped by `/pull-requests/viewer`'s identity) -
`useCradlePullRequests` in `use-pull-requests.ts` drives one `useInfiniteQuery`
per role and concatenates the pages fetched so far, then optionally overlays
a matching Work summary when Cradle happens to have created or bound that
PR - the overlay only unlocks the "Open Work" action in the detail panel, it
is never a precondition for a PR to appear. Neither feed has a server-side
item cap; the page renders a "Load more" affordance (`authored`/`reviewing`
in the hook's return value) instead of silently truncating a long history.

A PR's identity is always `owner/repo#number`; `workId`/`sessionId` are
optional annotations, not part of that identity. This is why the detail
lookup (`getPullRequestsByOwnerByRepoByNumberDetailOptions`) and the Browser
Panel tab (`openPullRequestTab`) are both keyed by `owner/repo/number` rather
than by session.

The route owns list filtering (role: all/authored/reviewing) and selection.
Selecting an item opens a `pull-request` tab in the existing Browser Panel
split, so PR details share the same resizable right-hand workspace as
browser, file, diff, and terminal tabs. Pull Request and Work remain the
semantic data owners on the server; this feature only composes their read
models for this surface.

## Files

- `pull-requests-page.tsx` - list surface: role tabs, search, recency
  grouping, row rendering (status icon, CI check dot, author, branch, diff
  stat).
- `pull-request-detail-panel.tsx` - generic detail panel rendered in the
  Browser Panel, addressed by `owner/repo/number`. Shows an "Open Work"
  action only when the PR is Work-bound.
- `use-pull-requests.ts` - drives the paginated authored/reviewing feeds and
  joins them with Work summaries to derive `role` and the optional Work
  overlay.
- `status-meta.ts` - shared status icon/color mapping (draft/ready/
  merged/closed) and the CI check-state dot color mapping, used by both the
  list and the detail panel.
