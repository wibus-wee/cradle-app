# Work module

The Work module owns an outcome container and composes Session, Worktree, Pull
Request, Chat Runtime, and Await state. A Work executes on the authority that
owns its source Workspace: this server for local Workspaces, or the selected
Fabric Node for mounted Node Workspaces.

| Area | Owner | Responsibility |
| --- | --- | --- |
| HTTP and CLI contract | [`index.ts`](./index.ts), [`model.ts`](./model.ts) | Creates, reads, archives, prepares, submits, and renames Work. |
| Aggregate lifecycle | [`service.ts`](./service.ts) | Persists local Work, composes read models, and dispatches lifecycle actions to the execution authority. |
| Node authority mapping | [`node-projection.ts`](./node-projection.ts), [`node-work-link.ts`](../../../../../packages/db/src/schema/node-work-link.ts) | Maps a controller-local Work ID to the authoritative Node Work and remote Workspace. |
| Primary Session projection | [`session/node-projection.ts`](../session/node-projection.ts) | Maps the controller Session ID to the Node-owned primary Session. |
| Agent context | [`agent-context.ts`](./agent-context.ts) | Contributes the primary Work identity to the runtime that owns execution. |
| Critical behavior | [`service.test.ts`](./service.test.ts) | Verifies local isolation, delivery, compensation, and Node routing invariants. |

## Invariants

- A Session belongs to at most one Work. A Work has exactly one primary Session.
- Work requires an available single-folder Git Workspace. Multi-folder
  Workspaces remain Agent context only and cannot own a managed checkout.
- Work stores lifecycle facts, not a status machine. Activity is derived from
  Session, interaction, Await, and Worktree state.
- Work list returns `{ items, nextCursor }`, defaults to 100 rows, caps `limit`
  at 200, and batch-projects the local page. Listing one mounted Node Workspace
  first reconciles its active and archived authoritative Works. A Node Work
  point read refreshes its cached Work and primary Session metadata.
- A missing primary Session does not break an entire list. Point reads surface
  `work_primary_thread_missing` for the broken Work.
- List reads use the Pull Request state cached by the primary Session and never
  call GitHub. Detail and explicit delivery paths may refresh external state.
- The persisted creation title seeds the worktree slug. Work read models project
  the primary Session title as the current conversation title.

## Creation and execution

Local Work creation creates the primary Session, creates and binds a managed
Worktree, persists Work membership, then starts the objective as the initial
run. Default creation requires a clean source checkout and uses its current
`HEAD`. An explicit local or remote branch ref, such as `origin/main`, does not
copy source checkout changes and therefore does not require a clean source.

Node Work creation follows the remote authority boundary:

1. Resolve the mounted Workspace to its Node and remote Workspace ID.
2. Ask that Node to create the Work. The Node creates the authoritative Work,
   primary Session, managed Worktree, and initial run in its own database and
   filesystem.
3. Attach the returned primary Session through `node_session_links` and persist
   a controller-local Work plus `node_work_links` mapping.
4. Return the Node's isolation, readiness, Pull Request, and activity state with
   controller-local Work and Session IDs.

The controller never creates a local `worktrees` row for Node Work and never
uses a remote absolute path as a local execution root. If local projection
persistence fails after remote creation, creation removes the partial local
Session and attempts to archive the remote Work. If compensation also fails,
the Node remains authoritative and the orphan must be inspected there; the
controller does not claim that creation completed.

`node_work_links` is deleted with its local Work projection. It contains only
authority identifiers; Worktree state remains in the Node database.

## Node reconciliation

`GET /works?workspaceId=<mounted-node-workspace>` is a fresh read. Before
returning the local page, it reconciles the mounted Workspace's remote Sessions,
then reads every active and archived remote Work page. Remote Work and primary
Session IDs are mapped to controller-local IDs; no local Worktree is created.
The explicit `POST /works/node-projections/reconcile` endpoint owns the same
operation for callers that need counts.

Reconciliation discovers Works created directly on the Node or through another
controller, refreshes lifecycle fields, and removes projections whose authority
no longer exists. It also repairs a Work whose primary Session projection was
removed when a mounted Workspace was unmounted: the stable Work mapping is
rebound to the newly projected Session. Remote Issue IDs are not copied because
they belong to the Node database; a controller-created projection retains only
its controller-local Issue link.

Node Work rows, Session rows, and link rows are disposable projections. Provider
credentials, messages, approvals, Worktree paths, Git state, and delivery state
remain authoritative on the Node and are read or mutated through Fabric.

## Lifecycle routing

Prepare saves the complete handoff. If an open Draft PR already exists, prepare
also pushes the branch and updates that PR. Submit creates or updates the Draft
PR. The builtin `manage_pull_request` tool delegates to submit; it does not own
Work persistence. Branch rename is allowed only before any Pull Request exists
and before the branch appears on the remote. Mark Ready and merge remain
user-controlled outside this module.

For Node Work, `get`, archive/restore, prepare, submit, and branch rename execute
on the mapped Node first. The controller updates its projection only from the
successful authoritative response. An upstream failure is returned to the
caller and must not be reported as a completed local action.

Archiving local Work, or directly archiving its local primary Session, abandons
the managed checkout and removes its local branch before recording the archive
fact. Node Work must be archived through the Work API so the authority performs
that cleanup.

## Conversation and approval routing

The controller renders Node Work with the projected primary Session ID. Every
`/chat/sessions/:sessionId/*` request is intercepted by
[`linked-session-proxy.ts`](../chat-runtime/http/linked-session-proxy.ts), which
substitutes the remote Session ID and sends the request through the Fabric link.
This includes messages, streams, queue and cancel operations, runtime settings,
pending user input, and tool approval decisions. Provider credentials, run
state, messages, and approval state remain on the execution Node and are never
copied into the controller database.

## Ownership boundaries

- Session owns conversation metadata and archive hooks.
- Worktree owns checkout creation, binding, health, rename, and cleanup on the
  execution authority.
- Pull Request owns Git comparison, push, GitHub calls, and PR persistence.
- Chat Runtime owns runs and pending interaction state.
- Session Await owns external waiting facts.
- Fabric transport owns authenticated Node connectivity; Work consumes its
  upstream endpoint and does not implement another tunnel protocol.

Work reads and composes these owners. It does not duplicate their state
machines or provider credentials.
