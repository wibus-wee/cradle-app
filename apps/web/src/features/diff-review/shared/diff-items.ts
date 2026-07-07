import type {
  CodeViewItem,
  CodeViewOptions,
  DiffLineAnnotation,
  SelectedLineRange,
  SelectionSide,
} from '@pierre/diffs'
import { parsePatchFiles } from '@pierre/diffs'
import type { WorkerInitializationRenderOptions, WorkerPoolOptions } from '@pierre/diffs/react'
import WorkerUrl from '@pierre/diffs/worker/worker.js?worker&url'

import type {
  CradleDiffReview,
  DiffStyle,
  ReviewFile,
  ReviewGuideAnchor,
  ReviewSourceKind,
  ReviewThread,
} from './types'

export interface DiffData {
  items: CodeViewItem<ThreadAnnotation>[]
  itemIdToPath: Map<string, string>
  pathToItemId: Map<string, string>
  whitespaceOnlyPaths: Set<string>
}

/** Per-thread annotation metadata carried on a CodeView line. */
export type ThreadAnnotation
  = | { kind: 'thread', threadId: string }
    | { kind: 'composer' }

export type CodeViewLineSelection = {
  id: string
  range: SelectedLineRange
}

export interface SelectedReviewRange {
  file: ReviewFile
  side: 'base' | 'head'
  startLine: number
  endLine: number
}

export const WORKER_POOL_OPTIONS = {
  workerFactory: () => new Worker(WorkerUrl, { type: 'module' }),
  poolSize: 3,
} satisfies WorkerPoolOptions

export const WORKER_HIGHLIGHTER_OPTIONS = {
  lineDiffType: 'word',
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  useTokenTransformer: false,
} satisfies WorkerInitializationRenderOptions

