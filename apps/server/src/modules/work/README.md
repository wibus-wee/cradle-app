# Work module

The Work module owns the local outcome container: its objective, acceptance
criteria, primary-thread membership, prepared handoff metadata, archive fact,
and composition of existing Session, Worktree, Pull Request, Chat Runtime,
Provider Runtime, and Await read models.

## Invariants

- A Session belongs to at most one Work.
- A Work has exactly one primary Session in the local v1 flow.
- Work list skips rows whose primary Session is missing instead of failing the
  whole collection. Point lookups (`get`) still surface
  `work_primary_thread_missing` for a specific broken Work.
- Work creation requires a local Git workspace and an immediately active
  managed Worktree. Multi-folder (symlink composition) workspaces are rejected;
  Work needs a single primary repository root.
- Default creation bases the managed Worktree on a clean local `HEAD`. Clients
  may pass an explicit local or remote branch ref (for example `origin/main`)
  to start from that branch without touching local WIP.
- Work persists delivery facts, not mutable status labels. `projection.ts`
  deterministically derives delivery state, explanation, attention ownership,
  and the strongest honest recovery promise from canonical owner facts.
- Projection precedence is explicit and unit tested. Archive/merge/failure and
  unhealthy worktree facts override weaker runtime or handoff facts; an
  unclassifiable Work is `unknown` and stays diagnosable instead of being
  guessed into progress.
- Every projected state includes its trigger, evidence, authority, responsible
  party, next action, and observation time. Fresh redetection rereads owner
  facts; it never changes a label by itself.
- Attention is a derived, cross-Work read model with four actionable categories:
  approve or answer, handle failure, review, and merge or archive. It is sorted
  by risk and waiting time.
- Recovery exposes the strongest currently supported contract: `live`,
  `resumable`, `restorable`, `reproducible`, or `unknown`. Provider bindings,
  persisted Sessions, and healthy isolated worktrees keep their original
  ownership; Work only composes their evidence.
- Listing Work detects the current state of each bound pull request through the
  Pull Request owner, so sidebar summaries reflect GitHub merges without
  opening the individual Work surface.
- Preparing a handoff saves metadata locally. When an open Draft PR already exists, prepare also pushes the branch and updates the PR automatically.
- The builtin `cradle` MCP server exposes `manage_pull_request` as the required
  Agent-facing closed-loop finalization tool; the tool delegates to this module's
  submit API (push + create/update Draft PR) and does not own Work persistence.
- Work contributes one deterministic `<cradle_work_state>` harness fragment for
  its primary Session. The fragment contains only the Work id and
  `thread_role: primary`; stable Work lifecycle instructions are injected on
  primary Work threads via `chat-runtime/harness/system-instructions.ts`
  (`CRADLE WORK MODE`). The objective already enters the transcript as the
  initial user message, while pull-request, Await, and Worktree state remain
  available through their owning modules, delivered events, and on-demand reads
  (`cradle work get`, `session pull-request get`, or `gh`).
- Creating or updating the Draft PR for agent delivery goes through submit
  (`manage_pull_request` MCP / `cradle work submit`). Prepare remains available for
  local handoff metadata (and auto-updates an existing open Draft PR).
- The Work branch may be renamed via `POST /works/:id/branch` only while no
  pull request exists and the branch is not on the remote; the worktree
  directory name/path never changes.
- Mark Ready and merge remain user-controlled outside this module.
- Archiving a Work, or archiving its primary Session directly, abandons the
  managed checkout and removes its local branch before persisting the archive
  state. The operation fails rather than reporting completion when cleanup
  cannot be performed.

## Ownership boundaries

- Session owns conversation metadata and archive behavior.
- Work API read models project the primary Session title; the persisted creation title
  is only the initial worktree slug seed and is never a second mutable title.
- Worktree owns Git checkout creation, binding, health, and cleanup.
- Pull Request owns Git comparison, push, GitHub API calls, and PR persistence.
- Chat Runtime owns runs and pending interaction state.
- Provider Runtime owns durable provider-session bindings.
- Session Await owns external waiting facts.

Work reads and composes those services but does not duplicate their semantics.

## Files

- `index.ts`: HTTP/OpenAPI/CLI routes.
- `agent-context.ts`: Work-owned primary-Session harness fragment registration.
- `model.ts`: TypeBox request and response schemas.
- `projection.ts`: pure delivery-state, authority, attention, and recovery
  projection policy.
- `service.ts`: Work persistence, aggregate reads, compensated creation,
  preparation, explicit delivery orchestration, attention aggregation, and
  redetection.
- `service.test.ts`: critical Work invariants and delivery-control tests.
- `projection.test.ts`: precedence and recovery-contract table tests.
