# Plan 002 — Add authentication to the HTTP and WebSocket surface

> **Executor instructions**: Follow step by step. Run every verification command and confirm the expected result before moving on. If a "STOP conditions" item occurs, stop and report — do not improvise. When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ac47f3b..HEAD -- apps/server/src/app.ts apps/server/src/http apps/server/src/config` — if any in-scope file changed, compare the "Current state" excerpts against live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH — an auth check applied too broadly will break the desktop app, web app, CLI, and relay clients simultaneously.
- **Depends on**: none (but 003 depends on this)
- **Category**: security
- **Planned at**: commit `ac47f3b`, 2026-07-05

## Why this matters

Every one of the ~40 Elysia modules mounts with no identity check. Any process that can reach the listen address gets full server capability: secrets CRUD, host filesystem browse, PTY shell spawn, chat streams, observability data. The app was designed as "local-only", but the relay feature (see plan 003) now forwards external traffic to this same open API, so the local-only assumption no longer holds. This plan introduces a single opt-in auth boundary that later plans (003 relay, 004 filesystem/pty) build on.

## Current state

- `apps/server/src/app.ts:93-179` — `createServerContractApp` mounts all modules via `app.use(...)` with only CORS, request-id, request-logger, error-handler, and openapi plugins before them. No auth plugin exists.

```101:128:apps/server/src/app.ts
  app.onRequest(({ request, set }) => {
    if (
      request.headers.get('access-control-request-private-network') === 'true' &&
      isAllowedCorsOriginValue(request.headers.get('origin'))
    ) {
      set.headers['access-control-allow-private-network'] = 'true'
    }
  })
  app.use(
    cors({
      origin: isAllowedCorsOrigin,
      ...
    })
  )
  app.use(createRequestIdPlugin())
  if (includeRuntimeHttpPlugins) {
    ...
    app.use(createRequestLoggerPlugin())
    app.onError(createErrorHandler())
  }
  app.use(createOpenApiPlugin())
  app.use(health)
