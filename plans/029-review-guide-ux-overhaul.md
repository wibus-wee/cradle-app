# Plan 029 — Review Guide UX overhaul

> **Executor instructions**: Follow step by step; verify each. Honor STOP conditions. Update `plans/README.md` row when done.
>
> **Principle**: The Guide reading view is currently a long-scroll dead-end side-trip. Make it a navigational lens over the review: a chapter index that tracks position, anchors that are all visible and clickable, one-click jumps back into the review diff at a line, honest generation progress, rich rationale, and provenance on the finished artifact. No backend changes required — all six items are client-side.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW–MEDIUM — touches only `apps/web/src/features/diff-review/**`; no server, no schema, no API contract. Medium only because #3 adds a search-param + a new `DiffStage` handle method.
- **Depends on**: —
- **Category**: UX / frontend
- **Planned at**: 2026-07-06

## Why this matters

Six concrete UX gaps in `apps/web/src/features/diff-review/review-detail/guide-view.tsx`, in user-impact order:

1. **No navigation shape.** `GuideReading` (`guide-view.tsx:521`) is one `space-y-14` long scroll; header says only "X chapters". A 12-chapter guide is a wall — no TOC, no scrollspy, no "you are here".
2. **Collapsed-by-default files + single-anchor highlight.** Files default collapsed (`:607`, `:680`), so the reader must click to see the very code the narrative points at. Worse, `guideAnchorsForPath(...)[0]` (`:738`) only highlights the first anchor — a chapter pointing at three regions in one file silently drops two.
3. **Guide is a dead-end.** `step.threadIds` renders as flat "N related threads" footnote text (`:664`), not clickable. Anchors can't jump into the review diff. The guide doesn't link back into the review it summarizes.
4. **Fake progress + blocking regenerate.** The Preflight / Runtime turn / Validate step list (`:401`) is driven only by `requestPending` — theater. And `force` regen replaces the reading view with the gate (`:86`), so you can't read the old guide while the new one streams.
5. **Plain-text rationale.** `<p>{step.rationale}</p>` (`:645`) flattens the model's bullets/inline-code/links. Streamdown is already a dep and used elsewhere in the same file (`:445`).
6. **No provenance.** The finished guide shows a "generated" badge but not *which model*, *when*, or *for how many files*.

## Scope

