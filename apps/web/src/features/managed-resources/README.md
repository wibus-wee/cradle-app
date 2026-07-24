# Managed Resources

The Managed Resources feature owns the Download Center page for optional
runtimes and models.

## Rendering seam

- `managed-resources-page.tsx` is the dependency-owning Container. It reads
  the generated resource query, the shared Download Center projection, and
  the generic resource-action mutation.
- `managed-resources-page-view.tsx` is the fixture-driven page View. It owns
  local Library/Activity navigation and summary presentation.
- `managed-resource-library-view.tsx`,
  `managed-resource-card-view.tsx`, and
  `managed-resource-activity-view.tsx` are props-only production Views.
- `fixtures/managed-resources.ts` uses the generated `ManagedResource` and
  shared `DownloadTask` owner types.
- `managed-resources-page-view.stories.tsx` covers Library, Activity,
  action failure, loading, load error, and empty states without a server.
