# Plan 033: Remote session projection + link and block local runtime execution

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat c49de41..HEAD -- apps/server/src/modules/session apps/server/src/modules/chat-runtime/runtime-session-context.ts apps/server/src/modules/remote-hosts packages/db/src/schema apps/server/tests/remote-hosts.test.ts`
> Also confirm plan 032 is DONE in `plans/README.md` (Upstream Gateway exists;
> `RemoteCradleClient` is gone). If 032 is not DONE, STOP.
>
> **Reconcile note (2026-07-09)**: Since original `0ff0271`, remote-hosts gained the
> upstream gateway (032). Session/model thinkingEffort enum gained `none|minimal|max`.
> Core `getSessionRunContext` / `assertRunnableSession` excerpts below still match
> live code at `c49de41`. Proceed from that baseline.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH — wrong routing can execute agents on the wrong machine or
  corrupt local session rows
- **Depends on**: plans/032-remote-host-upstream-gateway.md
- **Category**: direction
- **Planned at**: commit `c49de41`, 2026-07-09 (reconciled; originally drafted at `0ff0271`)

## Why this matters

After plan 032, the control plane can call the entire remote Cradle Server API
through `/remote-hosts/:hostId/upstream/*`. The product still cannot chat on a
remote workspace: local `sessions` creation accepts a remote `workspaceId`, but
`getSessionRunContext` resolves only local paths and returns null, so chat fails
with a misleading not-found error.

This plan makes remote execution real without teaching local chat-runtime about
remote paths:

1. Local session row = **projection** (sidebar handle).
2. `remote_session_links` maps it to `{ hostId, remoteSessionId, remoteWorkspaceId }`.
3. Create/delete/chat for linked sessions go through upstream to the remote server.
4. Local chat-runtime **hard-rejects** linked sessions (never runs them locally).

Handoff is out of scope.

## Current state

- Workspace locator already supports remote hosts
  (`apps/server/src/modules/workspace/workspace-locator.ts`):

```7:12:apps/server/src/modules/workspace/workspace-locator.ts
export const workspaceLocatorSchema = z.object({
  hostId: nonBlankString,
  path: nonBlankString,
  kind: z.enum(['project', 'managed-worktree']).optional(),
  sourceWorkspaceId: nonBlankString.nullable().optional(),
})
```

- Local path gate (`apps/server/src/modules/workspace/service.ts`):

```698:705:apps/server/src/modules/workspace/service.ts
export function getLocalWorkspacePath(workspaceId: string): string | null {
  const row = getRecord(workspaceId)
  if (!row) {
    return null
  }
  const locator = readWorkspaceLocator(row)
  return isLocalWorkspaceLocator(locator) ? locator.path : null
}
```

- Chat run context nulls out when path missing
  (`apps/server/src/modules/chat-runtime/runtime-session-context.ts`):

```81:86:apps/server/src/modules/chat-runtime/runtime-session-context.ts
  const workspacePath = session.workspaceId
    ? (execution.rootPath || Workspace.getLocalWorkspacePath(session.workspaceId))
    : null
  if (session.workspaceId && !workspacePath) {
    return null
  }
```

- `assertRunnableSession` maps that null to `chat_session_not_found` (404) —
  wrong for remote projections; must become an explicit remote-execution error
  or must never be called for linked sessions.
- Session create (`apps/server/src/modules/session/service.ts` `create`) accepts
  any `workspaceId` with no host check; default ad-hoc workspace is always local.
- Old agentd link table was dropped in `packages/db/drizzle/0017_talented_arachne.sql`
  (`DROP TABLE remote_host_agentd_session_links`). Do **not** revive agentd.
- Chat HTTP lives under `/chat/...` (see
  `apps/server/src/modules/chat-runtime/http/*.routes.ts`), e.g. queue/respond
  under `/chat/sessions/:sessionId/...` and event tails under `/chat/...`.
- Session HTTP: `apps/server/src/modules/session/index.ts` prefix `/sessions`.
- DB conventions: Drizzle schemas in `packages/db/src/schema/`, export from
  `packages/db/src/schema/index.ts`, generate with
  `pnpm --filter @cradle/db generate`, append SQL under `packages/db/drizzle/`
  (never rewrite history — see `packages/db/drizzle/README.md`).
- Errors: `AppError` with stable `code` + HTTP status.

## Product rules (locked — do not reinterpret)

1. **Session identity**: local projection + link; remote session is source of truth.
2. **No RemoteCradleClient**: use plan 032 upstream only.
3. **No handoff** in this plan.
4. **Delete default**: deleting a local projection **cascades** to delete the
   remote session via upstream (remote control deletes the real session). If
   upstream delete fails, STOP the local delete and return an error (do not
   leave an orphan link silently). Document this in session README.
5. **Providers**: remote sessions use **remote** provider targets / model catalog
   via upstream. Do not copy local provider target ids into remote create bodies
   unless the same id exists on the remote (it will not). For create, omit local
   `providerTargetId` when projecting; let remote defaults apply, or accept
   explicit remote provider target id from the client in a later UI plan (034).
6. **`sourceWorkspaceId`**: required to create a chat session on a remote-mounted
   workspace. Resolve remote workspace id from locator.`sourceWorkspaceId` if
   set; otherwise resolve via upstream list + path match
   (`resolveRemoteWorkspaceByPath` pattern). If unresolved → 409.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Generate migration | `pnpm --filter @cradle/db generate` | new SQL + meta journal entry |
| Typecheck db | `pnpm --filter @cradle/db typecheck` (or package's equivalent; if missing, rely on server typecheck) | exit 0 |
| Typecheck server | `pnpm --filter @cradle/server typecheck` | exit 0 |
| Focused tests | `pnpm --filter @cradle/server exec vitest run tests/remote-hosts.test.ts tests/remote-session-projection.test.ts --reporter=dot` | all pass (create the new file) |
| Chat runtime smoke | `pnpm --filter @cradle/server exec vitest run tests/chat-runtime.test.ts --maxWorkers=1 --reporter=dot` | pass, or only pre-existing failures unrelated to remote links |

## Suggested executor toolkit

- Skill: `server-app-development` for Elysia/session routes and AppError codes.
- Do not implement web composer/catalog UI here (plan 034).

## Scope

**In scope**:

- `packages/db/src/schema/remote-host.ts` (or new `remote-session-link.ts`) —
  add `remoteSessionLinks` table
- `packages/db/src/schema/index.ts` — export
- `packages/db/drizzle/*.sql` + `meta/` — generated migration only
- `apps/server/src/modules/session/service.ts` — create/get/list/remove projection behavior
- `apps/server/src/modules/session/model.ts` — view fields for execution target / link metadata if exposed
- `apps/server/src/modules/session/index.ts` — only if route behavior must change
- `apps/server/src/modules/session/README.md` — document projection semantics
- `apps/server/src/modules/remote-hosts/upstream.ts` (from 032) — may add small JSON helpers if missing
- `apps/server/src/modules/chat-runtime/runtime-session-context.ts` — hard reject linked sessions
- Other chat-runtime entry points that call `assertRunnableSession` /
  `getSessionRunContext` **only as needed** to ensure linked sessions never
  enter local run loop (prefer one central guard in `getSessionRunContext` /
  `assertRunnableSession`)
- `apps/server/src/modules/chat-runtime/http/**` — route-level dispatch for
  linked sessions to upstream **or** a single middleware/helper used by those
  routes (see Steps). Prefer a shared helper over editing every handler blindly.
- New test file: `apps/server/tests/remote-session-projection.test.ts`
- Updates to `apps/server/tests/remote-hosts.test.ts` fake remote if needed to
  serve minimal `/sessions` and one `/chat/...` stub
- `plans/README.md` status row for 033

**Out of scope**:

- Web UI composer / remote catalog switching (plan 034)
- Handoff
- Recreating agentd / WebSocket agent protocol packages
- Making local git/pty/skills work against remote paths inside local modules
  (callers should use upstream; do not dual-implement)
- Changing relay transport

## Git workflow

- Branch: **stay on `main`** (operator override for this execute). Do **not** create
  `advisor/033-*` or any other branch.
- Commits: `feat(session): ...`, `feat(db): ...`, `test(session): ...` on `main`
- Do NOT push/PR unless instructed.
- Do NOT stage unrelated dirty files (e.g. plugin-marketplace / `marketplace.json`
  / unrelated `apps/server/src/modules/plugins/*` edits already present in the tree).

## Steps

### Step 1: Add `remote_session_links` schema + migration

Create table (column names may use drizzle camelCase → snake_case as elsewhere):

| Column | Type | Notes |
|--------|------|-------|
| `local_session_id` | text PK | FK → `sessions.id` ON DELETE CASCADE |
| `host_id` | text not null | FK → `remote_hosts.id` ON DELETE CASCADE |
| `remote_session_id` | text not null | |
| `remote_workspace_id` | text not null | |
| `created_at` / `updated_at` | int | use `timestamps()` helper |

Constraints:

- `UNIQUE(host_id, remote_session_id)`
- Index on `host_id`

Export types. Run `pnpm --filter @cradle/db generate` and commit the SQL + meta.

**Verify**: migration file exists under `packages/db/drizzle/`; server boots in
tests with new schema (`pnpm --filter @cradle/server typecheck`).

### Step 2: Link helpers in session (or remote-hosts) module

Add pure service APIs, e.g. in `session/service.ts` or
`session/remote-projection.ts`:

- `getRemoteSessionLink(localSessionId): Link | null`
- `isRemoteProjectedSession(localSessionId): boolean`
- `requireRemoteSessionLink(localSessionId): Link` → 409/404 with stable code
  `remote_session_link_required` / `remote_session_link_not_found` as appropriate

Expose on session GET/list view an optional field such as:

```ts
execution: { kind: 'local' } | { kind: 'remote-host', hostId: string, remoteSessionId: string }
```

Keep backward compatible: local sessions omit or set `kind: 'local'`.

**Verify**: typecheck passes; unit/service test can insert a link row and read it.

### Step 3: Central local-runtime hard reject

In `getSessionRunContext` **or** `assertRunnableSession` (prefer both: context
returns null only for missing local sessions; assert throws a **new** error for
linked sessions):

If `getRemoteSessionLink(sessionId)` is present:

```ts
throw new AppError({
  code: 'chat_session_executes_on_remote_host',
  status: 409,
  message: 'This session executes on a remote Cradle Server; use the remote-host upstream APIs.',
  details: { sessionId, hostId, remoteSessionId },
})
```

Do **not** leave the old behavior of 404 `chat_session_not_found` for linked
sessions.

**Verify**: a focused test creates a local session row + link and calls a local
chat entry that uses `assertRunnableSession` → expects 409 with the new code.

### Step 4: Create projection on remote workspace

Change `Session.create` (and HTTP POST `/sessions` behavior) when
`workspaceId` points at a non-local locator:

1. Ensure remote host connected (via plan 032 ensure helper).
2. Resolve `remoteWorkspaceId` from `sourceWorkspaceId` or path resolve via
   upstream `GET /workspaces`.
3. Upstream `POST /sessions` with a body that binds the **remote** workspace id
   and title/runtime fields that are meaningful remotely. **Do not** send local
   providerTargetId unless you have verified the remote owns that id.
4. Insert local `sessions` row (projection) with the local workspace id.
5. Insert `remote_session_links` row.
6. Return local session view including `execution.remote-host`.

If upstream create fails, do not leave an orphan local session (transaction or
compensating delete).

**Verify**: integration test with fake remote that implements `POST /sessions`
and `GET /workspaces`; assert local row + link + upstream called with remote
workspace id.

### Step 5: Delete cascade

Change `Session.remove` (and archive/delete HTTP paths that destroy sessions):

1. If link exists → upstream `DELETE` (or the remote server's actual delete /
   archive endpoint — **inspect remote `/sessions` routes** and match them;
   if only archive exists, use that and document).
2. On upstream success → delete local session (link cascades).
3. On upstream failure → throw; keep local projection.

**Verify**: test that delete hits fake remote and removes local row; test that
upstream 500 leaves local row intact.

### Step 6: Dispatch chat/session mutating + streaming APIs for linked sessions

Implement a shared helper, e.g. `proxyLinkedSessionRequest(localSessionId, path, init)`
that rewrites to:

```http
/remote-hosts/:hostId/upstream/<original-path-with-remote-session-id>
```

Wire it so that for linked sessions, control-plane routes under `/chat/...`
and any session-scoped chat routes that the web app uses for:

- send / respond / queue
- cancel / stop
- event/stream tails
- history reads needed to render chat

…forward to upstream with `remoteSessionId` substituted for `localSessionId` in
the path.

**Preferred structure** (pick one and stick to it; STOP if neither fits without
massive rewrite):

- **A (recommended)**: Early guard in each chat HTTP route file's handlers that
  touch `:sessionId` — if linked, return `upstreamFetch` response directly.
- **B**: A small Elysia plugin/derive that replaces handler for linked sessions.

Do **not** duplicate remote chat semantics locally. Do **not** call
`assertRunnableSession` on the linked path.

Minimum viable set for plan 034 to unlock chat (inspect web transport and match):

- Whatever `apps/web/src/features/chat/transport/chat-stream-transport.ts` and
  session create/send currently call.
- Session GET messages / history endpoints the chat view needs.

If the web surface is larger than expected, implement the helper + wire the
endpoints named in that transport file first; list any remaining endpoints in
the executor NOTES for plan 034 without pretending they work.

**Verify**: fake remote records forwarded paths; a test drives
`POST /chat/sessions/:localId/...` (whichever send endpoint exists) and sees
upstream receive `/chat/sessions/:remoteId/...`.

### Step 7: Docs

Update `apps/server/src/modules/session/README.md` and remote-hosts README with:

- projection + link model
- cascade delete
- local runtime hard reject code
- pointer to upstream gateway

**Verify**: docs paths exist; no mention of RemoteCradleClient or agentd links.

## Test plan

Create `apps/server/tests/remote-session-projection.test.ts` modeled on
`apps/server/tests/remote-hosts.test.ts` (temp data dir + `createServerApp` +
fake remote HTTP):

1. Create session on remote-mounted workspace → local id ≠ remote id; link row exists
2. `assertRunnableSession(localId)` / local respond → 409 `chat_session_executes_on_remote_host`
3. Chat send (wired endpoint) → upstream called with remote session id
4. Delete local → upstream delete called; both sides gone
5. Upstream delete failure → local remains
6. Missing `sourceWorkspaceId` and unresolved path → 409, no local session

## Done criteria

- [ ] `remote_session_links` table exists via appended Drizzle migration
- [ ] Creating a session on a remote-mounted workspace creates remote session + link
- [ ] Local chat-runtime cannot run linked sessions (409 stable code)
- [ ] Linked session chat/history/stream paths used by the web transport forward via upstream
- [ ] Delete cascades to remote session; failure is safe
- [ ] No `RemoteCradleClient` reintroduced
- [ ] `pnpm --filter @cradle/server typecheck` exits 0
- [ ] New projection tests pass
- [ ] `plans/README.md` status row for 033 updated
- [ ] No out-of-scope files modified

## STOP conditions

- Plan 032 not DONE / upstream missing / `RemoteCradleClient` still present.
- Drift in session/chat-runtime excerpts.
- Implementing handoff "because it is related".
- Teaching `getLocalWorkspacePath` to return remote paths or mounting remote FS locally.
- Needing a new agent protocol package.
- Cascade delete semantics conflict with an existing soft-archive-only product
  rule you discover in session README — STOP and report rather than guessing.

## Maintenance notes

- Plan 034 will teach the web app to treat `execution.kind === 'remote-host'` as
  the signal for remote catalog + connect gating.
- Reviewers must ensure no linked session reaches `TurnExecutor` / provider
  process hosts locally.
- Future handoff should rewrite/create links deliberately; do not overload
  create-projection for migration.
