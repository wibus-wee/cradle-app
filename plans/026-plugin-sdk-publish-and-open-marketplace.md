# Plan 026 — Publish `@cradle/plugin-sdk` and open marketplace install to any repo/package

> **Executor instructions**: Follow step by step; verify each. Honor STOP conditions. Update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 33c8725..HEAD -- packages/plugin-sdk apps/desktop/src/main/plugin-install-links.ts` — mismatch = STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MEDIUM — narrows an allowlist that currently blocks all third-party plugin code from installing through the deep-link flow; the checksum/consent gates that make this safe already exist and must not be weakened.
- **Depends on**: none
- **Category**: extensibility / distribution
- **Planned at**: commit `33c8725`, 2026-07-06

## Why this matters

Cradle already has a mature 3-layer plugin system (`packages/plugin-sdk/DEVELOPERS.md`), but two hard walls stop anyone outside the Cradle team from freely building and distributing a plugin:

1. `@cradle/plugin-sdk` is `"private": true` and its `exports` point straight at TypeScript source (`packages/plugin-sdk/package.json:1-15`). Nothing outside this monorepo can `npm install` it with types; third parties can only write a plugin by cloning/forking Cradle itself.
2. The only "install from anywhere" path — `cradle://plugins/install` — hardcodes a single trusted repository and a single package namespace:

```107:133:apps/desktop/src/main/plugin-install-links.ts
function validateGitHubRepository(repository: string): void {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    throw new PluginInstallLinkError('GitHub repository must use owner/name syntax')
  }
  if (repository !== FIRST_PARTY_REPOSITORY) {
    throw new PluginInstallLinkError(`Unsupported plugin repository: ${repository}`)
  }
}

function validatePluginPath(path: string): void {
  if (!path.startsWith('plugins/')) {
    throw new PluginInstallLinkError('Plugin path must live under plugins/')
  }
  // ...
}

function validatePluginPackageName(packageName: string): void {
  if (!/^@cradle\/[a-z0-9][a-z0-9._-]*$/.test(packageName)) {
    throw new PluginInstallLinkError('Plugin package must use the @cradle/* namespace')
  }
}
```

The user has decided: publish the SDK to npm, and open the install path to arbitrary GitHub repos. Sandboxing is explicitly deferred (separate decision) — this plan does not touch execution trust; it only removes distribution-identity restrictions. The existing safety net (checksum-bound trust grant from Plan 008, `apps/server/src/plugins/trust-policy.ts:32-89`, and the install-time `confirmInstall` consent callback in `apps/desktop/src/main/plugin-install-links.ts:418-423`) is unchanged and remains the thing standing between "arbitrary repo" and "arbitrary code execution."

## Current state

- `packages/plugin-sdk/package.json` — private, no build step, `exports` map straight to `src/*.ts`. Consumers (`plugins/*`, `apps/server`, `apps/web`, `apps/desktop`) all use `"@cradle/plugin-sdk": "workspace:*"`.
- `apps/desktop/src/main/plugin-install-links.ts:31` — `FIRST_PARTY_REPOSITORY = 'wibus-wee/cradle-app'`, the sole allowed repo.
- `apps/desktop/src/main/plugin-install-links.ts:116-127` — `validatePluginPath` requires the `plugins/` prefix, an artifact of Cradle's own monorepo layout that a third-party repo (where the plugin usually lives at the repo root) will not have.
- Route segment derivation already anticipates non-`@cradle` scoped packages (`DEVELOPERS.md:199-211`): `@external/tool → scope-external--tool`. The naming generalization only needs to happen at the installer/validation layer, not in the descriptor/routing layer.
- No npm publish workflow exists today (`.github/workflows/` has `deploy-web.yml`, `e2e-*.yml`, `release-desktop.yml`, `verify-windows-desktop-package.yml` — none publish npm packages).
- `apps/server/src/plugins/sdk-contract-boundary.test.ts` and sibling `*-boundary.test.ts` files pin the SDK's public export surface — any package.json/export path change must keep these passing or be updated deliberately, not incidentally.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| SDK typecheck | `pnpm --filter @cradle/plugin-sdk typecheck` | exit 0 |
| Server typecheck | `pnpm --filter @cradle/server typecheck` | exit 0 |
| Desktop typecheck | `pnpm --filter @cradle/desktop typecheck` | exit 0 |
| Boundary + install-link tests | `pnpm --filter @cradle/server test -- src/plugins` and `pnpm --filter @cradle/desktop test -- plugin-install-links` | all pass |
| Full server test | `pnpm --filter @cradle/server test` | exit 0 |

## Scope

**In scope**:
- `packages/plugin-sdk` — add a real build (emit `dist/*.js` + `.d.ts` per entry point: index, server, web, desktop, permissions, manifest, vite-plugin-import-map), point `package.json#exports`/`main`/`types` at `dist/`, remove `"private": true`, add `publishConfig` if npm scoped-package public access needs it, bump version (e.g. `0.1.0` → `0.2.0` since the export target changes). Internal consumers keep `workspace:*` — pnpm workspace resolution is unaffected by publishing.
- `apps/desktop/src/main/plugin-install-links.ts` — relax `validateGitHubRepository` to accept any well-formed `owner/repo` (drop the `FIRST_PARTY_REPOSITORY` equality check, keep the syntax regex). Relax `validatePluginPath` to accept a normalized relative path that may be empty/`.` (repo root) instead of requiring the `plugins/` prefix. Relax `validatePluginPackageName` to accept any syntactically valid npm package name (scoped or unscoped), not just `@cradle/*`.
- Update/add tests in `apps/desktop/src/main/plugin-install-links.test.ts` covering: arbitrary `owner/repo` accepted, non-`@cradle` scoped and unscoped package names accepted, repo-root path (no `plugins/` prefix) accepted, still-rejected malformed inputs (path traversal, non-semver version, bad repo syntax) unchanged.
- Update `packages/plugin-sdk/DEVELOPERS.md` to describe the npm-installable SDK and the opened install path (drop the "@cradle/*-only" wording).

