# Session Module

Session owns CRUD, pin toggle, soft archive/restore, markdown export, and session-owned lifecycle hooks. Chat transcript hydration is owned by Chat Runtime through `GET /chat/sessions/:sessionId/messages`; this module no longer exposes raw message-list HTTP routes.

| Area | Owner | Responsibility |
| --- | --- | --- |
| Session state | [`service.ts`](./service.ts) | Owns CRUD, archive lifecycle, titles, origin, read state, and execution projections returned by list/get. |
| HTTP contract | [`index.ts`](./index.ts), [`model.ts`](./model.ts) | Defines Session routes, pagination, mutation schemas, and generated-client response shapes. |
| Fabric projection | [`node-projection.ts`](./node-projection.ts) | Maps a controller-local Session id to an authoritative Session on another Node and reconciles mounted Workspace sessions. |
| Chat traffic | [`linked-session-proxy.ts`](../chat-runtime/http/linked-session-proxy.ts) | Rewrites linked Session paths and forwards all Session-scoped Chat Runtime traffic to the target Node. |
Session owns the default provider target and requested execution preferences for a chat. Patch updates may change `providerTargetId`, the session-requested `modelId`, and `thinkingEffort`; model, thinking-effort, runtime settings, and session-scoped Claude Agent model aliases are stored in `sessions.configJson` and Chat Runtime passes them into Provider Runtime when a run starts. Backend session bindings remain Provider Runtime Directory state for durable/resumable runtime bindings, with read-only fallback for older rows.
Session list/get responses expose the session-requested model id as `modelId`, falling back to backend session bindings when no session preference exists, a read-only `status` projection from chat-runtime-owned run rows and Codex active-goal snapshots so navigation surfaces can show active or errored sessions without opening them, `latestUserMessageAt` so session list timestamps use the same semantic clock as list ordering instead of mutable session metadata updates, and server-owned read-state projection through `lastReadAt`, `latestAssistantMessageAt`, and `unread`. Historical run rows do not keep a session in `streaming`; Chat Runtime owns cleanup of orphaned persisted streaming rows.
Session exposes user title edits through `PATCH /sessions/:id`, but title persistence is projected from Chat Runtime `TitleChanged` events. Provider adapters never write Session rows directly.
Session origin is owned by this module as coarse source metadata for list and search filtering. Ordinary sessions default to `manual`; workflow-owned callers may set broad origins such as `automation`, `cradle-review`, or `cradle-issue`. Detailed lifecycle records stay in the owning workflow namespace, for example diff-review guide or agent-fix rows that link back by session id and run id.
Side chat parentage is stored on Session rows through `parentSessionId` and `sideContextSource`, but side chat creation semantics are owned by Chat Runtime. Session only persists the relationship and exposes it to list/get responses so renderers can navigate and future lifecycle policies can reason about side children without writing into provider namespaces.
Session lists return `{ items, nextCursor }`, default to 100 active rows, and cap `limit` at 200. The opaque cursor preserves the latest-user-message ordering (falling back to session creation time before a user turn exists). Requested model, latest run status, message activity, Worktree isolation, and remote execution are projected with page-bounded set reads instead of per-Session database lookups. Listing never starts remote title synchronization; point reads may still request that best-effort refresh. Pass `archived=true` to list archived rows without deleting session-owned messages, usage, or runtime binding history. Archiving runs pre-archive lifecycle hooks before the archive fact is persisted, then emits archive hooks so runtime owners can release live resources while preserving persisted session history. Pre-archive hooks may reject archival when their owned cleanup cannot complete; Work uses this to remove its managed checkout before its primary Session is archived.

## Node session projection

Sessions created on a workspace mounted from a Fabric Node are **local projections** linked to the authoritative Node session through `node_session_links`. List/get responses expose `execution.kind`:

- `local` — chat runs on this Cradle Server through Chat Runtime.
- `node` — chat runs on the linked Node; local Chat Runtime hard-rejects these sessions with `chat_session_executes_on_fabric_node` (HTTP 409).