function hashPatchVersion(patch: string): number {
  let hash = 2166136261
  for (let index = 0; index < patch.length; index++) {
    hash ^= patch.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function createItemId(
  path: string,
  itemIds: Set<string>,
  nextCollisionSuffixByBase: Map<string, number>,
): string {
  if (!itemIds.has(path)) {
    return path
  }

  let suffix = nextCollisionSuffixByBase.get(path) ?? 2
  let itemId = `${path}?${suffix}`
  while (itemIds.has(itemId)) {
    suffix++
    itemId = `${path}?${suffix}`
  }
  nextCollisionSuffixByBase.set(path, suffix + 1)
  return itemId
}

function normalizeWhitespaceForStructuralDiff(line: string): string {
  return line.replace(/\s+/g, '')
}

function isWhitespaceOnlyFileDiff(fileDiff: Extract<CodeViewItem, { type: 'diff' }>['fileDiff']): boolean {
  if (fileDiff.type === 'rename-pure') {
    return false
  }
  const oldContent = fileDiff.deletionLines.map(normalizeWhitespaceForStructuralDiff).join('\n')
  const newContent = fileDiff.additionLines.map(normalizeWhitespaceForStructuralDiff).join('\n')
  return oldContent === newContent
}

export function buildItemsFromPatch(patch: string): DiffData {
  const patchVersion = hashPatchVersion(patch)
  const parsed = parsePatchFiles(
    patch,
    `cradle-diffs-${patch.length.toString(36)}-${patchVersion.toString(36)}`,
  )
  const items: CodeViewItem<ThreadAnnotation>[] = []
  const itemIdToPath = new Map<string, string>()
  const pathToItemId = new Map<string, string>()
  const whitespaceOnlyPaths = new Set<string>()
  const itemIds = new Set<string>()
  const nextCollisionSuffixByBase = new Map<string, number>()
  for (const p of parsed) {
    for (const fileDiff of p.files) {
      const itemId = createItemId(fileDiff.name, itemIds, nextCollisionSuffixByBase)
      itemIds.add(itemId)
      items.push({ id: itemId, type: 'diff', fileDiff, version: patchVersion })
      itemIdToPath.set(itemId, fileDiff.name)
      pathToItemId.set(fileDiff.name, itemId)
      if (isWhitespaceOnlyFileDiff(fileDiff)) {
        whitespaceOnlyPaths.add(fileDiff.name)
      }
      if (fileDiff.prevName) {
        pathToItemId.set(fileDiff.prevName, itemId)
        if (isWhitespaceOnlyFileDiff(fileDiff)) {
          whitespaceOnlyPaths.add(fileDiff.prevName)
        }
      }
    }
  }
  return { items, itemIdToPath, pathToItemId, whitespaceOnlyPaths }
}

export const EMPTY_DIFF_DATA: DiffData = {
  items: [],
  itemIdToPath: new Map(),
  pathToItemId: new Map(),
  whitespaceOnlyPaths: new Set(),
}

/**
 * Build per-file line annotations from a review's open threads so the CodeView can render
 * comment threads inline at their anchor.
 */
export function buildThreadAnnotations(
  threads: ReviewThread[],
  itemIdToPath: Map<string, string>,
): Map<string, DiffLineAnnotation<ThreadAnnotation>[]> {
  const byItem = new Map<string, DiffLineAnnotation<ThreadAnnotation>[]>()
  for (const thread of threads) {
    const anchor = thread.anchor
    if (!anchor) {
      continue
    }
    const itemId = itemIdToPath.get(anchor.path)
    if (!itemId) {
      continue
    }
    const side = anchor.side === 'base' ? 'deletions' : 'additions'
    const list = byItem.get(itemId) ?? []
    list.push({ side, lineNumber: anchor.startLine, metadata: { kind: 'thread', threadId: thread.id } })
    byItem.set(itemId, list)
  }
  return byItem
}

export function reviewQueryKey(
  workspaceId: string,
  repositoryPath: string | null | undefined,
  reviewId: string,
) {
  return ['cradle-diffs', 'review', workspaceId, repositoryPath ?? null, reviewId] as const
}

export function reviewListQueryKey(workspaceId: string) {
  return ['cradle-diffs', 'reviews', workspaceId] as const
}

export function formatChangeStats(review: CradleDiffReview): string {
  const revision = review.currentRevision
  if (!revision) {
    return '0 files'
  }
  return `${revision.fileCount} file${revision.fileCount === 1 ? '' : 's'} · +${revision.additions} -${revision.deletions}`
}

export function formatTimestamp(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString()
}

export function sourceLabel(sourceKind: ReviewSourceKind): string {
  if (sourceKind === 'local-working-tree') {
    return 'Working tree'
  }
  if (sourceKind === 'local-branch-compare') {
    return 'Branch compare'
  }
  if (sourceKind === 'local-commit') {
    return 'Commit diff'
  }
  if (sourceKind === 'agent-change-set') {
    return 'Agent changes'
  }
  if (sourceKind === 'github-pull-request') {
    return 'GitHub PR'
  }
  return 'External'
}

export function statusLabel(status: ReviewFile['status']): string {
  if (status === 'untracked') {
    return 'new'
  }
  return status
}

export function selectionSideToAnchorSide(side: SelectedLineRange['side']): 'base' | 'head' {
  return side === 'deletions' ? 'base' : 'head'
}

export function anchorSideToSelectionSide(side: 'base' | 'head'): SelectionSide {
  return side === 'base' ? 'deletions' : 'additions'
}

/** Anchors on a guide step that point into a given file path. */
export function guideAnchorsForPath(anchors: ReviewGuideAnchor[], path: string): ReviewGuideAnchor[] {
  return anchors.filter(anchor => anchor.path === path)
}

/**
 * Convert a guide range anchor into the CodeView's controlled line selection so the chapter's
 * focus range is highlighted in-place. Returns null for an empty/zero-width anchor.
 */
export function anchorToLineSelection(itemId: string, anchor: ReviewGuideAnchor): CodeViewLineSelection {
  const side = anchorSideToSelectionSide(anchor.side)
  return {
    id: itemId,
    range: {
      start: anchor.startLine,
      end: Math.max(anchor.startLine, anchor.endLine),
      side,
      endSide: side,
    },
  }
}

/** Human label for an anchor's line range, e.g. `L12` or `L12–18`. */
export function formatAnchorRange(anchor: ReviewGuideAnchor): string {
  return anchor.startLine === anchor.endLine
    ? `L${anchor.startLine}`
    : `L${anchor.startLine}–${anchor.endLine}`
}

export function getSelectedReviewRange(
  selection: CodeViewLineSelection | null,
  files: ReviewFile[],
  itemIdToPath: Map<string, string>,
): SelectedReviewRange | null {
  if (!selection) {
    return null
  }
  const path = itemIdToPath.get(selection.id)
  if (!path) {
    return null
  }
  const file = files.find(item => item.path === path)
  if (!file) {
    return null
  }
  const startSide = selection.range.side ?? selection.range.endSide
  const endSide = selection.range.endSide ?? startSide
  if (startSide && endSide && startSide !== endSide) {
    return null
  }
  return {
    file,
    side: selectionSideToAnchorSide(startSide),
    startLine: Math.min(selection.range.start, selection.range.end),
    endLine: Math.max(selection.range.start, selection.range.end),
  }
}

export function formatSelectedReviewRange(selection: SelectedReviewRange): string {
  const lineLabel = selection.startLine === selection.endLine
    ? `line ${selection.startLine}`
    : `lines ${selection.startLine}-${selection.endLine}`
  return `${selection.file.path} · ${selection.side} ${lineLabel}`
}

export function reviewNeedsAttention(review: CradleDiffReview): boolean {
  if (review.status !== 'open') {
    return false
  }
  if (review.reviewState === 'changes-requested') {
    return true
  }
  if (review.threads.some(thread => thread.state === 'open' || thread.state === 'stale')) {
    return true
  }
  if (review.currentRevision && review.files.some(file => !file.isViewed)) {
    return true
  }
  return false
}

export const LOCAL_REVIEW_USER_ID = 'local-user'

export function reviewAuthoredByLocalUser(review: CradleDiffReview): boolean {
  return review.sourceKind === 'local-working-tree'
    || review.sourceKind === 'local-branch-compare'
    || review.sourceKind === 'local-commit'
    || review.events.some(event => event.eventKind === 'review_created' && event.actorId === LOCAL_REVIEW_USER_ID)
}

export function reviewParticipatedByLocalUser(review: CradleDiffReview): boolean {
  return review.threads.some(thread =>
    thread.createdBy === LOCAL_REVIEW_USER_ID
    || thread.comments.some(comment => comment.authorId === LOCAL_REVIEW_USER_ID)
    || thread.reactions.some(reaction => reaction.userId === LOCAL_REVIEW_USER_ID))
  || review.submissions.some(submission => submission.actorId === LOCAL_REVIEW_USER_ID)
  || review.commitPlans.some(plan => plan.actorId === LOCAL_REVIEW_USER_ID)
}

/** Linear-style "For me" (involved/responsible) vs "Created" (authored). */
export function reviewForMe(review: CradleDiffReview): boolean {
  return reviewNeedsAttention(review) || reviewParticipatedByLocalUser(review)
}

export function buildCodeViewOptions(
  diffStyle: DiffStyle,
  onGutterUtilityClick?: CodeViewOptions<ThreadAnnotation>['onGutterUtilityClick'],
): CodeViewOptions<ThreadAnnotation> {
  return {
    theme: { dark: 'pierre-dark', light: 'pierre-light' },
    themeType: 'system',
    diffStyle,
    diffIndicators: 'bars',
    overflow: 'scroll',
    lineDiffType: 'word',
    hunkSeparators: 'line-info-basic',
    enableLineSelection: true,
    controlledSelection: true,
    // Hover any line → a "+" appears in the gutter → click opens the composer.
    enableGutterUtility: true,
    onGutterUtilityClick,
    stickyHeaders: true,
    pointerEventsOnScroll: false,
    itemMetrics: {
      hunkLineCount: 1,
      lineHeight: 18,
    },
  }
}

export { WORKING_TREE_REVIEW_ID } from './types'

export type { ReviewThread }
