# Plan 032: Add transparent remote-host Upstream Gateway and delete RemoteCradleClient

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 0ff0271..HEAD -- apps/server/src/modules/remote-hosts apps/server/src/modules/workspace/service.ts apps/server/tests/remote-hosts.test.ts apps/server/src/modules/relay-transport/README.md packages/cli/src/commands/generated/remote-host`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED — must preserve connect/disconnect/relay claim and not invent a second remote protocol
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `0ff0271`, 2026-07-09

## Why this matters

Remote Control transport already works: connect yields `localBaseUrl` on
`127.0.0.1` via SSH, direct URL, or Relay. Product code still reaches the remote
Cradle Server only through a hand-written `RemoteCradleClient` with five methods
(health, workspaces, read-only files). That client cannot scale to sessions,
chat streams, git, or providers, and it is historical debt.

This plan makes the remote Cradle Server fully addressable as a transparent
HTTP/SSE/WebSocket upstream under the local control plane, then deletes
`RemoteCradleClient` so there is one path only: tunnel → upstream gateway.

## Current state

- Ownership boundary (must keep): `apps/server/src/modules/remote-hosts/README.md`
  says this module must **not** define a second remote agent protocol; call the
  target Cradle Server's existing HTTP APIs through the tunnel.
- Routes today (`apps/server/src/modules/remote-hosts/index.ts`): host CRUD,
  connect/disconnect/health/test, relay claim, plus hand-written workspace/file
  proxy routes under `/:hostId/cradle-server/workspaces...`.
- Client today (`apps/server/src/modules/remote-hosts/remote-cradle-client.ts`):

```68:75:apps/server/src/modules/remote-hosts/remote-cradle-client.ts
export interface RemoteCradleClient {
  readHealth: () => Promise<RemoteCradleServerHealthPayload>
  listWorkspaces: () => Promise<RemoteWorkspaceView[]>
  listWorkspaceFiles: (remoteWorkspaceId: string) => Promise<RemoteWorkspaceFileEntry[]>
  listWorkspaceFileChildren: (remoteWorkspaceId: string, relativePath: string) => Promise<RemoteWorkspaceFileEntry[]>
  readWorkspaceFileContent: (remoteWorkspaceId: string, relativePath: string) => Promise<RemoteWorkspaceFileContent>
  readWorkspaceFileInfo: (remoteWorkspaceId: string, relativePath: string) => Promise<RemoteWorkspaceFileInfo | null>
}
```

- Service helpers call that client after `connectedRecord()`
  (`apps/server/src/modules/remote-hosts/service.ts` around lines 365–411).
- Workspace module remote file reads call those helpers
  (`apps/server/src/modules/workspace/service.ts` around lines 380–495).
- Tests: `apps/server/tests/remote-hosts.test.ts` spins a fake remote HTTP
  server and exercises connect + workspace/file routes.
- Relay already multiplexes arbitrary TCP to the host HTTP port and returns
  `localBaseUrl` (`apps/server/src/modules/relay-transport/README.md` "Runtime Tunnel").
- Conventions: Elysia modules under `apps/server/src/modules/<name>/` with
  `index.ts` / `model.ts` / `service.ts` / `README.md`. Errors use `AppError`
  from `apps/server/src/errors/app-error.ts`. Match existing remote-hosts style.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck server | `pnpm --filter @cradle/server typecheck` | exit 0 |
| Focused remote-host tests | `pnpm --filter @cradle/server exec vitest run tests/remote-hosts.test.ts --reporter=dot` | all pass |
| Full server tests (after gateway) | `pnpm --filter @cradle/server exec vitest run --maxWorkers=1 --reporter=dot` | all pass (or note pre-existing failures outside this plan) |
| Regenerate web OpenAPI client (if routes change) | `pnpm --filter @cradle/web generate` | exit 0 |
| Regenerate CLI (if `x-cradle-cli` routes change) | follow `packages/cli` / server OpenAPI export used by this repo (same path as other route changes; if unsure STOP) | generated commands match new routes |
| Grep debt gone | `rg -n "RemoteCradleClient\|createRemoteCradleClient\|remote-cradle-client" apps/server packages/cli apps/web` | no matches except historical docs outside in-scope files (should be none in code) |

## Suggested executor toolkit

- Skill: `server-app-development` when adding Elysia routes / OpenAPI / CLI metadata.
- Skill: `cli-app-development` if generated CLI commands must be regenerated.
- Do **not** implement session projection or chat routing here (plans 033–034).

## Scope

**In scope** (the only files you should modify / create / delete):

- `apps/server/src/modules/remote-hosts/upstream.ts` (create) — gateway core
- `apps/server/src/modules/remote-hosts/upstream.test.ts` (create) — unit/integration helpers if useful
- `apps/server/src/modules/remote-hosts/index.ts` — add upstream route; remove hand-written workspace/file routes
- `apps/server/src/modules/remote-hosts/service.ts` — replace client usage with upstream helpers; keep connect/disconnect/claim
- `apps/server/src/modules/remote-hosts/model.ts` — only if still needed for control-plane responses; remove schemas that exist solely for deleted file-proxy routes when unused
- `apps/server/src/modules/remote-hosts/remote-cradle-client.ts` — **delete**
- `apps/server/src/modules/remote-hosts/README.md` — document upstream; remove RemoteCradleClient
- `apps/server/src/modules/workspace/service.ts` — remote file ops call upstream helpers (not a typed client)
- `apps/server/tests/remote-hosts.test.ts` — assert upstream forwarding; drop assertions that require deleted routes **or** keep thin aliases only if Step 4 chooses aliases (prefer delete)
- `apps/server/src/modules/relay-transport/README.md` — replace RemoteCradleClient wording with upstream
- `apps/web/src/features/settings/remote-hosts-settings.tsx` — switch workspace/file fetches to upstream paths (or temporary local workspace routes that already rewrite)
- `apps/web/src/features/workspace/workspace-sidebar.tsx` — remote workspace list via upstream if it used cradle-server workspace routes
- Generated artifacts **only if** this plan's route changes require them:
  - `apps/web/src/api-gen/**` via `pnpm --filter @cradle/web generate`
  - `packages/cli/src/commands/generated/remote-host/**` via the repo's CLI generate path
- `plans/README.md` status row for 032

**Out of scope** (do NOT touch):

- Session projection / `remote_session_links` (plan 033)
- Chat-runtime execution routing (plan 033)
- Handoff / git push migration
- Teaching chat-runtime about remote paths
- Changing relay crypto / pairing protocol
- Expanding provider-target namespaces with remote host ids (README forbids this)

## Git workflow

- Branch: `advisor/032-remote-host-upstream-gateway` (or continue on current feature branch if operator already placed you there)
- Commit style (from recent history): `feat(remote-hosts): ...` / `test(remote-hosts): ...`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add `upstreamRequest` + ensure-connected helper

In `apps/server/src/modules/remote-hosts/`, create `upstream.ts` that:

1. Calls the existing connect path (reuse `connectedRecord` logic — either export a
   narrow `ensureRemoteHostConnected(hostId): { baseUrl: string }` from
   `service.ts`, or move connection lookup into a shared internal module both
   `service.ts` and `upstream.ts` can use). Prefer **minimal export** from
   `service.ts` rather than duplicating the `connections` Map.
2. Exposes something like:

```ts
export async function upstreamFetch(
  hostId: string,
  pathWithQuery: string, // must start with `/`
  init?: RequestInit,
): Promise<Response>
```

3. Builds URL as `new URL(pathWithQuery.replace(/^\//, ''), baseUrl + '/')`.
4. On tunnel missing / connect failure, throw `AppError` with
   `code: 'remote_cradle_server_not_connected'` (or existing equivalent) status 503.
5. Does **not** parse JSON unless a small helper `upstreamJson<T>` is needed by
   workspace service — keep raw `Response` as the primary API.

**Verify**: `pnpm --filter @cradle/server typecheck` → exit 0 (may need a stub
route import; if typecheck fails only due to unused file, proceed to Step 2).

### Step 2: Mount transparent gateway route

In `remote-hosts/index.ts`, add a catch-all under:

```http
ALL /remote-hosts/:hostId/upstream/*
```

Requirements:

- Forward method, query string, and body.
- Forward headers except hop-by-hop:
  `connection`, `keep-alive`, `proxy-authenticate`, `proxy-authorization`,
  `te`, `trailers`, `transfer-encoding`, `upgrade`, `host`.
- Strip or rewrite `host` to the upstream host derived from `localBaseUrl`.
- Return upstream status, headers (filter hop-by-hop), and body stream.
- Support at least: JSON GET/POST, SSE (`text/event-stream`), and large bodies.
- WebSocket: if Elysia cannot upgrade-proxy cleanly in this codebase, implement
  HTTP+SSE first and document WS as a follow-up **only if** you hit a hard
  framework limit — then STOP and report with the exact Elysia limitation.
  Do not fake WS.
- OpenAPI: mark as a passthrough / undocumented catch-all if TypeBox cannot
  express `*`. Prefer a working runtime route over a perfect OpenAPI schema.
  Do **not** add `x-cradle-cli` for the catch-all.
- Keep control-plane routes: connect, disconnect, health, test, relay claim.

**Verify**: extend `apps/server/tests/remote-hosts.test.ts` fake remote with
`GET /health` (already present) and assert:

```http
GET /remote-hosts/:hostId/upstream/health
```

returns the fake payload after connect. Also assert
`GET /remote-hosts/:hostId/upstream/workspaces` returns the fake workspace list.

Run:
`pnpm --filter @cradle/server exec vitest run tests/remote-hosts.test.ts --reporter=dot`
→ pass.

### Step 3: Rewire service + workspace module off RemoteCradleClient

1. Replace `listRemoteCradleWorkspaces`, file helpers, and health fetch internals
   to use `upstreamFetch` / `upstreamJson` against paths like `/workspaces`,
   `/workspaces/:id/files`, etc.
2. In `workspace/service.ts`, keep the remote vs local branching, but ensure
   remote branches call the rewired RemoteHosts helpers (which now use upstream),
   not a client type.
3. Delete `remote-cradle-client.ts` and all imports.
4. Update `remote-hosts/README.md` and `relay-transport/README.md` wording.

**Verify**:
- `rg -n "RemoteCradleClient|createRemoteCradleClient|remote-cradle-client" apps/server` → no matches
- `pnpm --filter @cradle/server typecheck` → exit 0
- `pnpm --filter @cradle/server exec vitest run tests/remote-hosts.test.ts --reporter=dot` → pass

### Step 4: Remove hand-written cradle-server workspace/file HTTP routes

Delete from `remote-hosts/index.ts`:

- `GET /:hostId/cradle-server/workspaces`
- `GET /:hostId/cradle-server/workspaces/:remoteWorkspaceId/files`
- `GET .../files/children`
- `GET .../files/content`
- `GET .../files/info`

Callers must use:

- Gateway: `/remote-hosts/:hostId/upstream/workspaces...`, or
- Existing local `/workspaces/:id/files...` which already proxies via service
  for remote locators (preferred for in-app file browser bound to a local
  workspace row).

Update web settings / sidebar that listed remote workspaces via the deleted
routes to call upstream instead (raw fetch to
`/remote-hosts/${hostId}/upstream/workspaces` is acceptable if generated client
is not ready yet; prefer regenerating OpenAPI client in Step 5).

Update/remove generated CLI commands that pointed at deleted routes.

**Verify**: focused remote-hosts tests still pass; any test that hit deleted
paths is rewritten to upstream paths.

### Step 5: Regenerate clients if needed

If web or CLI still reference deleted operations:

1. `pnpm --filter @cradle/web generate`
2. Regenerate CLI per repo convention (inspect how other plans/scripts do it;
   common path is server OpenAPI export + `packages/cli` generate script).
3. Fix TypeScript breakages in settings/sidebar only as needed for this plan.

**Verify**:
- `pnpm --filter @cradle/server typecheck` → exit 0
- `pnpm --filter @cradle/web typecheck` → exit 0 (if web touched)
- `rg -n "CradleServerWorkspacesByRemoteWorkspaceIdFiles|cradle-server/workspaces" apps/web/src/features packages/cli/src/commands/generated` → no stale generated command usage for deleted routes (upstream or local workspace routes only)

### Step 6: Full server regression smoke

Run:
`pnpm --filter @cradle/server exec vitest run --maxWorkers=1 --reporter=dot`

If failures are clearly unrelated to remote-hosts/workspace (document file +
assertion), do not expand scope — note them in the executor report. Failures in
`tests/remote-hosts.test.ts` or workspace remote file paths are blockers.

**Verify**: remote-hosts + any workspace tests touching remote locators pass.

## Test plan

Add/extend in `apps/server/tests/remote-hosts.test.ts` (model after existing
fake remote server in that file):

1. **Happy path**: connect direct-url host → `GET .../upstream/health` → 200 + payload
2. **Passthrough list**: `GET .../upstream/workspaces` → remote workspace array
3. **Not connected / disabled host**: upstream call yields 503/409 with stable `AppError` code
4. **Header filtering**: upstream sees no `Host: localhost` leak that breaks the fake server (assert request reaches fake server)
5. **Regression**: local workspace file read for a registered remote locator still works via `/workspaces/:id/files` if that path remains (uses rewired service)

Optional unit test for hop-by-hop header stripping if logic is non-trivial.

## Done criteria

- [ ] `ALL /remote-hosts/:hostId/upstream/*` forwards to the connected `localBaseUrl`
- [ ] `apps/server/src/modules/remote-hosts/remote-cradle-client.ts` is deleted
- [ ] `rg -n "RemoteCradleClient|createRemoteCradleClient|remote-cradle-client" apps/server packages/cli` returns no code matches
- [ ] Hand-written `cradle-server/workspaces` and file proxy routes are removed
- [ ] Control-plane connect/disconnect/health/test/relay claim still work
- [ ] `pnpm --filter @cradle/server typecheck` exits 0
- [ ] `pnpm --filter @cradle/server exec vitest run tests/remote-hosts.test.ts --reporter=dot` passes
- [ ] README files no longer instruct callers to use `RemoteCradleClient`
- [ ] `plans/README.md` status row for 032 updated
- [ ] No files outside the in-scope list are modified (`git status` / `git diff --stat`)

## STOP conditions

Stop and report back (do not improvise) if:

- Drift check shows in-scope files no longer match the excerpts above.
- Elysia cannot express a catch-all proxy and a Bun/Node raw listener would be
  required — report options; do not silently add a second HTTP server without
  approval.
- WebSocket upgrade proxy is required by an existing in-scope caller in this
  plan (it should not be — chat WS comes in 033/034). If you believe it is
  required now, STOP.
- Deleting cradle-server workspace routes forces large unrelated CLI/web
  refactors beyond settings/sidebar — STOP and report the dependency list.
- You feel pressure to reintroduce a typed method-per-API remote client.

## Maintenance notes

- Future remote capabilities should appear automatically once the remote server
  exposes them; do not add per-API proxy methods.
- Reviewers should reject any PR that recreates `RemoteCradleClient` or
  duplicates upstream paths as typed wrappers "for convenience" without a
  control-plane reason (connect/claim/health sugar is OK).
- Plan 033 depends on this gateway existing and on `RemoteCradleClient` being gone.
- Handoff remains explicitly deferred.