Creating a projection:

1. Resolve the remote workspace id from `locator.sourceWorkspaceId` or upstream workspace list + path match.
2. `POST` the Node session through the Fabric link manager and its local encrypted tunnel endpoint.
3. Insert the local `sessions` row and `node_session_links` mapping `{ nodeId, remoteSessionId, remoteWorkspaceId }`.

Mounted Workspace reconciliation reads both active and archived Session pages
from the authoritative Node. It creates missing projections, updates remote
metadata and user/assistant activity clocks, and removes local projections
whose authority no longer exists. The cached remote user clock is used by the
controller's Session pagination and sidebar ordering; messages themselves stay
on the Node. A failed page read aborts before removal, so a disconnected Node
cannot be mistaken for an empty Workspace.

`node_session_links.projectionKind` preserves deletion ownership:

| Kind | Created when | Local delete behavior |
| --- | --- | --- |
| `controller-created` | This controller created the authoritative Session through a mounted Workspace. | Delete the remote Session first; keep the local row if upstream deletion fails. |
| `discovered` | Reconciliation found a Session created from another controller or directly on the target Node. | Remove only the local projection. If the authority still exists, later reconciliation may discover it again. |

Reconciliation removes either kind when the complete authoritative active and
archived listings prove the remote Session no longer exists. It never copies
messages or provider credentials between databases.

Linked chat traffic for **all** `/chat/sessions/:sessionId/*` paths is intercepted by
`linkedChatSessionProxyPlugin` (mounted in `app.ts`) and forwarded through
`/nodes/:nodeId/upstream/*` with `remoteSessionId` substituted. Non-session chat
routes (composer drafts, global catalogs) stay local. See `session/node-projection.ts`
and Chat Runtime `http/linked-session-proxy.ts`.

Provider targets for remote projections are owned by the remote server. The web
composer loads that remote catalog and forwards the selected remote
`providerTargetId`, `modelId`, `thinkingEffort`, and runtime settings through the
local projection create call. The target server validates and stores the binding;
the local projection row keeps `providerTargetId` null so it does not claim a
foreign provider namespace.
Provider-backed session creation resolves a stable agent persona and stores `agentId`, so CLI calls carrying the session context can be attributed to an Agent identity.
Session creation rejects disabled agents and provider-backed agents whose selected provider target is disabled, returning a conflict before any runtime launch is attempted.
Agent-terminal session creation is driven by runtime session launch descriptors and must start from an agent with terminal launch configuration; provider-launched sessions continue to resolve provider targets through provider compatibility metadata.
Session creation 支持 no-project chats 缺省 `workspaceId`。这种情况下，本 module 会委托 workspace module 创建 ad-hoc workspace，并在任何 runtime launch 前把返回的 workspace id 写入 session。调用方显式传入 `workspaceId: null` 时，session 保持 workspace-unbound；Jarvis 使用这个路径保持系统会话隐藏，实际 jar-core 数据由 chat-runtime 写入 Cradle data dir。
Route metadata includes `x-cradle-cli` descriptors for generated CLI commands.
Session-bound GitHub draft PR create/get/ready lives in the `pull-request` module (`/sessions/:id/pull-request*`), not in this module's route file.

## Files

- **index.ts**: Elysia route surface for CRUD, archive/restore, read/unread cursor updates, export, and linked-issue helpers.
- **model.ts**: Session HTTP params/body/response schemas, including side chat parent/source response fields, coarse `origin` filtering, the list/get `status` and read-state projections, and provider/model/thinking patch fields.
- **service.ts**: Module semantics (CRUD + archive + export + lifecycle hooks), session-owned origin persistence and filtering, session-owned side chat relationship persistence, session-owned provider/model/thinking updates, read-only run and Codex active-goal status projection, read cursor persistence, no-project chat workspace binding, provider-backed default agent binding and launchability checks, session-owned title updates, archive hooks, and session-owned delete hooks.
