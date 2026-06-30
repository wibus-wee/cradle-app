<!-- Once this directory changes, update this README.md -->

# Features/Model Registry

Model registry shared UI owns the renderer-side search, manual mapping form, and result-row presentation for Cradle model registry mappings. It is used by Settings and Agent Management, while model data semantics remain owned by the server registry API and `~/features/agent-runtime/types`.

## Files

- **mapping-dialog.tsx**: Shared search/manual mapping dialog for attaching a Cradle model id to a models.dev or manual registry entry.
- **schemas.ts**: Zod schemas and TypeScript projections for registry search results and mappings.
- **search-result-item.tsx**: Shared result row for models.dev and Cradle registry matches; context-window display uses renderer-owned token formatting.
- **use-model-search.ts**: Debounced merged search hook for server model search results and local registry mappings.
