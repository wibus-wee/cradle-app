# Plan 005 — Close SSRF gaps in link-preview and provider-catalog fetches

> **Executor instructions**: Follow step by step; verify each step. Honor STOP conditions. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat ac47f3b..HEAD -- apps/server/src/lib/ssrf-guard.ts apps/server/src/modules/link-preview apps/server/src/modules/provider-catalog` — mismatch = STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW — tightening the fetch path; legit LAN LLM endpoints may need an allowlist.
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `ac47f3b`, 2026-07-05

## Why this matters

`resolveSafeFetchTarget` resolves DNS and checks the address **once**, then `link-preview` fetches with `redirect: 'follow'`. A hostname can pass the pre-fetch check (public IP) and then redirect or DNS-rebind to loopback/link-local/metadata addresses — the classic TOCTOU SSRF. Worse, `provider-catalog` fetches a client-settable `baseUrl` with no guard at all, and the `baseUrl` is set through an (currently unauthenticated) `PUT /provider-targets/:id`. This lets an attacker coerce server-side requests into the private network.

## Current state

- `apps/server/src/lib/ssrf-guard.ts:25-77` — resolves and validates once, returns a URL string; the guard itself is solid (RFC1918 + loopback + link-local + CGNAT + metadata + IPv4-mapped IPv6). The gap is purely that callers fetch afterward without pinning.
- `apps/server/src/modules/link-preview/service.ts:34-59` — validates then fetches with retry/redirect:

```34:47:apps/server/src/modules/link-preview/service.ts
  let target
  try {
    target = await resolveSafeFetchTarget(trimmed)
  }
  catch {
    ...
  }
  const preview = await fetchPreview(target)
```

```55:59:apps/server/src/modules/link-preview/service.ts
    const response = await fetchWithRetry(target.url, {
      headers: {
        'user-agent': USER_AGENT,
        'accept': 'text/html,application/xhtml+xml',
      },
```

- `apps/server/src/modules/provider-catalog/catalog.ts:265-282` — `fetch(option.url)` built from provider `baseUrl` with no SSRF guard (per audit).
- `apps/server/src/lib/outbound-network.ts` exists and already centralizes some outbound policy — read it; the redirect-safe fetch belongs here.

## Commands you will need

| Purpose   | Command                                            | Expected |
|-----------|----------------------------------------------------|----------|
| Typecheck | `pnpm --filter @cradle/server typecheck`           | exit 0   |
| Tests     | `pnpm --filter @cradle/server test`                | all pass |
| Focused   | `pnpm --filter @cradle/server test ssrf`           | pass     |

## Scope

**In scope**:
- `apps/server/src/lib/ssrf-guard.ts` — add a `safeFetch` (or `createGuardedDispatcher`) that re-validates on every redirect hop or pins the resolved IP at connect time (undici is available — use a custom `Agent`/`connect` that blocks private ranges).
- `apps/server/src/modules/link-preview/service.ts` — use the redirect-safe fetch with `redirect: 'manual'` + per-hop re-validation.
- `apps/server/src/modules/provider-catalog/catalog.ts` — route the model-list fetch through the guard (with an optional explicit LAN allowlist for private LLM endpoints).
- `apps/server/src/lib/ssrf-guard.test.ts` (extend; `outbound-network.test.ts` exists as a pattern).

**Out of scope**:
- Adding auth to `PUT /provider-targets/:id` — covered by plan 002.
- github-api.ts fetches (fixed public host).

## Steps

### Step 1: Add a redirect-safe guarded fetch
In `ssrf-guard.ts` (or `outbound-network.ts`), implement fetching that either (a) uses `redirect: 'manual'` and calls `resolveSafeFetchTarget` again for each `Location` before following, capping hops (e.g. 5); or (b) uses an undici `Agent` with a `connect` hook that rejects private/loopback/link-local IPs at socket time (defeats DNS rebinding). Prefer (b) if undici custom-connect is straightforward; otherwise (a).

**Verify**: `pnpm --filter @cradle/server typecheck` → exit 0

### Step 2: Switch link-preview to the safe fetch
Replace `fetchWithRetry(target.url, {redirect:'follow'})` with the guarded fetch.

**Verify**: `pnpm --filter @cradle/server test link-preview` → pass

### Step 3: Guard provider-catalog
Wrap the `baseUrl`-derived fetch in `catalog.ts` with `resolveSafeFetchTarget` / the guarded fetch. Add an opt-in allowlist env (e.g. `CRADLE_ALLOW_PRIVATE_PROVIDER_HOSTS`) for users who intentionally run LAN LLMs, defaulting to blocked.

**Verify**: `pnpm --filter @cradle/server test` → all pass

### Step 4: Tests
Add cases: redirect to a loopback address is blocked; direct private baseUrl is blocked by default and allowed when the allowlist env is set; public URL still works (mock DNS/fetch).

**Verify**: `pnpm --filter @cradle/server test ssrf` → pass

## Done criteria

- [ ] `pnpm --filter @cradle/server typecheck` exits 0
- [ ] `pnpm --filter @cradle/server test` exits 0; redirect + provider SSRF tests pass
- [ ] `grep -n "redirect: 'follow'" apps/server/src/modules/link-preview/service.ts` returns nothing
- [ ] `plans/README.md` status row updated

## STOP conditions

- undici custom-connect and manual-redirect both prove infeasible with the current fetch stack — STOP and report.
- Blocking private provider hosts breaks a documented supported LAN-LLM setup with no allowlist path — STOP and report.

## Maintenance notes

- Any new outbound-fetch feature reachable from request input must use this guarded fetch; consider a lint rule banning raw `fetch(` in modules that take user URLs.
- Reviewer: verify the hop cap and that error handling still degrades link-preview gracefully (it currently swallows to an empty card).
