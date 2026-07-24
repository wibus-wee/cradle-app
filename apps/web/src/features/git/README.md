<!-- Once this directory changes, update this README.md -->

# Features/Git

Git integration feature: repository discovery, branch status, working-tree changes, commit graph, branch switching, and fetch.
The `GitPanel` renders in the right aside "Git" tab; `ChangesPanel` renders in the right aside "Changes" tab; `GitBranchControl` renders in the AppHeader breadcrumb.
All git operations go through the server Git module under `/workspaces/:id/git/*`, which owns repository discovery and repository-scoped `simple-git` orchestration.
The first real UI-driven E2E coverage enters this feature from `new-chat` → chat route surface, then drives the header branch control and right-aside Git panel without seeding app-owned state directly.

## Files

- **use-git.ts**: TanStack Query hooks — `useGitRepositories`, repo-scoped `useGitStatus`, `useGitFileStatuses`, `useGitBranches`, `useGitRemotes`, `useGitGraph`, and `useGitDiff` with exported query-key builders for external invalidation; repository/status reads use active refresh while branches/remotes/graph use background refresh.
- **changes-grouping.ts**: Pure grouping rules for assigning changed files to Sources, Docs / Specs, and Tests sections.
- **graph-layout.ts**: Pure `computeGraphLayout` function — assigns lane numbers, per-row visible lane counts, and SVG line metadata to each commit using a classic open-slots algorithm
- **graph-layout.test.ts**: Unit coverage for `computeGraphLayout` linear history, merge lane convergence, compact mainline row width, and empty graph behavior
- **git-controls-a11y.test.tsx**: Regression tests for named GitPanel / BranchPicker fetch and branch-create controls.
- **changes-panel.tsx**: Right-aside Changes panel with a Type/Tree view toggle; single-repository workspaces keep the compact current-change layout, while multi-repository workspaces render repository sections with per-repo branch, change count, Review action, and Type/Tree content. Repo-relative paths drive Git diff/tree display, and workspace-relative `workspacePath` drives BrowserPanel open, native open/reveal, create/rename, and path copy shortcuts.
- **changes-panel.test.ts**: Unit coverage for Changes panel file-section grouping order, tree event metadata resolution, and Tree view double-click diff navigation into owner-scoped BrowserPanel state with query/provider scaffolding for shared workspace file menu dependencies.
- **git-graph-row.tsx**: Memoized row component — SVG swimlane column + Gravatar avatar + shortSha badge + message + ref labels + relative date; each rendered row exposes stable commit metadata attributes for E2E assertions
- **git-panel-loader.ts**: Git panel 的共享 lazy loader 与 intent preload 入口，供 right aside Git tab 使用
- **git-panel.tsx**: Full panel component — renders one repo-scoped branch/fetch/graph surface for single-repository workspaces and stacked repository sections for multi-repository workspaces; each section owns its branch picker, fetch mutation, and virtualized commit graph (`VList` from virtua).
- **branch-picker.tsx**: Repo-scoped popover listing local and remote branches with search, checkout-on-click, inline branch creation, and named fetch/cancel controls; branch options and create controls expose stable `data-testid` anchors, and this component owns branch switching/creation interaction flow for the repository passed by the caller.
- **git-branch-control.tsx**: Compact AppHeader Git control — single-repository workspaces show the branch button and open `BranchPicker`; multi-repository workspaces show a non-ambiguous repository/change summary instead of pretending one branch represents the whole workspace.
- **index.ts**: Barrel re-exporting `GitPanel` and `GitBranchControl`
