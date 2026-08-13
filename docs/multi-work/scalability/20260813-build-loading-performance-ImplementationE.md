# Build and loading performance — Implementation E

## Scope

Reviewed and completed ExecPlan findings #13 (CI artifact DAG / single server-test owner) and #15 (web and landing lazy loading with intent preloading). This slice does not include the concurrent desktop runtime, pagination, mobile, CLI, Streamdown, or generated-content changes in the shared worktree.

## Decisions and fixes

- Kept the server Vitest project in the root config. CI selects `node` and `apps/web` explicitly while `server-tests` is the sole CI owner; removing the project would have silently changed local root `pnpm test` coverage.
- Kept the shared SDK/plugin artifact producer and target matrices, but restored the complete desktop build prerequisites. The desktop matrix branch consumes downloaded plugin artifacts, builds the server bundle/runtime, prepares desktop plugins, builds CLI/mac bridge/Sparkle, then runs Electron Vite. A bare `electron-vite build` omitted required packaged resources.
- Preserved only the stable React framework manual chunk and let dynamic imports define feature chunks.
- Added intent preloading without returning deferred code to the initial graph: settings navigation preloads on pointer enter/focus/down, landing Blog/Changelog links do the same, and the What's New popup preloads its shader/Markdown renderers during the existing 2.5 second appearance delay.
- Shared the settings server-endpoint loader between its two aliases and swallow speculative preload failures so a rejected hover preload cannot create an unhandled rejection; React's actual render remains the error-reporting owner.

## Exact files

- `.github/workflows/ci.yml`
- `vitest.config.ts`
- `apps/web/vite.config.ts`
- `apps/web/src/features/changelog/whats-new-popup.tsx`
- `apps/web/src/features/settings/settings-content.tsx`
- `apps/web/src/features/settings/settings-section-loaders.ts`
- `apps/web/src/features/settings/settings-sidebar.tsx`
- `apps/web/src/features/settings/settings-sidebar-view.tsx`
- `apps/landing/src/app.tsx`
- `apps/landing/src/components/nav.tsx`
- `apps/landing/src/lazy-routes.ts`
- `docs/multi-work/scalability/20260813-build-loading-performance-ImplementationE.md`

## Validation

- `pnpm --filter @cradle/web exec tsc --noEmit` — passed.
- `pnpm --filter @cradle/landing exec tsc --noEmit` — passed.
- Focused ESLint across the files above (excluding YAML) — passed.
- `pnpm --filter @cradle/web exec vite build` — passed; artifact listing shows individual settings chunks including `appearance-settings`, `agent-runtime-settings`, `chronicle-settings`, `mcp-servers-settings`, and others.
- `pnpm --filter @cradle/landing exec vite build` — passed; output includes independent `blog`, `blog-post`, and `changelog` chunks, while the HTML module preloads only framework/animation/icon chunks.
- `pnpm exec vitest list --project node --project apps/web --passWithNoTests` — passed and lists only the two intended CI owners, not server tests.
- `pnpm --filter @cradle/server exec vitest list --passWithNoTests` — discovered the server suite through the package-owned config (the listing was interrupted after discovery because it is very large).
- `git diff --check` on all scoped files — passed.

## Risks and follow-up

- The GitHub Actions workflow was validated structurally and through its constituent local commands/builds, but the complete hosted matrix was not run locally. In particular, Electron native runtime rebuilding remains runner/platform-sensitive.
- Dynamic import failures still require the app's existing error boundary/reload recovery. Speculative preload failures are intentionally ignored so a later render can retry/report normally.
- Web production output remains large because of provider icon and editor/runtime assets; this slice verifies feature boundaries rather than setting a global bundle budget.

## Commit

Implementation commit: `44ed2448` (`perf(build): split inactive feature graphs`).
