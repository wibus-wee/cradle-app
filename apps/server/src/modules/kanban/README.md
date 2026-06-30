# Kanban Module

Provides workspace-scoped board/view configuration. Issues, statuses, milestones, comments, relations, context refs, and delegation markers are owned by the Issue capability under `/issues`.
Route metadata includes `x-cradle-cli` descriptors for generated board CLI commands.

## Files

- `index.ts`: Elysia `/kanban` routes, OpenAPI metadata, and generated CLI descriptors.
- `model.ts`: TypeBox schemas for Kanban board requests and responses.
- `service.ts`: Kanban board persistence and workspace validation.
