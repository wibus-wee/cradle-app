# External Issue Sources

Cradle-owned projection boundary for plugin-provided external issue snapshots.

Plugins may read external systems such as GitHub and register an external issue source through `@cradle/plugin-sdk/server`. This module owns workspace bindings, repository cursors, read-only external issue item rows, local Kanban status overlays, refresh lifecycle, rate-limit state, and host routes. It does not let plugins write `issues`, and it does not create normal Cradle issue rows for external issues.

## Files

- `index.ts`: Elysia routes for listing sources, managing workspace repository bindings, updating binding enable/schedule fields, refreshing bindings, listing external items, rejecting source-owned item edits, and moving external items between statuses. Stable CLI commands are exposed through `x-cradle-cli`.
- `model.ts`: TypeBox request and response schemas for external issue source views, bindings, items, and refresh results.
- `service.ts`: Source registration projection, binding persistence, shared repository cursor and ETag handling, refresh coordination, snapshot validation, external item upsert, missing marking, source registration reconciliation, and status-only mutation.

## Ownership

The external product owns issue content such as title, body, labels, assignees, milestone, state, URL, and timestamps. Cradle owns only the workspace binding, local board status, refresh metadata, and provenance rows. A GitHub issue shown on the Kanban board is an `external_issue_items` row, not an `issues` row.

Settings and Kanban are host-owned surfaces. Settings creates explicit `workspaceId + sourceKey + owner/repo` bindings and can trigger refresh. Kanban reads `external_issue_items` beside native issues, marks them as external, and routes detail display to a read-only external issue panel whose only mutation is status.

Refresh context may include host-owned shared access config. For GitHub sources, this module injects the common server GitHub token resolved from `GH_TOKEN`, `GITHUB_TOKEN`, or `gh auth token`, while plugin-specific env may still override inside the plugin.
