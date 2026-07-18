# Work module

The Work module owns the local outcome container: its objective, primary-thread
membership, prepared handoff metadata, archive fact, and composition of existing
Session, Worktree, Pull Request, Chat Runtime, and Await read models.

## Invariants

- A Session belongs to at most one Work.
- A Work has exactly one primary Session in the local v1 flow.
- Work creation requires a local Git workspace and an immediately active
  managed Worktree.
- Default creation bases the managed Worktree on a clean local `HEAD`
  (`baseStrategy: source-head`). When the source checkout is dirty, clients may
  explicitly opt into `baseStrategy: remote-default` to start from the remote
  tracking default branch tip (for example `origin/main`) without touching local
  WIP.
- Work stores facts only. Activity labels are derived and no Work status machine
  exists.
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

## Ownership boundaries

- Session owns conversation metadata and archive behavior.
- Work API read models project the primary Session title; the persisted creation title
  is only the initial worktree slug seed and is never a second mutable title.
- Worktree owns Git checkout creation, binding, health, and cleanup.
- Pull Request owns Git comparison, push, GitHub API calls, and PR persistence.
- Chat Runtime owns runs and pending interaction state.
- Session Await owns external waiting facts.

Work reads and composes those services but does not duplicate their semantics.

## Files

- `index.ts`: HTTP/OpenAPI/CLI routes.
- `agent-context.ts`: Work-owned primary-Session harness fragment registration.
- `model.ts`: TypeBox request and response schemas.
- `service.ts`: Work persistence, aggregate reads, compensated creation,
  preparation, and explicit delivery orchestration.
- `service.test.ts`: critical Work invariants and delivery-control tests.
