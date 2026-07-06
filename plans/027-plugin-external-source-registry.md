# Plan 027 — Persisted, live-reloadable external plugin sources (server + web layers)

> **Executor instructions**: Follow step by step; verify each. Honor STOP conditions. Update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 33c8725..HEAD -- apps/server/src/plugins apps/server/src/modules/plugins packages/db/src/schema/plugin.ts apps/web/src/features/settings/plugins-settings.tsx` — mismatch = STOP.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MEDIUM — fetches and executes third-party code without a sandbox (accepted risk per current decision); mitigated entirely by the existing Plan 008 checksum trust-grant gate, which this plan must not bypass.
- **Depends on**: 026 (naming/repo openness makes arbitrary git/npm sources meaningful; this plan works even if 026 hasn't landed, but is much more useful once it has)
- **Category**: extensibility / distribution
- **Planned at**: commit `33c8725`, 2026-07-06

## Why this matters

Today the *only* way to add a new plugin source is `CRADLE_EXTERNAL_PLUGINS_DIRS`/`CRADLE_PLUGINS_DIR` (environment variables) plus a full process restart:

```92:114:apps/server/src/plugins/loader.ts
function getPluginDiscoverySources(defaultPluginsDir: string): PluginDiscoverySource[] {
  const marketplacePluginsDir = readMarketplacePluginsDir()
  const externalDirs = (process.env.CRADLE_EXTERNAL_PLUGINS_DIRS ?? '')
    .split(delimiter)
    .map(dir => dir.trim())
    .filter(Boolean)
  // ...
  addSource(defaultPluginsDir, readPrimaryPluginSourceKind())
  for (const pluginsDir of externalDirs) {
    addSource(pluginsDir, 'externalLocal')
  }
  return sources
}
```

```332:337:apps/server/src/plugins/loader.ts
export async function activateServerPlugins(app: Elysia): Promise<void> {
  for (const pluginName of [...activePlugins.keys()]) {
    await deactivatePluginServerLayer(pluginName)
  }
  resetPluginSkillRegistry()
  discoveredPluginManifests.clear()
  // full rediscovery of every source, every time
```

`apps/web/src/features/settings/plugins-settings.tsx` only lists and toggles plugins that were already discovered at boot — there is no "add a plugin from a folder / git repo / npm package" affordance anywhere in the product. This plan adds a persisted source registry, a fetch-and-cache installer for `git`/`npm` sources, and an incremental (no-restart) discovery+activation path, wired into a small Settings UI addition. It deliberately reuses the existing trust/permission machinery rather than inventing a new one: any package pulled in through this plan is classified `externalLocal` by `classifyPluginSource` (`apps/server/src/plugins/runtime-registry.ts:40-64`) exactly like today's env-var-configured directories, so Plan 008's checksum-bound operator grant (`apps/server/src/plugins/trust-policy.ts`, `apps/server/src/plugins/trust-grants.ts`) still gates activation. No sandboxing is added — that is a separate, explicitly deferred decision.

This plan covers **server + web** layers only. Desktop-layer (`cradle.desktop`) live activation for dynamically-added sources is Plan 028.

## Current state

- `packages/db/src/schema/plugin.ts` — existing plugin-owned tables (`pluginStorageEntries`, `pluginActivationPolicies`) live here; this is where the new table belongs.
- `packages/db/src/schema/trust-grant.ts` — the reusable `trust_grants` table (`subjectType: 'plugin_package'`) that already gates `externalLocal` activation; unchanged, just consumed as-is.
- `apps/server/src/plugins/discovery.ts:26-69` — `discoverPluginPackages(pluginsDir)` reads a directory of package subfolders. This is reused unchanged for `localPath` sources and for the extracted cache directory produced by `git`/`npm` sources.
- `apps/server/src/plugins/loader.ts:332-428` — `activateServerPlugins()` is a full teardown-then-rediscover-everything pass; there is no "activate just this one new source" entry point today. `enablePlugin`/`disablePlugin` (`:473-518`) show the pattern for touching a *single* already-known plugin without a full pass — the new incremental-discovery function follows the same shape but starts from "not yet discovered at all."
- `apps/desktop/src/main/plugin-install-links.ts:244-282` — `downloadTarball` + `extractPluginPath` is the existing GitHub-tarball-to-directory logic, currently desktop-only and scoped to the marketplace deep-link flow. This plan needs an equivalent for the server process (which already depends on `tar` — `apps/server/package.json:90` — so no new dependency is required for the `git` installer kind).
- `apps/server/src/modules/plugins/index.ts` and `model.ts` — current HTTP surface is list/get/icon/enable-toggle only; no mutation of *which* sources are discovered.
- `apps/web/src/features/settings/plugins-settings.tsx` — list + enable/disable UI only; no "add source" form.
- `apps/server/src/config/server-config.ts` / `apps/server/src/infra.ts` — where `CRADLE_DATA_DIR` is read today; the new source cache directory should live under it (e.g. `<CRADLE_DATA_DIR>/plugin-sources-cache/<sourceId>`), not under the plugin discovery dir itself.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| DB schema check | `pnpm --filter @cradle/db typecheck` | exit 0 |
| Generate migration | `pnpm --filter @cradle/db generate` (or the repo's actual drizzle-kit script — confirm exact script name before running) | new migration file under `packages/db` |
| Server typecheck | `pnpm --filter @cradle/server typecheck` | exit 0 |
| Server tests | `pnpm --filter @cradle/server test -- src/plugins src/modules/plugins` | all pass |
| Web typecheck | `pnpm --filter @cradle/web typecheck` | exit 0 |
| Web tests | `pnpm --filter @cradle/web test -- plugins-settings` | pass |
| Full server suite | `pnpm --filter @cradle/server test` | exit 0 |

## Scope

**In scope**:
- New Drizzle table `pluginSources` in `packages/db/src/schema/plugin.ts`: `id`, `kind` (`'localPath' | 'git' | 'npm'`), `location` (path / `owner/repo` / npm package name), `ref` (nullable — git ref or npm version/tag), `subPath` (nullable — subdirectory within the fetched repo, mirrors today's marketplace `path` param), `label` (nullable), `addedReason`, `+ timestamps()`. Generate and apply the migration.
- `apps/server/src/plugins/source-installer.ts` (new): `resolvePluginSourceDirectory(source): Promise<string>` —
  - `localPath`: returns the given absolute path as-is (equivalent to today's `CRADLE_EXTERNAL_PLUGINS_DIRS` entry, just persisted).
  - `git`: downloads a GitHub tarball for `location`@`ref` (default branch if `ref` unset) using the same tarball-URL + `tar.x` extraction approach as `apps/desktop/src/main/plugin-install-links.ts:239-282`, generalized to any `owner/repo` (consistent with Plan 026) and an optional `subPath`, into `<CRADLE_DATA_DIR>/plugin-sources-cache/<sha256(kind+location+ref+subPath)>`. Re-fetches are idempotent (delete-and-recreate the cache dir, same staging-then-publish rename pattern as `publishPluginInstall`).
  - `npm`: resolves `location`@`ref` (version/tag, default `latest`) via a subprocess `npm pack <location>@<ref> --pack-destination <tmp>` (do not hand-roll registry tarball URL/auth resolution), then extracts into the same cache-dir scheme.
  - All three paths end with a discovery pass (`discoverPluginPackages`) on the resulting directory so a source that fans out to multiple plugin packages (e.g. a monorepo-style `git` source) is handled the same way `plugins/` already is.
- `apps/server/src/plugins/loader.ts`:
  - `getPluginDiscoverySources()` additionally reads persisted `pluginSources` rows (each mapped to a `PluginDiscoverySource` with `kind: 'externalLocal'` and `pluginsDir` = the resolved cache/local directory) alongside the existing env-var-derived sources — additive, not a replacement.
  - New exported `discoverAndActivateSource(sourceId): Promise<PluginDescriptor[]>` — resolves that one source's directory, discovers packages in it, registers descriptors, and runs the same per-manifest activation path already used by `enablePlugin`/`preparePluginWebLayer`/`activatePluginServerLayer`, **without** deactivating or re-discovering any other already-active plugin. This is the "no restart" primitive the API layer calls.
  - New exported `removeDiscoveredSource(sourceId): Promise<void>` — deactivates every plugin whose `packageDir` is under that source's resolved directory (reuse `deactivatePluginServerLayer`), removes their descriptors, and (for `git`/`npm` kinds) deletes the cache directory.
- `apps/server/src/modules/plugins/` — new routes: `GET /plugins/sources` (list persisted sources + their resolved plugin identities), `POST /plugins/sources` (body: `kind`, `location`, `ref?`, `subPath?`, `label?` → persists row, calls `discoverAndActivateSource`, returns the source plus any newly discovered `PluginDescriptor`s or discovery errors), `DELETE /plugins/sources/:id` (calls `removeDiscoveredSource`). Reuse the existing `x-cradle-cli` convention on each route.
- `apps/web/src/features/settings/plugins-settings.tsx` — add an "Add source" affordance (kind selector, location input, optional ref/subPath/label) and a small "Sources" list with a remove action, wired to the new generated API client functions (regenerate the OpenAPI client per the repo's existing codegen step before wiring the UI).
- Newly discovered packages still land as `externalLocal` and are **disabled until the operator explicitly enables them** (existing `refreshPluginActivationState`/`enablePlugin` flow, which is also where the Plan 008 checksum trust grant gets recorded) — no behavior change here, just confirm it and add a test that a freshly-added source's plugin is disabled-by-default and requires the existing enable+grant flow before its server layer activates.

**Out of scope**:
- Desktop-layer (`cradle.desktop`) live activation for a dynamically-added source — Plan 028.
- Any sandboxing/process isolation for `activate()` — explicitly deferred.
- Auto-refresh/polling of `git`/`npm` sources for upstream updates — this plan only supports an explicit rescan action if trivial to add (`POST /plugins/sources/:id/rescan` re-running the installer + `discoverAndActivateSource`); do not build a background poller.
- Changing how `CRADLE_EXTERNAL_PLUGINS_DIRS`/`CRADLE_PLUGINS_DIR` behave — they remain supported unchanged, additive to the new persisted sources.

## Steps

### Step 1: Schema + migration
Add `pluginSources` to `packages/db/src/schema/plugin.ts` following the existing `pluginActivationPolicies` shape (see `packages/db/src/schema/plugin.ts:17-25`). Generate and review the migration.

**Verify**: `pnpm --filter @cradle/db typecheck` → exit 0; migration file reviewed for correctness.

### Step 2: Source installer
Add `apps/server/src/plugins/source-installer.ts` with `resolvePluginSourceDirectory` per Scope. Extract the tarball download/extract helpers into a shared location if that avoids duplicating `apps/desktop/src/main/plugin-install-links.ts` logic (check whether desktop can import a server-owned helper, or whether the logic must be duplicated because desktop and server are separate deployable processes — if duplication is required, keep both copies deliberately small and note the duplication in Maintenance notes rather than building a cross-process shared package for two call sites).

**Verify**: `pnpm --filter @cradle/server typecheck` → exit 0; unit tests for each `kind` against a local fixture (git kind can be tested against a local tarball fixture instead of hitting real GitHub, npm kind against a stubbed `npm pack` subprocess).

### Step 3: Incremental discovery/activation in the loader
Add `discoverAndActivateSource` and `removeDiscoveredSource` to `apps/server/src/plugins/loader.ts`, wire persisted sources into `getPluginDiscoverySources`.

**Verify**: `pnpm --filter @cradle/server test -- src/plugins/loader` → pass, including a new test that adding a source does not deactivate or re-activate unrelated already-active plugins.

### Step 4: HTTP routes
Add `GET/POST /plugins/sources`, `DELETE /plugins/sources/:id` to `apps/server/src/modules/plugins/`, with TypeBox models in `model.ts` and service functions in `service.ts` (mirroring the existing `listPlugins`/`setPluginEnabled` pattern).

**Verify**: `pnpm --filter @cradle/server test -- src/modules/plugins` → pass.

### Step 5: Settings UI
Regenerate the API client, then extend `plugins-settings.tsx` with the add/remove-source UI per Scope, following existing component conventions in that file (React Query mutations + optimistic cache updates, same as the current enable/disable toggle).

**Verify**: `pnpm --filter @cradle/web typecheck` → exit 0; `pnpm --filter @cradle/web test -- plugins-settings` → pass.

### Step 6: End-to-end default-disabled check
Add a test (server-side integration test is sufficient) proving: adding a `localPath` source pointing at a fixture plugin package results in a discovered-but-disabled descriptor; enabling it goes through the existing checksum trust-grant path from Plan 008 and only then activates the server layer.

**Verify**: `pnpm --filter @cradle/server test` → exit 0 (full suite).

## Done criteria

- [ ] `pluginSources` table exists with a reviewed migration
- [ ] `resolvePluginSourceDirectory` works for `localPath`, `git`, `npm` with tests (network-free for `git`/`npm` via fixtures/mocks)
- [ ] Adding a source via `POST /plugins/sources` discovers and registers its plugin(s) without disturbing already-active plugins, and without requiring a process restart
- [ ] Removing a source via `DELETE /plugins/sources/:id` deactivates and de-registers its plugin(s) and cleans up any cache directory
- [ ] Newly discovered plugins remain `externalLocal` + disabled-by-default and still require the Plan 008 checksum trust grant before their server layer runs
- [ ] Settings UI can add and remove a source without the user touching an environment variable or restarting anything
- [ ] `pnpm --filter @cradle/server test`, `pnpm --filter @cradle/web test`, both typechecks exit 0
- [ ] `plans/README.md` status row updated

## STOP conditions

- `CRADLE_DATA_DIR` is not reliably available in every deployment shape (e.g. some non-desktop server deployment) — STOP and confirm the cache-root fallback before writing files to an assumed path.
- The repo's actual drizzle migration script name/flow differs from `pnpm --filter @cradle/db generate` — STOP and use the real command; do not guess and run something destructive.
- Extracting the tarball helpers into a shared cross-process module would require restructuring `apps/desktop` ↔ `apps/server` package boundaries beyond a small helper — STOP, keep the two implementations separate, and note the duplication instead of forcing a shared package.

## Maintenance notes

- Follow-up (deferred, separate plan): sandboxed `activate()` execution. Until then, every source added through this plan carries the same full-in-process-trust risk as today's `CRADLE_EXTERNAL_PLUGINS_DIRS`; the only gate is the Plan 008 checksum-bound operator grant. Do not add UI copy that implies stronger isolation than actually exists.
- Follow-up: Plan 028 mirrors newly-added sources into the desktop process so `cradle.desktop` layers activate live too, without a full app restart.
- Follow-up (optional, not required for this plan's Done criteria): background rescan/update-check for `git`/`npm` sources.