**In scope** (all client-side, `apps/web/src/features/diff-review/**` + the diff route's search params):
- Items #1–#6 as described above.

**Out of scope / deferred follow-ups** (do not attempt in this plan):
- Per-chapter regenerate or manual chapter edit (today regen is all-or-nothing server-side; `upsertGuide` wipes `stepsJson` to `running`).
- `outputLocale` / depth controls in the generation gate (`GenerateGuideInput.outputLocale` exists; gate doesn't expose it).
- Stale-revision warning. The guide row is keyed `(reviewId, revisionId)` and loaded with `currentRevision` (`service.ts:491`), so a stale guide-vs-revision is impossible in the current data model. Provenance (#6) covers freshness implicitly via "generated {relative time} ago".

## Architecture decisions (verified during exploration)

- **CodeView `selectedLines` is single-range only** (`@pierre/diffs/dist/react/CodeView.d.ts:15`). No multi-highlight API. → #2 uses a **per-file anchor switcher** (pills for every anchor; click sets active + `scrollTo`), reusing the existing single `selectedLines` + `viewerRef.scrollTo({ type: 'range' })` (`guide-view.tsx:754`). No CodeView API change.
- **Non-blocking regen is client-only.** Server `force` immediately sets `stepsJson: '[]'` (`service.ts:2411`), so the old steps vanish from the API. → #4 holds a `previousGuideRef` snapshot of the last `ready` guide in `GuideView` and renders `GuideReading` from it while regen runs; drops the snapshot when `status === 'ready'` returns.
- **Line-level deep-link is feasible.** `navigateToReview` already supports `path` (`shared/navigation.ts:59`) and `ReviewDetailPage` consumes `initialPath` (`review-detail-page.tsx:63`). `DiffStageHandle.scrollToThread` (`diff-stage.tsx:159`) already proves `viewer.scrollTo({ type: 'line', lineNumber, side })` works. → #3 adds a `line` search param and a `scrollToLine` handle method.
- **Honest progress signals exist.** `guide.sessionId` is on the view; the client already polls session messages (`guide-view.tsx:313`) and surfaces streaming assistant output. → #4 drops the fake 3-step list and leans on streaming output + elapsed.

---

## Implementation steps

### Step 1 — Chapter TOC + scrollspy (#1)

**File**: `apps/web/src/features/diff-review/review-detail/guide-view.tsx` — `GuideReading`.

- Give each `<section>` a stable `id` (`chapter-${index + 1}`) and a `ref` (or query by selector).
- Add `GuideChapterNav`:
  - `xl` screens: a sticky vertical list (chapter number + truncated title) floating in the left margin of the centered `max-w-6xl` article, so it does **not** disturb the existing `lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]` section grid.
  - `< xl` screens: a sticky horizontal scroller of chapter-number pills under the header.
- `IntersectionObserver` rooted at the scroll container (`:522`'s `overflow-y-auto` div) tracks the active `<section>`; the active nav item is highlighted. Click → `section.scrollIntoView({ behavior: 'smooth', block: 'start' })` with top offset for the sticky header (`scroll-margin-top` on the section).
- Optional: keyboard `j`/`k` to jump chapters. Defer if it adds complexity.

**Verify**: render a 12-chapter guide; scroll and confirm the active nav item tracks; click a nav item and land on the chapter; no layout regression on the 2-col section grid.

### Step 2 — Anchor switcher + auto-expand primary file (#2)

**File**: `guide-view.tsx` — `GuideSection`, `GuideFileCodeView`, `CollapsedFileBlock`.

- In `GuideSection`, initialize `expandedFileIds` to include the **primary anchored file's item id** instead of `new Set()`. Compute from `step.anchors[0]` → resolve path → `diffData.pathToItemId`. If no anchors, leave empty (current behavior).
- In `GuideFileCodeView`, replace the single-`primaryAnchor` `selectedLines` with a per-file anchor switcher:
  - `const anchors = guideAnchorsForPath(anchors, item.fileDiff.name)`.
  - Local state `activeAnchorIndex` (default `0`).
  - Render a pill row above the CodeView: one pill per anchor via `formatAnchorRange` (`L12`, `L42–58`, …). Active pill is highlighted (orange).
  - `selectedLines` = `anchorToLineSelection(item.id, anchors[activeAnchorIndex])`.
  - On pill click: set `activeAnchorIndex` and `viewerRef.current?.scrollTo({ type: 'range', id: item.id, range, align: 'center' })` (reuse the existing 2-rAF defer pattern at `:745`).
- `CollapsedFileBlock` already shows a `focusLabel` pill for `anchors[0]`; extend to show `+N` when there are multiple anchors in the file, so the collapsed state signals "multiple regions inside".

**Verify**: a chapter with 3 anchors in one file shows 3 pills; clicking each moves the highlight + scrolls; the primary file is expanded on first render.

**STOP**: If toggling `selectedLines` on a mounted CodeView does not move the highlight (CodeView ignores controlled updates after mount), fall back to `viewerRef.current?.setSelectedLines(...)` via the handle (`CodeView.d.ts:39`) — verify the highlight actually follows before shipping.

### Step 3 — Navigational lens: anchor + thread → review diff (#3)

**Files**: `shared/navigation.ts`, `shared/types.ts`, `workspace-diffs-view.tsx`, `review-detail-page.tsx`, `diff-stage.tsx`, `guide-view.tsx`.

- `shared/types.ts`: extend `DiffsViewSearch` with `line?: number` (and `thread?: string` for thread jumps). Add `navigateToReviewAtAnchor(workspaceId, reviewId, { repositoryPath?, path, line?, side? })` in `navigation.ts` — reuses `navigateWithinCurrentDiffSurface` with `view: undefined` (drops `view: 'guide'`).
- `workspace-diffs-view.tsx`: read `line` from route search, pass as `initialLine` to `ReviewDetailPage`.
- `review-detail-page.tsx`: accept `initialLine?`; extend `pendingScrollRef` flow — after `scrollToPath`, if `initialLine` present, call `stageHandleRef.current?.scrollToLine(path, line, side)`.
- `diff-stage.tsx`: add `scrollToLine(path: string, line: number, side: 'base' | 'head')` to `DiffStageHandle`. Implement like `scrollToThread` (`:159`): resolve itemId via `visiblePathToItemId`, un-collapse if needed, `viewer.scrollTo({ type: 'line', id: itemId, lineNumber: line, side: side === 'base' ? 'deletions' : 'additions', align: 'center', behavior: 'smooth' })`.
- `guide-view.tsx`:
  - Each anchor pill in `GuideFileCodeView` gets a small "Open in review" icon button → `navigateToReviewAtAnchor(workspaceId, reviewId, { repositoryPath, path: file.path, line: anchor.startLine, side: anchor.side })`. `GuideView` already has `workspaceId` + `repositoryPath` props; thread them into `GuideReading` → `GuideSection` → `GuideFileCodeView`.
  - Thread footnote (`:664`): make each related thread a clickable chip showing its state + comment count; click → `navigateToReviewAtAnchor` at `thread.anchor.path` / `thread.anchor.startLine` (or plain `navigateToReview` if the thread has no anchor).

**Verify**: from a guide chapter, click "Open in review" on an anchor → review detail opens, scrolls to that file + line. Click a related-thread chip → jumps to the thread's anchor in the review.

**STOP**: If line-level scroll races the virtualizer on cold mount (the existing `GuideFileCodeView` 2-rAF defer at `:745` is the proven pattern — reuse it in `scrollToLine`'s mount path). If still flaky after reusing the pattern, land file-level only and defer line-level to a follow-up; note it in `plans/README.md`.

### Step 4 — Honest progress + non-blocking regenerate (#4)

**File**: `guide-view.tsx` — `GuideView`, `GuideGenerationStatusPanel`, `GuideGenerationStep`.

- **Non-blocking regen**: in `GuideView`, add `const previousGuideRef = useRef<ReviewGuideView | null>(null)`. Capture: whenever `review.guide.status === 'ready' && steps.length > 0`, set `previousGuideRef.current = review.guide`. Use the snapshot when `regenerating && review.guide.status !== 'ready'`: render `GuideReading` from `previousGuideRef.current` (with the `review` wrapper for files/preferences) plus a slim top banner ("Regenerating… [Cancel]" + a collapsible streaming-output panel — reuse `GuideGenerationStatusPanel`'s model-output block). Clear the ref when `review.guide.status === 'ready'` returns. Keep the full-screen `GuideGenerateGate` only for **first** generation (no existing guide).
- **Honest progress**: in `GuideGenerationStatusPanel`, delete the hardcoded `GuideGenerationStep` block (Preflight / Runtime turn / Validate, `:401`). Replace with a single status line driven by real state: `requestPending` → "Starting"; `status === 'running'` → "Reading diff & writing guide"; `status === 'ready'` → done; `status === 'failed'` → failed. Keep the elapsed timer + the existing streaming `assistantOutput` block (already honest). Optionally derive a thinking-vs-writing sub-phase from `messagesQuery` parts — polish, defer if costly.
- Remove the now-unused `GuideGenerationStep` component.

**Verify**: with an existing guide, hit Regenerate → old guide stays readable, banner streams model output, on `ready` the new guide swaps in. First-time generation still shows the full gate.

### Step 5 — Markdown rationale (#5)

**File**: `guide-view.tsx` — `GuideSection`.

- Replace `<p className="mt-3 text-[14px] leading-[1.75] text-foreground/85">{step.rationale}</p>` with:
  ```tsx
  <Streamdown
    content={step.rationale}
    streaming={false}
    animationPreset={STREAMDOWN_RENDER_OPTIONS.animationPreset}
    animateMode={STREAMDOWN_RENDER_OPTIONS.animateMode}
    showCursor={false}
    className="mt-3 text-[14px] leading-[1.75] text-foreground/85"
  />
  ```
  (Streamdown + `STREAMDOWN_RENDER_OPTIONS` already imported at `:1`, `:30`.)
- Confirm the rendered markdown (headings, lists, inline code, links) matches the existing typographic scale; constrain block width so it doesn't blow past the narrative column.

**Verify**: a rationale containing a bullet list + inline code renders rich; no font/size regression vs. the old plain `<p>`.

### Step 6 — Provenance on the finished guide (#6)

**File**: `guide-view.tsx` — `GuideReading` header.

- In the header (`:524`), replace the standalone emerald "generated" badge with a provenance line:
  - model: `guide.modelId` (truncate, mono).
  - relative time: `guide.updatedAt` → "generated 2h ago" (add a small `formatRelativeTime(seconds)` helper, or reuse `formatTimestamp` from `shared/diff-items.ts:183` if relative is too much).
  - coverage: "for N files" from `review.currentRevision.fileCount`.
- Keep it understated (muted foreground, `text-[11px]`), matching the existing header typography.

**Verify**: finished guide shows model + relative time + file count; first-generation (null fields) shows nothing broken.

---

## Done criteria

- [ ] Chapter TOC renders on `xl` (left rail) and `< xl` (top scroller); active chapter tracks scroll; click jumps.
- [ ] Primary anchored file auto-expands; per-file anchor switcher shows all anchors; clicking a pill moves highlight + scrolls.
- [ ] "Open in review" on an anchor + clickable thread chips jump to the review detail at the right file/line.
- [ ] Regenerate keeps the old guide visible with a streaming banner; first-time generation still uses the full gate.
- [ ] Fake Preflight/Runtime/Validate step list removed; progress is streaming output + elapsed + one honest status line.
- [ ] Rationale renders as markdown.
- [ ] Finished guide header shows model + relative time + file count.
- [ ] `pnpm --filter @cradle/web typecheck` passes.
- [ ] `pnpm --filter @cradle/web test` passes (existing `guide-view` tests if any; add focused tests for nav + anchor switcher if the harness makes that cheap).
- [ ] `plans/README.md` row updated.

## STOP conditions

- CodeView ignores controlled `selectedLines` updates after mount → use `viewerRef.setSelectedLines` handle method; verify highlight follows before shipping (#2).
- Line-level deep-link scroll races the virtualizer on cold mount even after reusing the 2-rAF pattern → land file-level deep-link only, defer line-level, note in README (#3).
- `Streamdown` renders rationale at a wildly different typographic scale that can't be tamed with a `className` → keep plain text for rationale and report (#5).

## Maintenance notes

- The `previousGuideRef` snapshot in #4 is intentionally a *ref*, not state — it must not trigger re-renders; `GuideReading` reads it synchronously during render when `regenerating` is active.
- The new `line` / `thread` search params are additive to `DiffsViewSearch`; existing `navigateToReview` callers are unaffected (both fields optional).
- All six items are reversible independently if any one lands badly.
