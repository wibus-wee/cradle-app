# Workflow Rules Module

Stores workspace-scoped issue-agent workflow rule markdown files under the server-owned data directory.
Rules are consumed by the Issue Agent delegation path when building the initial issue prompt.
The global rule applies to all delegated agents in the workspace; agent-specific rules are keyed by Agent Identity `agentId`, not provider target or profile IDs.
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.

## Files

- `index.ts`: Elysia `/workflow-rules` routes and generated CLI metadata.
- `model.ts`: TypeBox schemas for rule entries, rule reads, save bodies, and query params.
- `service.ts`: Filesystem-backed CRUD semantics and path safety.
