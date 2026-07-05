# Plan 018 — Code-split heavy panels and routes

> **Executor instructions**: Follow step by step; verify each. Honor STOP conditions. Update `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat ac47f3b..HEAD -- apps/web/src/features/settings apps/web/src/routes apps/web/src/styles.css apps/web/src/features/workspace/workspace-file-editor.tsx apps/web/vite.config.ts` — mismatch = STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW — lazy-loading with Suspense; verify no FOUC/regression on first open.
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `ac47f3b`, 2026-07-05

## Why this matters

Several heavy dependencies load eagerly even when the feature is not in use: all ~18 settings panels are statically imported in one barrel (pulling chronicle ~2790 lines, integrations ~1953 lines into one chunk); the chat route statically imports the dockview split workspace even for single-pane chats; xterm CSS is in the global stylesheet; monaco is statically imported in the workspace file editor; the diff route eagerly pulls the Pierre worker stack. Each inflates cold-start/first-open cost. The codebase already lazy-loads some routes (`/automation`, `/usage`) and the browser panel — this plan extends that pattern to the remaining offenders.

## Current state (per audit — confirm each before editing)

- `apps/web/src/features/settings/settings-content.tsx:1-22` — static imports of all panels; only `ActiveSection` renders (`:54-68`).
- `apps/web/src/routes/chat/$sessionId.tsx:3-11` — static import of `ChatSplitWorkspace`; split UI only needed when pane count > 1 (`chat-split-workspace.tsx:33-39`).
- `apps/web/src/styles.css:4` — `@import "@xterm/xterm/css/xterm.css"` global; terminal views are already lazy.
- `apps/web/src/features/workspace/workspace-file-editor.tsx:1` — top-level `import Editor from '@monaco-editor/react'`.
- `apps/web/src/routes/diff.tsx:3,28-29` — static import of `DiffHomePage` (pulls `@pierre/diffs/react`).
- Lazy-loading reference: `apps/web/src/components/layout/app-layout.tsx:56-59` (browser panel is `lazy(() => import(...))`).

## Commands you will need

| Purpose   | Command                          | Expected |
|-----------|----------------------------------|----------|
| Typecheck | `pnpm --filter @cradle/web typecheck` | exit 0 |
| Build     | `pnpm --filter @cradle/web build`| succeeds; chunks emitted |
| Tests     | `pnpm --filter @cradle/web test` | pass     |

## Scope

**In scope**:
- `settings-content.tsx` — `React.lazy` per section keyed by `SECTION_MAP`, wrapped in `Suspense` with a skeleton.
- `routes/chat/$sessionId.tsx` — lazy dockview; render flat single-pane path without dockview when pane count is 1.
- `styles.css` + terminal shell components — move xterm CSS import into the terminal chunk.
- `workspace-file-editor.tsx` — wrap `WorkspaceFileEditor` in `React.lazy` with a skeleton.
- `routes/diff.tsx` — lazy `DiffHomePage`.

**Out of scope**: splitting the god components themselves (plan 020); changing vendor chunking in vite.config unless required for a clean split.

## Steps

Each sub-step is independent; do them one at a time and verify the build after each.

### Step 1: Lazy settings sections
Replace static panel imports with `lazy(() => import(...))` per section; wrap `ActiveSection` in `Suspense` with a lightweight skeleton.

**Verify**: `pnpm --filter @cradle/web build` → succeeds; separate chunks for chronicle/integrations settings appear in the output.

### Step 2: Lazy dockview on chat route
`const ChatSplitDockview = lazy(() => import('./chat-split-dockview'))`; render it only when `paneSessionIds.length > 1`, keep the single-pane path free of dockview.

**Verify**: `pnpm --filter @cradle/web build` → dockview no longer in the main chat chunk

### Step 3: Move xterm CSS
Import `@xterm/xterm/css/xterm.css` inside the terminal shell component (e.g. `shell-view.tsx`/`tui-view.tsx`) instead of `styles.css`. Verify no flash of unstyled terminal on first open.

**Verify**: `pnpm --filter @cradle/web build` → succeeds; xterm CSS not in the entry CSS

### Step 4: Lazy monaco + diff home
Wrap `WorkspaceFileEditor` in `React.lazy`; make `routes/diff.tsx` use `lazy(() => import('~/features/diff-review/diff-home-page'))`.

**Verify**: `pnpm --filter @cradle/web build` → monaco and pierre chunks are split out

### Step 5: Full check
**Verify**: `pnpm --filter @cradle/web typecheck` → exit 0; `pnpm --filter @cradle/web test` → pass

## Done criteria

- [ ] `pnpm --filter @cradle/web typecheck` exits 0
- [ ] `pnpm --filter @cradle/web build` succeeds with monaco, dockview, pierre, and chronicle/integrations settings in separate chunks
- [ ] `pnpm --filter @cradle/web test` passes
- [ ] `grep -n "xterm/css/xterm.css" apps/web/src/styles.css` returns nothing
- [ ] `plans/README.md` status row updated

## STOP conditions

- Lazy-loading a panel breaks a synchronous access pattern (e.g. a ref or imperative handle used before mount) — STOP and report that panel; leave it eager.
- Moving xterm CSS causes a visible unstyled-terminal flash that can't be resolved by importing in the terminal chunk — STOP and report.

## Maintenance notes

- Reviewer: sanity-check the built chunk graph, not just that it compiles.
- New heavy panels/routes should be lazy by default; consider a lint/checklist note.
