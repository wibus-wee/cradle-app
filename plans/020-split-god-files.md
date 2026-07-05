# Plan 020 — Split the largest god files into cohesive modules

> **Executor instructions**: This is a multi-target refactor. Do ONE target at a time, each on its own branch/commit, verifying after each. Honor STOP conditions. Update `plans/README.md`.
>
> **Drift check (run first, per target)**: `git diff --stat ac47f3b..HEAD -- <target file>` — if it changed materially, re-derive the seams before extracting.

## Status

- **Priority**: P3
- **Effort**: L (each target is M–L; the set is L+)
- **Risk**: MED — behavior-preserving extraction of large files; needs characterization tests first (plan 022 for web).
- **Depends on**: plans/022-web-critical-path-tests.md (for the web targets — write characterization tests before extracting)
- **Category**: tech-debt
- **Planned at**: commit `ac47f3b`, 2026-07-05

## Why this matters

A handful of files are an order of magnitude larger than the repo median and fuse many concerns, making review, testing, and security audit hard and merge conflicts frequent:

- Server: `chronicle/service.ts` (9067 lines), `diff-review/service.ts` (3587).
- Web: `workspace-sidebar.tsx` (3497), `browser-panel.tsx` (3146), `chronicle-settings.tsx` (2790).

The goal is behavior-preserving extraction along natural seams, leaving a thin composition shell. This is intentionally P3: it's high-value maintainability work but must not precede the security and correctness fixes, and each target needs a test net first.

## Current state

Sizes confirmed via `wc -l`. Natural seams identified by the audit:

- `apps/server/src/modules/chronicle/service.ts` — mixes daemon lifecycle, Slack sync, model-resource downloads, audio, and the query API. Seams: `chronicle/daemon`, `chronicle/slack-sync`, `chronicle/model-resources`, `chronicle/audio`, `chronicle/query`.
- `apps/server/src/modules/diff-review/service.ts` — seams: parser, review-state, API layer.
- `apps/web/src/features/workspace/workspace-sidebar.tsx` — seams: `WorkspaceList`, `SessionListByWorkspace`, `RemoteHostPanel`, dialog modules; keep a thin `WorkspaceSidebar` shell.
- `apps/web/src/features/browser/browser-panel.tsx` — seams: `browser-webview-shell`, `browser-tab-strip`, `browser-annotation-tray`, `browser-workspace-tabs`; IPC in a dedicated hook.
- `apps/web/src/features/chronicle/chronicle-settings.tsx` — seams: tab-scoped section components; move HTTP into `use-chronicle` wrappers.

## Commands you will need

| Purpose        | Command | Expected |
|----------------|---------|----------|
| Server typecheck | `pnpm --filter @cradle/server typecheck` | exit 0 |
| Server tests   | `pnpm --filter @cradle/server test` | pass |
| Web typecheck  | `pnpm --filter @cradle/web typecheck` | exit 0 |
| Web tests      | `pnpm --filter @cradle/web test` | pass |

## Scope

**In scope**: the five files above and the new sibling modules created by extraction, plus updating their imports.

**Out of scope**: changing behavior, public API shapes, or data-fetching patterns (that's plan 023); the god files' *callers* beyond import-path updates.

## Steps (repeat per target)

### Step A: Ensure a test net
For web targets, confirm characterization tests from plan 022 exist for the behavior you're about to move. For server targets, ensure the module's existing tests cover the extracted behavior; if not, add characterization tests first.

**Verify**: relevant `test` command → pass (baseline green before extraction)

### Step B: Extract one seam
Move one cohesive seam into a new sibling file, re-exporting from the original so callers don't change yet. Keep types and function signatures identical.

**Verify**: typecheck + tests → still green

### Step C: Repeat for each seam, then thin the shell
Once all seams are extracted, reduce the original to a composition/re-export shell.

**Verify**: typecheck + tests → green; `wc -l <original>` is dramatically smaller

### Step D: Update direct importers if the re-export shim is removed
Only if you choose to drop the shim; otherwise leave imports untouched.

**Verify**: typecheck + tests → green

## Done criteria (per target)

- [ ] Typecheck exits 0; tests pass (no behavior change)
- [ ] The original file is a thin shell (order-of-magnitude smaller)
- [ ] No public API/response shape changed
- [ ] `plans/README.md` status row updated (track per-target sub-status)

## STOP conditions

- Extraction reveals hidden shared mutable state that can't be cleanly separated — STOP and report; that coupling must be designed out first, not papered over.
- A seam has no test coverage and characterization tests can't be written cheaply — STOP and report; do not refactor untested behavior blind.
- Typecheck/tests fail after an extraction and the cause isn't a mechanical import fix — STOP and report.

## Maintenance notes

- Consider adding a max-file-size lint (warn) so new god files don't reappear.
- Reviewer: the diff should be almost entirely moves; flag any logic change.
- Do NOT attempt all five in one PR — one target per PR keeps review tractable.
