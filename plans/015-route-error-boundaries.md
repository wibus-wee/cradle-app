# Plan 015 — Add route-level error boundaries

> **Executor instructions**: Follow step by step; verify each. Honor STOP conditions. Update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ac47f3b..HEAD -- apps/web/src/router.tsx apps/web/src/main.tsx apps/web/src/routes` — mismatch = STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED — error UI must match design system + i18n conventions.
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `ac47f3b`, 2026-07-05

## Why this matters

The router sets only `defaultPendingComponent`; a single `AppErrorBoundary` wraps the entire tree in `main.tsx`. A render/loader failure in one chat/workspace/kanban/diff route therefore unmounts the whole app shell (sidebar, surfaces, terminals) instead of isolating the failing pane — the only recovery is a full reload. Adding a router `defaultErrorComponent` plus boundaries around the heavy panes isolates failures.

## Current state

```5:10:apps/web/src/router.tsx
export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  defaultPreload: 'intent',
  defaultPendingComponent: () => null,
})
```

- `apps/web/src/main.tsx:75-77` — single `AppErrorBoundary` around the whole app.
- No `errorComponent` in any route module under `apps/web/src/routes` (grep confirms).
- Design-system + i18n conventions apply (see `CLAUDE.md`: use `cn()`, no dynamic Tailwind; user-visible strings via i18next).

## Commands you will need

| Purpose   | Command                          | Expected |
|-----------|----------------------------------|----------|
| Typecheck | `pnpm --filter @cradle/web typecheck` | exit 0 |
| Tests     | `pnpm --filter @cradle/web test` | pass     |

## Scope

**In scope**:
- `apps/web/src/router.tsx` — add `defaultErrorComponent`.
- A shared route-error component under `apps/web/src/components/common/` (with retry + back navigation), i18n strings included.
- Feature-scoped `errorComponent` on the heaviest routes: chat split workspace, browser panel host route, diff review, kanban.

**Out of scope**: the root `AppErrorBoundary` (keep as last resort); changing route data-loading.

## Steps

### Step 1: Shared route-error component
Create a `RouteErrorFallback` in `components/common/` following the design system (`cn()`, existing tokens) and i18n; show the error, a retry (router `invalidate`/reset), and a "back to home" action.

**Verify**: `pnpm --filter @cradle/web typecheck` → exit 0

### Step 2: Wire defaultErrorComponent
Set `defaultErrorComponent: RouteErrorFallback` in `createRouter`.

**Verify**: `pnpm --filter @cradle/web test` → pass

### Step 3: Scoped boundaries on heavy routes
Add `errorComponent` to the chat, browser, diff, and kanban route definitions so a failure there renders the fallback in-pane while the shell (sidebar/surfaces) stays mounted.

**Verify**: `pnpm --filter @cradle/web test` → pass

### Step 4: Test
Add a test that renders a route whose component throws and asserts the fallback renders (and the shell would remain) — model after an existing component test in `apps/web/src`.

**Verify**: `pnpm --filter @cradle/web test` → pass incl. new case

## Done criteria

- [ ] `pnpm --filter @cradle/web typecheck` exits 0
- [ ] `pnpm --filter @cradle/web test` passes incl. error-boundary test
- [ ] `router.tsx` has a `defaultErrorComponent`
- [ ] `plans/README.md` status row updated

## STOP conditions

- TanStack Router version in use doesn't support `defaultErrorComponent`/`errorComponent` as expected — STOP and report the version and API.

## Maintenance notes

- Reviewer: confirm the fallback uses i18n keys (no hardcoded English) and design tokens.
- New heavy routes should get a scoped `errorComponent` by default.
