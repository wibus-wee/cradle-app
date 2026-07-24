# Automation

`automation` owns the HTTP contract for generic Agent-authored durable automation definitions, outer run lifecycle records, automation-owned artifacts, and the run triage inbox. The definition-list route returns each definition with its latest run projection, so consumers do not assemble list summaries by requesting every definition's run history.

It may reference normal chat sessions and backend runs, but execution remains owned by `chat-runtime`. Agent task recipes may pass supported thinking effort through to chat runtime.

## Files

- `index.ts`: Elysia routes with Agent-facing `x-cradle-cli` metadata.
- `model.ts`: TypeBox schemas for definitions, runs, artifacts, triggers, and recipes.
- `service.ts`: DB CRUD, latest-run list projection, run-now orchestration, scheduled enqueue, artifact persistence.
- `scheduler.ts`: RRULE parsing and due occurrence helpers backed by `rrule`.
- `poller.ts`: lightweight scheduled dispatch seam.

RRULE times are interpreted as wall-clock times in the trigger `timezone`, then converted to UTC seconds for storage and dispatch. The poller enqueues from persisted `nextRunAt` so a server restart or missed tick does not skip the next due occurrence.

Recipes can choose `sessionPolicy: heartbeat` to continue the most recent automation session, or `isolationPolicy: worktree_per_run` to create a fresh Cradle-managed worktree before starting a run. Completion uses an explicit final-line result contract (`findings` or `no_findings`); it is not inferred heuristically. Findings and failures enter triage unread, while no-findings runs archive by default unless the recipe opts into triage.

`listRunsForSession(sessionId)` is the public read projection for session-scoped consumers such as Session Environment. Those consumers may summarize recent runs, but Automation remains the owner of run lifecycle and status semantics.

The `/automations` list route reads matching definitions and their runs in two Drizzle queries, selecting the newest run per definition in memory. Empty definition lists skip the run query. This is a read projection only: it does not change scheduler, execution, or persistence semantics.

## CLI surface

The stable Agent-facing routes expose `automation create/list/get/update/delete`, `automation enable/disable/run/runs`, and artifact list/get commands.
