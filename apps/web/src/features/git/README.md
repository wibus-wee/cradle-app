<!-- Once this directory changes, update this README.md -->

# Features/Git

Git integration feature: repository discovery, branch status, working-tree changes, commit graph, branch switching, and fetch.
The `GitPanelContainer` renders in the right aside "Git" tab; `ChangesPanelContainer` renders in the right aside "Changes" tab; `GitBranchControl` renders in the AppHeader breadcrumb.
All git operations go through the server Git module under `/workspaces/:id/git/*`, which owns repository discovery and repository-scoped `simple-git` orchestration.
The first real UI-driven E2E coverage enters this feature from `new-chat` → chat route surface, then drives the header branch control and right-aside Git panel without seeding app-owned state directly.

## Directory layout

```text
git/
├── branch/                 # Header control and repository branch picker runtime
├── changes/
│   ├── containers/         # Query, mutation, BrowserPanel, Electron adapters
│   ├── views/              # Props-only panel, list, type, tree, section, and row Views
│   ├── lib/                # Pure grouping and repository-path functions
│   ├── fixtures/           # Owner-typed changed-file data and golden captures
│   ├── stories/            # Fixture-driven Changes stories
│   └── changes-panel.test.ts
├── history/
│   ├── containers/         # Repository/graph query, pagination, and fetch adapters
│   ├── views/              # Props-only panel, repository section, row, and author Views
│   ├── fixtures/           # Owner-typed graph data and golden captures
│   └── stories/            # Fixture-driven History stories
├── shared/                 # Generated owner types, query hooks, graph layout, tree events
└── index.ts                # Public feature entry point
```

`shared/use-git.ts` owns the TanStack Query hook family and query keys.
`changes/lib` and `shared/graph-layout.ts` are pure computations. The two
`containers` directories are the only places in these panel surfaces allowed to
read queries, invalidate caches, access BrowserPanel, or call Electron. Every
Storybook story mounts a View with fixtures from its own surface.

`branch/branch-picker.tsx` and `branch/git-branch-control.tsx` remain runtime
adapters because branch selection, creation, and fetch are application actions.
The root `index.ts` deliberately exports only `GitPanelContainer`,
`ChangesPanelContainer`, and `GitBranchControl`.

## Rendering boundaries

History and Changes containers own React Query, mutations, cache invalidation,
and the branch-picker runtime. Their View modules own rendering and local UI
interaction only. Storybook composes Views with generated API owner types from
the matching surface's `fixtures/` directory.
