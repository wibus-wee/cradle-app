# New Work

`NewWorkPage` is the outcome-oriented local coding entry point. It reuses the
existing composer/runtime selection controls, requires a local Workspace, calls
`POST /works` once, and starts the first Agent response only after Work creation
succeeds.

Source-dirty and creation failures stay in context. When the source checkout is
dirty, the page offers **Start from origin/main**, which retries creation with
`baseStrategy: remote-default` so local WIP is left untouched. Starting Work
authorizes local isolated execution only and never grants automatic GitHub
delivery.

## Rendering seam

- `new-work-page.tsx` is the Container. It owns route search, workspace queries,
  local preference persistence, composer runtime state, the generated create
  request, query invalidation, analytics, and navigation.
- `new-work-page-view.tsx` is the props-only page shell. Its composer is an
  explicit slot so Storybook can compose the existing `ComposerView` without
  mounting runtime catalogs or stores.
- `new-work-workspace-selector-view.tsx` and `new-work-error-view.tsx` are
  props-only semantic Views with callbacks.
- `fixtures/new-work.ts` uses the owning `Workspace` contract.
- `new-work-page-view.stories.tsx` covers ready, workspace menu/loading/empty/
  adding, dirty source, unavailable remote base, and generic create failure
  states.
