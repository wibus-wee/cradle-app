# Issue Module

Workspace-scoped issue capability. Owns workflow statuses, milestones, issue CRUD, due dates, comments, raw field-change audit history, server-projected Activity, relations, context refs, session links, linked session read projection, delegation markers, actor provenance, and issue search semantics. Kanban reads this data as board/list/table views but does not own issue semantics.
Comment and Activity responses include server-resolved actor projections; clients should not infer AI identity from raw agent, provider target, or profile IDs. `provider-target` is a first-class Issue actor kind rather than being folded into system.

## Files

- `index.ts`: Elysia `/issues` routes, OpenAPI metadata, generated CLI descriptors, Activity projection reads, raw field-change audit reads, linked session reads, and the Agent-facing issue move route that accepts status name slugs.
- `model.ts`: TypeBox schemas for issue requests and responses, including due dates, Activity items, raw field-change rows, comment author projections, source chat session provenance, linked sessions, and `statusName` request aliases for Agent workflows.
- `service.ts`: Issue workflow, key generation, default status assignment to Backlog, status name/slug resolution, actor provenance, source chat session persistence, raw field-change recording, server-owned Activity projection, unified assignee/delegation markers, comment author projection, search matching, relations, context refs, linked session reads, and session link semantics.