**Out of scope**:
- The docs-site marketplace catalog (`documentations/lib/plugin-marketplace.ts`) — remains a hand-curated first-party list; this plan does not add a public "submit your plugin" catalog experience. Anyone can already construct a `cradle://plugins/install` link once the allowlist is open; catalog curation is a separate content/product decision.
- Any change to the trust/permission/checksum-grant model — reused as-is.
- Sandboxing/execution isolation — explicitly deferred.
- The "add a source without a deep link, from Settings, without restart" flow — that is Plan 027.
- Setting up CI to auto-publish on release — note the gap in Done criteria but do not build a release pipeline unless it is trivially available (check for an existing `changesets`/`np`-style setup first; if none exists, a manual `npm publish` from `packages/plugin-sdk` is an acceptable interim state — record this in Maintenance notes, do not invent a bespoke pipeline).

## Steps

### Step 1: Make the SDK buildable and publish-ready
Add a build script to `packages/plugin-sdk/package.json` (reuse whatever the repo's other publishable-shaped packages use, e.g. `tsc -p tsconfig.build.json` or `tsdown` if already used elsewhere in the monorepo — check `packages/*/package.json` for precedent before introducing a new tool). Emit `.js` + `.d.ts` for every current entry point. Point `exports`, `main`, `types` at the built output. Remove `"private": true`. Keep `peerDependencies`/`dependencies` as-is.

**Verify**: `pnpm --filter @cradle/plugin-sdk typecheck` → exit 0; `pnpm --filter @cradle/plugin-sdk build` → produces `dist/` with all entry points.

### Step 2: Confirm internal consumers are unaffected
Run typecheck across the workspaces that import the SDK to confirm `workspace:*` resolution still works against the new package shape (pnpm should resolve to the package's `exports`, which now point at `dist/`, so a build step must run before those workspaces typecheck in CI — check the root `package.json` build ordering / turbo-less pnpm scripts and wire the SDK build in if needed).

**Verify**: `pnpm --filter @cradle/server typecheck`, `pnpm --filter @cradle/web typecheck`, `pnpm --filter @cradle/desktop typecheck` → all exit 0.

### Step 3: Open the marketplace install allowlists
Edit `validateGitHubRepository`, `validatePluginPath`, `validatePluginPackageName` in `apps/desktop/src/main/plugin-install-links.ts` per Scope. Do not touch `validatePluginVersion`, `validateGitHubRef`, checksum verification, or the `confirmInstall` consent gate.

**Verify**: `pnpm --filter @cradle/desktop test -- plugin-install-links` → pass.

### Step 4: Tests for the opened allowlists
Add cases: third-party `owner/repo`, unscoped package name, `@acme/tool`-style scoped name, empty/`.` path (repo root), still-rejected traversal/malformed inputs.

**Verify**: `pnpm --filter @cradle/desktop test -- plugin-install-links` → pass.

### Step 5: Update docs
`packages/plugin-sdk/DEVELOPERS.md` — update package naming guidance (§3) and the marketplace-adjacent notes to reflect that plugins may use any valid package name and live in any GitHub repo, while keeping the operator trust-grant requirement for anything that isn't `workspaceDev`/`bundledResource`.

## Done criteria

- [ ] `pnpm --filter @cradle/plugin-sdk build` produces a publishable `dist/`; `package.json` is not `private`
- [ ] `pnpm --filter @cradle/server typecheck`, `pnpm --filter @cradle/web typecheck`, `pnpm --filter @cradle/desktop typecheck` all exit 0
- [ ] `pnpm --filter @cradle/desktop test -- plugin-install-links` passes, including new arbitrary-repo/arbitrary-name/repo-root cases
- [ ] `pnpm --filter @cradle/server test` exits 0 (boundary tests unaffected or deliberately updated)
- [ ] `DEVELOPERS.md` no longer states the `@cradle/*`-only / single-repo restriction
- [ ] `plans/README.md` status row updated; note whether npm publish was actually executed or is left as a manual follow-up

## STOP conditions

- No build tool precedent exists anywhere in the monorepo for a source-exports → dist-exports package — STOP and ask before introducing a new bundler dependency.
- Opening `validatePluginPackageName` would collide with route-segment derivation for some real package name shape not covered by the existing `@external/tool → scope-external--tool` encoding — STOP and report the collision case; do not hand-roll a new encoding scheme without checking `derivePluginRouteSegment` first.
- Publishing actually requires npm org/scope credentials that are not available in this environment — implement everything up to `npm publish --dry-run` succeeding, and record the manual publish step as a STOP/follow-up rather than fabricating credentials or a CI secret.

## Maintenance notes

- Follow-up (not in scope here): a real "browse third-party plugins" surface and/or an npm-publish CI workflow.
- This plan intentionally does not change who is trusted to *run* — only who is allowed to be *named/fetched*. Plan 027 is the piece that lets a user register such a source without a deep link and without a restart; Plan 008's checksum-grant gate still decides whether the fetched code actually activates.
