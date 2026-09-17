# Session Group Module

Session Group owns workspace-scoped containers that organize multiple chat sessions into one work package. Groups are lightweight metadata containers; chat execution remains session-owned.

- Groups must belong to exactly one workspace.
- Sessions may belong to at most one group via `sessions.sessionGroupId`.
- Deleting a group unbinds member sessions without deleting them.
- Optional `linkedIssueId` links a group to an issue; issue-driven creation flows are out of scope for v1.
- `configJson` is reserved for future group-level shared context; v1 does not inject it into agent prompts.

Issue association semantics (the shared-workspace invariant and link/unlink/relink workflow) are owned by the Issue module. Session Group owns reads and writes of `sessionGroups.linkedIssueId` and validates every non-null link through the `registerLinkedIssueValidator`/`assertLinkedIssue` port — injected by the composition root and failing closed when unregistered — so create-with-link and update-with-link share the direct-link invariant and rejected writes preserve prior state. `PATCH /session-groups/:id` returns `{ group, association }`, where `association` is the typed previous/next transition (`null` when `linkedIssueId` was not part of the patch) for owner-API cache reconciliation.

## Files

- **index.ts**: HTTP routes for CRUD, member add/remove, and CLI metadata.
- **model.ts**: TypeBox schemas for session group requests and responses, including the PATCH `{ group, association }` envelope.
- **service.ts**: Group semantics, workspace invariants, member assignment, aggregate status projection, and the linked-issue validator port plus association transition reporting.