```

- Existing cross-cutting plugin pattern to follow: `apps/server/src/http/request-id.ts` (`createRequestIdPlugin`) and `apps/server/src/http/error-mapping.ts` (`createErrorHandler`). New auth plugin must match this factory-returning-Elysia-plugin shape.
- Config source: `apps/server/src/config/server-config.ts` (`ServerConfig`, read via `getServerConfig()` in `apps/server/src/infra.ts:73-77`). Auth token should be read from config/env here, not hardcoded.
- WebSocket endpoints that also need protection: `apps/server/src/modules/sync-gateway/index.ts` (registered via `registerSyncGatewayRoutes(app)` at `app.ts:170`) and `apps/server/src/modules/pty/index.ts` (via `registerPtyRoutes(app)` at `app.ts:169`). These use raw WS upgrade, not the normal request pipeline — they need an explicit token check at upgrade time.
- `AppError` (`apps/server/src/errors/app-error.ts`) is the standard domain error; a 401 should be thrown as `new AppError({ code: 'unauthorized', status: 401, message: ... })` so `error-mapping.ts` renders it.

## Commands you will need

| Purpose   | Command                                            | Expected on success |
|-----------|----------------------------------------------------|---------------------|
| Typecheck | `pnpm --filter @cradle/server typecheck`           | exit 0, no errors   |
| Tests     | `pnpm --filter @cradle/server test`                | all pass            |

## Scope

**In scope**:
- `apps/server/src/http/auth.ts` (create) — the auth plugin + a shared `verifyRequestToken` helper.
- `apps/server/src/app.ts` — wire the plugin after request-id and before `app.use(health)`; exempt `/health` and OpenAPI routes.
- `apps/server/src/config/server-config.ts` — add an auth-token config value (read from env, e.g. `CRADLE_AUTH_TOKEN`), plus a boolean `authRequired` that defaults to false when no token is configured (so existing local dev keeps working until a token is set).
- `apps/server/src/modules/sync-gateway/index.ts` and `apps/server/src/modules/pty/index.ts` — add token check at WS upgrade.
- `apps/server/src/http/auth.test.ts` (create).

**Out of scope**:
- Relay-scoped token injection — that is plan 003. This plan only adds the boundary and a single shared token mode.
- Per-route authorization / ownership checks — separate concern.
- Changing CORS logic — that is part of plan 005.

## Steps

### Step 1: Add auth config
In `server-config.ts`, add `authToken: string | null` (from `process.env.CRADLE_AUTH_TOKEN?.trim() || null`) and a derived `authRequired: boolean` (true iff a token is present OR `process.env.CRADLE_AUTH_REQUIRED === 'true'`). Keep the default off so unconfigured local installs are unaffected until the desktop app opts in.

**Verify**: `pnpm --filter @cradle/server typecheck` → exit 0

### Step 2: Create the auth plugin
In `http/auth.ts`, export `createAuthPlugin()` returning an Elysia instance with an `onRequest`/`onBeforeHandle` hook that: (a) no-ops when `authRequired` is false; (b) allows `GET /health` and OpenAPI doc routes unconditionally; (c) reads a bearer token from `Authorization` header (or a `x-cradle-token` header for WS-adjacent clients) and compares with a constant-time equality (`crypto.timingSafeEqual`) against the configured token; (d) throws `AppError` 401 on mismatch. Also export `verifyRequestToken(headers): boolean` for reuse by WS upgrades.

**Verify**: `pnpm --filter @cradle/server typecheck` → exit 0

### Step 3: Wire into app.ts
Insert `app.use(createAuthPlugin())` immediately after `app.use(createRequestIdPlugin())` and before `app.use(createOpenApiPlugin())`. Confirm ordering leaves `/health` reachable.

**Verify**: `pnpm --filter @cradle/server test` → all pass (health check test still green)

### Step 4: Guard the two WebSocket entrypoints
In `sync-gateway/index.ts` and `pty/index.ts`, at the WS upgrade handler, call `verifyRequestToken` on the upgrade request headers (or a token query param, since browsers can't set WS headers — support `?token=` as well). Reject the upgrade with a close code when `authRequired` and the token is absent/wrong.

**Verify**: `pnpm --filter @cradle/server test` → all pass

### Step 5: Tests
Write `http/auth.test.ts` using the app-request pattern from existing module tests (e.g. `apps/server/src/modules/workspace` tests use `app.handle(new Request(...))`). Cover: authRequired=false lets everything through; authRequired=true rejects missing token (401), rejects wrong token (401), allows correct bearer token, always allows `/health`.

**Verify**: `pnpm --filter @cradle/server test` → all pass incl. new auth tests

## Test plan

- New file `http/auth.test.ts`, 5 cases listed in Step 5. Model structure after an existing module `index.test.ts` in `apps/server/src/modules/*`.
- Verification: `pnpm --filter @cradle/server test` → all pass.

## Done criteria

- [ ] `pnpm --filter @cradle/server typecheck` exits 0
- [ ] `pnpm --filter @cradle/server test` exits 0; new auth tests pass
- [ ] With `CRADLE_AUTH_TOKEN` unset, all existing tests still pass (backwards compatible)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The desktop app (`apps/desktop`) or web client cannot be located to confirm how they will pass the token — STOP and report; the token-delivery contract must be coordinated, not guessed.
- Applying the plugin breaks more than the health test in a way that suggests routes rely on unauthenticated internal calls — STOP and report which routes.
- WS upgrade in sync-gateway/pty cannot read headers or query in the current adapter — STOP and report the adapter limitation.

## Maintenance notes

- Plan 003 (relay auth) layers relay-scoped tokens on top; keep `verifyRequestToken` general enough to accept multiple valid tokens later.
- Reviewer should confirm the default-off behavior and that `/health` stays public (used by desktop supervisor and relay readiness checks).
- Deferred: rotating/expiring tokens and per-client tokens — out of scope here.
