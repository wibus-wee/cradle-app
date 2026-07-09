# Plan 034: Web remote-execution UX — open chat on remote workspaces via projection

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 0ff0271..HEAD -- apps/web/src/features/chat apps/web/src/features/workspace apps/web/src/features/settings/remote-hosts-settings.tsx apps/web/src/features/composer-toolbar apps/web/src/features/new-chat`
> Confirm plans 032 and 033 are DONE in `plans/README.md`. If not, STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED — wrong catalog binding could show local models for a remote session
- **Depends on**: plans/032-remote-host-upstream-gateway.md, plans/033-remote-session-projection.md
- **Category**: direction
- **Planned at**: commit `0ff0271`, 2026-07-09

## Why this matters

Plans 032–033 make remote chat possible on the server: upstream gateway +
session projection/link + local runtime hard reject. The web app still assumes
every session is locally executable: it can mount remote workspaces and browse
files, but starting chat does not surface connection state, remote execution
badges, or remote provider catalogs.

This plan wires the UI so a user can: connect a host, mount a workspace, create
a projected session, chat with streams, and pick models from the **remote**
catalog — without handoff and without a second protocol.

## Current state

- Remote host settings + file browser:
  `apps/web/src/features/settings/remote-hosts-settings.tsx` (after 032 should
  already use upstream or local workspace file routes).
- Add remote workspace from sidebar:
  `apps/web/src/features/workspace/workspace-sidebar.tsx` creates local workspace
  rows with `locator: { hostId, path, sourceWorkspaceId }`.
- Chat transport:
  `apps/web/src/features/chat/transport/chat-stream-transport.ts` talks to local
  `/chat/...` URLs (server 033 rewrites linked sessions upstream — UI can keep
  calling local session ids).
- Composer / model selection:
  `apps/web/src/features/composer-toolbar/**` and runtime settings hooks under
  `apps/web/src/features/chat/runtime/**` currently resolve local provider
  catalogs.
- Workspace helpers:
  `apps/web/src/features/workspace/types.ts` already has `isLocalWorkspace` /
  path helpers (confirm after drift check).
- Design system: follow existing Cradle UI patterns; no new card-heavy chrome.
  Use `cn()` and static Tailwind classes per `AGENTS.md`.
- i18n: strings live under `apps/web/src/locales/**` — add keys for all
  supported locales when adding user-visible copy (match how other features do it).

## Product rules (locked)

1. Local API remains the only base URL the web app configures; remote execution
   is expressed via session `execution` metadata from plan 033, not by pointing
   the whole client at `localBaseUrl`.
2. For `execution.kind === 'remote-host'`, model/provider/runtime-settings
   fetches must hit **remote** catalogs. Prefer server endpoints that already
   proxy (033) using the **local** session id; if a catalog endpoint is not
   session-scoped, call
   `/remote-hosts/:hostId/upstream/<catalog-path>` explicitly.
3. If the remote host is disconnected, block send/create with a clear Connect
   CTA — do not spin on local runtime 409s.
4. No handoff UI.
5. Do not reintroduce typed RemoteCradleClient usage in the web app.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Web typecheck | `pnpm --filter @cradle/web typecheck` | exit 0 |
| Web tests | `pnpm --filter @cradle/web test` | pass (or focused tests if full suite has known unrelated failures — document) |
| Regenerate API client if session view shape changed | `pnpm --filter @cradle/web generate` | exit 0 |
| Server still green for projection | `pnpm --filter @cradle/server exec vitest run tests/remote-session-projection.test.ts --reporter=dot` | pass |

## Suggested executor toolkit

- Skill: `make-interfaces-feel-better` / design-system conventions for badges and
  empty/disconnected states — keep changes minimal and consistent with settings
  remote-hosts UI.
- Avoid browser E2E unless operator asks; prefer unit/hook tests only if the
  repo already tests similar chat selection logic.

## Scope

**In scope**:

- `apps/web/src/features/chat/**` — session execution awareness, connect gating,
  transport only if path rewriting is required (prefer no rewrite: local ids)
- `apps/web/src/features/composer-toolbar/**` — remote catalog when execution is remote
- `apps/web/src/features/new-chat/**` and/or draft composer — creating sessions on
  remote workspaces
- `apps/web/src/features/workspace/**` — badges / labels for remote host; disable
  misleading local-only actions if any
- `apps/web/src/features/settings/remote-hosts-settings.tsx` — only if connect
  CTA reuse needs a shared helper
- `apps/web/src/locales/**` — new strings
- `apps/web/src/api-gen/**` — only via generate after server session view changes
- Focused tests under existing chat/composer test patterns if present
- `plans/README.md` status row for 034

**Out of scope**:

- Server gateway / link table (032–033)
- Handoff
- Desktop-only direct tunnel to `localBaseUrl`
- Redesigning remote host pairing wizard
- Kanban/automation remote execution

## Git workflow

- Branch: `advisor/034-remote-session-web`
- Commits: `feat(web): ...`, `fix(web): ...`
- Do NOT push/PR unless instructed.

## Steps

### Step 1: Consume session `execution` field

After 033, session payloads include execution metadata. Regenerate the web
OpenAPI client if types are missing:

`pnpm --filter @cradle/web generate`

Add a small helper, e.g. `apps/web/src/features/chat/session/session-execution.ts`:

```ts
export function isRemoteHostExecution(session: { execution?: ... }): boolean
export function getRemoteHostId(session): string | null
```

**Verify**: `pnpm --filter @cradle/web typecheck` → exit 0

### Step 2: Connection gate before create/send

When the active workspace is remote (`!isLocalWorkspace`) or the session
execution is remote-host:

1. Read remote host connection status from existing remote-hosts APIs (list /
   connect endpoints already in settings).
2. If disconnected: show inline status + Connect button (reuse settings connect
   mutation if possible).
3. Block composer send / new-chat create until connected (or until create will
   auto-connect server-side — if server auto-connects on create, still show
   status; do not allow silent failure).

**Verify**: typecheck; manual reasoning covered by a shallow unit test of the
gate helper if easy. No Playwright required.

### Step 3: New chat / session create on remote workspace

Ensure new-chat and draft composer pass the local remote-mounted `workspaceId`
into `POST /sessions` (server 033 creates projection). Do not invent a separate
"remote session create" client API.

If create currently assumes local providerTargetId is required, adjust so remote
workspaces can create with remote defaults (omit local provider target, or pass
a remote target id once catalog is loaded in Step 4).

**Verify**: typecheck; grep new-chat paths for `getLocalWorkspacePath` assumptions
that would block remote ids.

### Step 4: Remote provider / model catalog for remote sessions

For remote execution sessions:

- Point model selector / runtime settings queries at session-scoped server APIs
  that 033 proxies, **or** at
  `/remote-hosts/${hostId}/upstream/...` catalog routes.
- Hide local-only provider targets in the selector for that session.
- Keep local sessions unchanged.

Match existing composer-toolbar resolution patterns in
`apps/web/src/features/composer-toolbar/resolution/composer-selection.ts`.

**Verify**: `pnpm --filter @cradle/web typecheck`; add/extend a unit test in
`composer-selection.test.ts` (or adjacent) proving remote execution selects the
remote catalog branch.

### Step 5: Chat surface labels + error mapping

1. Show a subtle execution badge on chat header / session list item:
   `On {hostDisplayName}` when remote.
2. Map server error `chat_session_executes_on_remote_host` to a human message
   that tells the user the UI is mis-routed (should be rare if Steps 3–4 work).
3. Map `remote_cradle_server_not_connected` to the Connect CTA.

**Verify**: locale keys exist for en-US and other locale files this repo
requires for PRs (check how other features add keys — usually all under
`apps/web/src/locales/`).

### Step 6: Smoke against server projection tests

Do not build a full browser harness. Confirm server projection tests still pass
and web typecheck/tests pass.

**Verify**:
- `pnpm --filter @cradle/server exec vitest run tests/remote-session-projection.test.ts --reporter=dot`
- `pnpm --filter @cradle/web typecheck`
- `pnpm --filter @cradle/web test` (or focused composer/chat tests if full suite
  is known-noisy — document)

## Test plan

- Unit: `isRemoteHostExecution` / catalog branch selection
- Unit: composer selection with a mock session `execution: { kind: 'remote-host', hostId }`
- No component screenshot tests unless already standard

## Done criteria

- [ ] User can create a session on a remote-mounted workspace from the web UI
      (server creates projection)
- [ ] Composer send works while host is connected (uses local session id; server
      proxies)
- [ ] Remote sessions show remote model catalog, not local-only targets
- [ ] Disconnected host blocks send/create with Connect CTA
- [ ] Session/chat UI shows remote execution affordance
- [ ] No handoff UI added
- [ ] `pnpm --filter @cradle/web typecheck` exits 0
- [ ] Relevant web tests pass
- [ ] `plans/README.md` status row for 034 updated
- [ ] No out-of-scope server refactors

## STOP conditions

- Plans 032/033 not DONE.
- Session payloads lack `execution` and regenerating OpenAPI does not reveal it —
  server 033 incomplete; STOP.
- Chat requires WebSocket upgrade proxy that 032 explicitly deferred — STOP and
  report; do not invent a browser-direct tunnel.
- Temptation to point the global API `baseUrl` at upstream for "simplicity".

## Maintenance notes

- When handoff is designed later, reuse `execution` + link rather than a parallel
  UI mode.
- Reviewers should reject any change that sends local provider API keys to the
  remote server from the browser.
