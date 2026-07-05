# Plan 008 — Harden server plugin loading (provenance + confirmation)

> **Executor instructions**: Follow step by step; verify each. Honor STOP conditions. Update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ac47f3b..HEAD -- apps/server/src/plugins` — mismatch = STOP.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: HIGH — plugins are a first-class extension point; over-restricting breaks the marketplace/dev flow.
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `ac47f3b`, 2026-07-05

## Why this matters

Server plugins are loaded with `await import(entryPath)` and their `activate(ctx)` is called with full server privileges (DB, filesystem, subprocess, network). Validation only checks that `activate`/`deactivate` are functions — there is no signature/provenance verification and no sandbox. `CRADLE_EXTERNAL_PLUGINS_DIRS` loads arbitrary local paths as `externalLocal`. A malicious or compromised plugin executes with full privileges on activation. This is especially dangerous once the server is relay-exposed. This plan adds provenance gating and user confirmation for untrusted sources; a full worker sandbox is a follow-up.

## Current state

- `apps/server/src/plugins/loader.ts:236-249` — dynamic import + activate:

```236:249:apps/server/src/plugins/loader.ts
  const entryPath = resolve(manifest.packageDir, manifest.cradle.server)
  let subscriptions: Disposable[] = []
  try {
    setPluginLayerState(manifest.name, 'server', 'activating')
    const mod = await import(pathToFileURL(entryPath).href)
    validatePluginModule(mod, manifest.name, 'server')

    const ctx = createServerPluginContext(manifest, { routeSegment: descriptor.routeSegment })
    subscriptions = ctx.subscriptions
    await mod.activate(ctx)
```

- `apps/server/src/plugins/loader.ts:100-109` — sources: `defaultPluginsDir` (primary), `marketplacePluginsDir` (`trustMarketplaceGrants: true`), and `externalLocal` from env dirs. There is already a `trustMarketplaceGrants` concept and a permission model (`permissionDecision.missingRequiredPermissions` at `:230-234`) — build on it.
- `apps/server/src/plugins/validation.ts:18-33` — only shape validation.

## Commands you will need

| Purpose   | Command                                  | Expected |
|-----------|------------------------------------------|----------|
| Typecheck | `pnpm --filter @cradle/server typecheck` | exit 0   |
| Tests     | `pnpm --filter @cradle/server test`      | all pass (`loader.test.ts` exists) |

## Scope

**In scope**:
- `apps/server/src/plugins/loader.ts` — before activation, classify trust by source; require explicit user confirmation (a stored grant) for `externalLocal` plugins; refuse to auto-activate untrusted plugins when the server is relay-exposed.
- `apps/server/src/plugins/validation.ts` — add optional signature/checksum verification for marketplace packages.
- `apps/server/src/plugins/loader.test.ts` (extend).

**Out of scope**:
- Running `activate` inside an isolated worker/VM — larger follow-up (note in maintenance). This plan gates *which* plugins run, not *how* they run.

## Steps

### Step 1: Trust classification + grant store
Add a per-plugin trust decision: `primary`/`marketplace` = trusted; `externalLocal` = requires a stored user grant (keyed by plugin name + checksum). Read/write grants via preferences or a dedicated table.

**Verify**: `pnpm --filter @cradle/server typecheck` → exit 0

### Step 2: Block untrusted auto-activation
In the activation path, skip activation (with a recorded, surfaced reason) for `externalLocal` plugins lacking a grant, and unconditionally when the server is relay-exposed (check the relay/auth config).

**Verify**: `pnpm --filter @cradle/server test loader` → pass

### Step 3: Marketplace integrity
For marketplace packages, verify a checksum/signature (if the marketplace provides one) before import; refuse on mismatch.

**Verify**: `pnpm --filter @cradle/server test loader` → pass

### Step 4: Tests
externalLocal without grant is not activated; with grant is activated; relay-exposed mode blocks externalLocal; marketplace checksum mismatch refuses load.

**Verify**: `pnpm --filter @cradle/server test loader` → pass

## Done criteria

- [ ] `pnpm --filter @cradle/server typecheck` exits 0
- [ ] `pnpm --filter @cradle/server test` exits 0; new gating tests pass
- [ ] externalLocal plugins do not activate without an explicit grant
- [ ] `plans/README.md` status row updated

## STOP conditions

- The dev workflow depends on `externalLocal` auto-activation with no UI to grant trust — STOP and report; a grant UX must be designed first.
- No signature/checksum is available from the marketplace — implement grant-based trust only and note the gap; do not fabricate a verification scheme.

## Maintenance notes

- Follow-up (deferred): sandbox `activate` in a worker with a capability-scoped context.
- Reviewer: confirm trusted first-party plugins still load with zero friction.
