# Plan 028 — Mirror dynamically-added plugin sources into the desktop-layer

> **Executor instructions**: Follow step by step; verify each. Honor STOP conditions. Update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 33c8725..HEAD -- apps/desktop/src/main/plugin-loader.ts apps/desktop/src/main/main-app.ts apps/desktop/src/preload/index.ts` — mismatch = STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW — additive IPC surface; reuses Plan 027's server-side installer/trust flow instead of duplicating fetch logic in the Electron main process.
- **Depends on**: 027 (persisted `pluginSources` registry + `GET /plugins/sources` + incremental server-side activation must exist first)
- **Category**: extensibility / distribution
- **Planned at**: commit `33c8725`, 2026-07-06

## Why this matters

Plan 027 makes server+web plugin layers live-reloadable without a restart. Desktop-layer (`cradle.desktop`) activation is architecturally separate: `activateDesktopPlugins()` runs once, in the Electron main process, **before** the server is even forked:

```587:594:apps/desktop/src/main/main-app.ts
    await activateDesktopPlugins()

    const serverUrl = await startServer()
```

```432:451:apps/desktop/src/main/plugin-loader.ts
/**
 * Discover and activate all desktop plugins.
 * Must be called BEFORE startServer() so shared config is available for the fork.
 */
export async function activateDesktopPlugins(): Promise<void> {
  const isDev = !!process.env.ELECTRON_RENDERER_URL
  const sources = createDesktopPluginSources(isDev)
  // ... one-shot loop over discovered manifests
```

The `pluginSources` DB table from Plan 027 lives inside the server's SQLite database, which does not exist yet at the point `activateDesktopPlugins()` runs. Without this plan, a plugin added through Plan 027's Settings UI would get its server/web layers activated live, but its desktop layer (if it declares `cradle.desktop`) would silently stay inactive until a full app restart — an inconsistent, confusing half-applied state. This plan closes that gap using the server's already-running HTTP API rather than duplicating the git/npm installer inside Electron main.

Also note: the server process itself has **no** IPC channel back to Electron main today. `spawnManagedProcess` (`apps/desktop/src/main/managed-process.ts`) forks a supervisor wrapper (`managed-process-runner.ts`) which itself forks/spawns the real server as a grandchild; the IPC channel Electron main holds is to the supervisor wrapper only (start/stop/exit status), not to the server's application code. This plan therefore does not add a push channel from server to desktop — it has the desktop main process pull the resolved source info from the server's existing HTTP API instead.

## Current state

- `apps/desktop/src/main/plugin-loader.ts:432-497` — `activateDesktopPlugins()` combines source discovery and a per-manifest activate loop into one function; the per-manifest body (`:472-495`, the `import()` + `validatePluginModule` + `activate(ctx)` + bookkeeping) needs to become a standalone reusable function so a single newly-added plugin can be activated without re-running discovery/activation for every other desktop plugin.
- `apps/desktop/src/main/plugin-loader.ts:263-309` — `createDesktopPluginSources()` is the desktop-side equivalent of the server's `getPluginDiscoverySources()`; it has no notion of server-persisted sources (nor should it fetch them directly — see Scope).
- `apps/desktop/src/preload/index.ts:198` / `apps/desktop/src/main/ipc-devtool.ts:32-40` — the established pattern for exposing a main-process capability to the renderer: `ipcMain.handle('<channel>', handler)` in main, `ipcRenderer.invoke('<channel>', ...)` wrapped by `contextBridge.exposeInMainWorld` in preload. New channels here should follow the existing `desktop:*` naming used for other desktop-owned bridges (e.g. `desktop:browser-*`).
- Plan 027 adds `GET /plugins/sources` (list, with each source's resolved plugin identity/packageDir) and `POST/DELETE /plugins/sources` on the server — this plan's main-process code calls those same routes as an HTTP client, exactly like `apps/web` already does, just from Electron main instead of the renderer.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Desktop typecheck | `pnpm --filter @cradle/desktop typecheck` | exit 0 |
| Desktop tests | `pnpm --filter @cradle/desktop test -- plugin-loader` | pass |
| Web typecheck (preload types consumed by renderer) | `pnpm --filter @cradle/web typecheck` | exit 0 |

## Scope

**In scope**:
- `apps/desktop/src/main/plugin-loader.ts` — extract `activateOneDesktopPlugin(manifest): Promise<void>` and `deactivateOneDesktopPlugin(pluginName): Promise<void>` from the existing loop bodies in `activateDesktopPlugins()`, reusing the exact same context-creation/validation/bookkeeping. `activateDesktopPlugins()` itself becomes a loop that calls these per manifest (no behavior change at cold boot).
- New `apps/desktop/src/main/plugin-source-sync.ts`: `syncDesktopLayerForSource(sourceId: string): Promise<void>` — calls the running server's `GET /plugins/sources/:id` (or the list route, filtered client-side, per whatever Plan 027 actually shipped) to get the resolved `packageDir` + manifest for that source, and if it declares `cradle.desktop`, calls `activateOneDesktopPlugin`. `unsyncDesktopLayerForSource(pluginName: string): Promise<void>` — calls `deactivateOneDesktopPlugin`. Both are no-ops if the source/plugin has no desktop entry.
- **Cold-boot catch-up**: after `startServer()` resolves (server ready), call a one-time `syncAllDesktopLayerSources()` that lists all persisted `pluginSources` from the now-running server and runs `syncDesktopLayerForSource` for each — this activates desktop layers for sources that were added in a previous session, without needing the DB to be reachable during the pre-fork `activateDesktopPlugins()` pass.
- New IPC channel pair, following the `desktop:*` convention (`apps/desktop/src/preload/index.ts:147-176`): `ipcMain.handle('desktop:plugins-sync-source', (event, sourceId) => syncDesktopLayerForSource(sourceId))` and `ipcMain.handle('desktop:plugins-unsync-source', (event, pluginName) => unsyncDesktopLayerForSource(pluginName))`, exposed on `window.cradle.plugins.syncSource(sourceId)` / `unsyncSource(pluginName)` in preload.
- `apps/web/src/features/settings/plugins-settings.tsx` (from Plan 027) — after a successful `POST /plugins/sources` or `DELETE /plugins/sources/:id`, additionally call `window.cradle?.plugins?.syncSource(...)`/`unsyncSource(...)` when running under Electron (guard on `window.cradle` presence so the same component still works in a plain browser/web-only deployment where there is no desktop layer to sync).

**Out of scope**:
- Any change to how the server resolves/installs `git`/`npm` sources — reused as-is from Plan 027.
- A push channel from the server process to Electron main — deliberately avoided per Current state.
- Sandboxing — deferred, unchanged from Plans 026/027.

## Steps

### Step 1: Extract reusable per-manifest desktop activation
Refactor `activateDesktopPlugins()` in `apps/desktop/src/main/plugin-loader.ts` into `activateOneDesktopPlugin(manifest)` + a thin loop, and add `deactivateOneDesktopPlugin(pluginName)` (mirroring `disposeSubscriptions`/`activePlugins` bookkeeping already in the file).

**Verify**: `pnpm --filter @cradle/desktop typecheck`; `pnpm --filter @cradle/desktop test -- plugin-loader` → cold-boot activation behavior unchanged.

### Step 2: Source sync against the running server
Add `apps/desktop/src/main/plugin-source-sync.ts` with `syncDesktopLayerForSource`, `unsyncDesktopLayerForSource`, `syncAllDesktopLayerSources`, calling the server's own HTTP base URL (however `apps/desktop/src/main` already resolves it for other desktop→server calls — reuse that, do not hardcode host/port).

**Verify**: `pnpm --filter @cradle/desktop typecheck`; unit test against a stubbed HTTP client.

### Step 3: Cold-boot catch-up
Call `syncAllDesktopLayerSources()` once `startServer()` resolves in `apps/desktop/src/main/main-app.ts`, after the existing boot sequence, non-blocking for app startup (log+continue on failure, do not fail app launch if this catch-up errors).

**Verify**: manual/desktop e2e smoke (`.github/workflows/e2e-smoke.yml` scope) plus a focused test if the boot sequence is testable in isolation.

### Step 4: IPC + preload bridge
Add the `desktop:plugins-sync-source` / `desktop:plugins-unsync-source` handlers and preload exposure per Scope.

**Verify**: `pnpm --filter @cradle/desktop typecheck`; preload type used by `apps/web` compiles (`pnpm --filter @cradle/web typecheck`).

### Step 5: Wire the Settings UI
Update `plugins-settings.tsx`'s add/remove-source mutations (from Plan 027) to also call the new preload bridge when present.

**Verify**: `pnpm --filter @cradle/web typecheck`; `pnpm --filter @cradle/web test -- plugins-settings`.

## Done criteria

- [ ] Adding a source with a `cradle.desktop` entry through Settings activates its desktop layer without an app restart (desktop build only)
- [ ] Removing such a source deactivates its desktop layer without an app restart
- [ ] A source added in a previous session (persisted, not yet desktop-synced) gets its desktop layer activated on the next cold boot, after the server becomes reachable
- [ ] Plain web/non-desktop deployments are unaffected (no `window.cradle` calls attempted)
- [ ] `pnpm --filter @cradle/desktop typecheck`, `pnpm --filter @cradle/desktop test`, `pnpm --filter @cradle/web typecheck` all exit 0
- [ ] `plans/README.md` status row updated

## STOP conditions

- Plan 027 shipped a materially different route/response shape for `GET /plugins/sources` than assumed here — STOP and adapt to the real shape rather than guessing.
- The server's base URL is not reliably resolvable from Electron main at the point `syncAllDesktopLayerSources()` needs to run (e.g. dynamic port allocation not yet surfaced to main) — STOP and use whatever existing desktop→server URL resolution mechanism the codebase already has; do not invent a second one.

## Maintenance notes

- This plan intentionally keeps "install/fetch" logic single-owned by the server (Plan 027); Electron main only ever *reads* resolved results over HTTP. If a future need arises for desktop-only plugin sources (no server involved at all), that is a different, larger design question and should get its own plan.
