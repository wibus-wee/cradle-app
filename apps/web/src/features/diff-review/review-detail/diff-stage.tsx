import type { CodeViewItem, DiffLineAnnotation, SelectedLineRange } from '@pierre/diffs'
import type { CodeViewHandle } from '@pierre/diffs/react'
import { CodeView, useStableCallback } from '@pierre/diffs/react'
import { useEffect, useMemo, useRef } from 'react'

import type { DiffData } from '~/components/common/diff/diff-data'
import { buildDiffOptions } from '~/components/common/diff/diff-options'

import type { CodeViewLineSelection, ThreadAnnotation } from '../shared/diff-items'
import {
  anchorSideToSelectionSide,
  buildThreadAnnotations,
  getSelectedReviewRange,
} from '../shared/diff-items'
import type { CradleDiffReview, DiffStyle, ReviewFile, ReviewThread } from '../shared/types'
import { InlineThread } from './inline-thread'
import { ThreadComposer } from './thread-composer'

export interface DiffStageHandle {
  scrollToPath: (path: string) => void
  scrollToThread: (thread: ReviewThread) => void
  scrollToLine: (path: string, line: number, side: 'base' | 'head') => void
}

interface DiffStageProps {
  review: CradleDiffReview
  diffData: DiffData<ThreadAnnotation>
  visibleItems: CodeViewItem<ThreadAnnotation>[]
  visiblePathToItemId: Map<string, string>
  diffStyle: DiffStyle
  selectedLineSelection: CodeViewLineSelection | null
  onSelectLines: (selection: CodeViewLineSelection | null) => void
  onFileFromSelection: (fileId: string) => void
  composerAnchor: CodeViewLineSelection | null
  onComposerOpen: (selection: CodeViewLineSelection) => void
  onComposerClose: () => void
  onCreateThread: (input: { fileId: string, anchor: { fileId: string, side: 'base' | 'head', startLine: number, endLine: number }, bodyMarkdown: string }) => void
  createPending: boolean
  onReply: (threadId: string, bodyMarkdown: string) => void
  replyPending: boolean
  onResolve: (threadId: string) => void
  resolvePending: boolean
  onAskAgentForThread?: (threadId: string) => void
  files: ReviewFile[]
  onExpandedThreadIdChange?: (id: string | null) => void
  handleRef?: (handle: DiffStageHandle | null) => void
}

function annotationRenderVersion(
  item: CodeViewItem<ThreadAnnotation>,
  annotations: DiffLineAnnotation<ThreadAnnotation>[],
  review: CradleDiffReview,
  composerAnchor: CodeViewLineSelection | null,
): number {
  let version = typeof item.version === 'number' ? item.version : 0
  version += review.updatedAt
  version += annotations.length * 13
  for (const thread of review.threads) {
    version += thread.updatedAt
    version += thread.comments.length * 17
    version += thread.state === 'resolved' ? 19 : 23
  }
  if (composerAnchor?.id === item.id) {
    const { range } = composerAnchor
    version += 1_000_003
    version += range.start * 31
    version += range.end * 37
    version += range.side === 'deletions' ? 41 : 43
    version += range.endSide === 'deletions' ? 47 : range.endSide === 'additions' ? 53 : 0
  }
  return version
}

export function DiffStage({
  review,
  diffData,
  visibleItems,
  visiblePathToItemId,
  diffStyle,
  selectedLineSelection,
  onSelectLines,
  onFileFromSelection,
  composerAnchor,
  onComposerOpen,
  onComposerClose,
  onCreateThread,
  createPending,
  onReply,
  replyPending,
  onResolve,
  resolvePending,
  onAskAgentForThread,
  files,
  onExpandedThreadIdChange,
  handleRef,
}: DiffStageProps) {
  const viewerRef = useRef<CodeViewHandle<ThreadAnnotation>>(null)

  const handleGutterUtilityClick = useStableCallback((range: SelectedLineRange, context: { item: { id: string } }) => {
    const selection: CodeViewLineSelection = { id: context.item.id, range }
    onSelectLines(selection)
    const path = diffData.itemIdToPath.get(selection.id)
    const file = path ? files.find(item => item.path === path) : undefined
    if (file) {
      onFileFromSelection(file.id)
    }
    onComposerOpen(selection)
  })

  const options = useMemo(
    () => buildDiffOptions<ThreadAnnotation>(diffStyle, {
      controlledSelection: true,
      enableGutterUtility: true,
      enableLineSelection: true,
      onGutterUtilityClick: handleGutterUtilityClick,
    }),
    [diffStyle, handleGutterUtilityClick],
  )

  const annotationsByItem = useMemo(
    () => {
      const next = buildThreadAnnotations(review.threads, diffData.itemIdToPath)
      const range = getSelectedReviewRange(composerAnchor, files, diffData.itemIdToPath)
      if (composerAnchor && range) {
        const list = next.get(composerAnchor.id) ?? []
        list.push({
          side: anchorSideToSelectionSide(range.side),
          lineNumber: range.startLine,
          metadata: { kind: 'composer' },
        })
        next.set(composerAnchor.id, list)
      }
      return next
    },
    // Key on `review.threads` only: unrelated review changes (viewed/preference/submit mutations)
    // must not rebuild item objects, or CodeView's referential areItemListsEqual check fails and it
    // does a full setItems + re-render of the whole visible window.
    [composerAnchor, files, review.threads, diffData.itemIdToPath],
  )

  const itemsWithAnnotations = useMemo(
    () => visibleItems.map((item) => {
      const annotations = annotationsByItem.get(item.id)
      return annotations
        ? { ...item, annotations, version: annotationRenderVersion(item, annotations, review, composerAnchor) }
        : item
    }),
    [visibleItems, annotationsByItem, review, composerAnchor],
  )

  const scrollToPath = useStableCallback((path: string) => {
    const viewer = viewerRef.current
    if (!viewer || visibleItems.length === 0) {
      return
    }
    const itemId = visiblePathToItemId.get(path)
    if (!itemId) {
      return
    }
    const item = viewer.getItem(itemId)
    if (item?.collapsed === true) {
      viewer.updateItem({ ...item, collapsed: false, version: typeof item.version === 'number' ? item.version + 1 : 1 })
    }
    viewer.scrollTo({ type: 'item', id: itemId, align: 'start', behavior: 'smooth' })
  })

  const scrollToThread = useStableCallback((thread: ReviewThread) => {
    const viewer = viewerRef.current
    const anchor = thread.anchor
    if (!viewer || !anchor) {
      return
    }
    const itemId = visiblePathToItemId.get(anchor.path)
    if (!itemId) {
      return
    }
    const side = anchor.side === 'base' ? 'deletions' : 'additions'
    viewer.scrollTo({ type: 'line', id: itemId, lineNumber: anchor.startLine, side, align: 'center', behavior: 'smooth' })
  })

  // Scroll to a specific line in a file, un-collapsing the file first if needed. Used by the
  // guide's "Open in review" deep link. Two rAFs let the virtualizer measure the freshly
  // un-collapsed lines before we ask it to center a specific one — scrolling synchronously races
  // the virtualizer on cold mount.
  const scrollToLine = useStableCallback((path: string, line: number, side: 'base' | 'head') => {
    const viewer = viewerRef.current
    if (!viewer || visibleItems.length === 0) {
      return
    }
    const itemId = visiblePathToItemId.get(path)
    if (!itemId) {
      return
    }
    const item = viewer.getItem(itemId)
    if (item?.collapsed === true) {
      viewer.updateItem({ ...item, collapsed: false, version: typeof item.version === 'number' ? item.version + 1 : 1 })
    }
    // Defer two frames so the virtualizer measures the freshly un-collapsed lines before we ask
    // it to center a specific one. viewerRef is re-read inside the rAF so a stale viewer (after
    // unmount) is a no-op rather than a throw.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        viewerRef.current?.scrollTo({
          type: 'line',
          id: itemId,
          lineNumber: line,
          side: side === 'base' ? 'deletions' : 'additions',
          align: 'center',
          behavior: 'smooth',
        })
      })
    })
  })

  useEffect(() => {
    handleRef?.({ scrollToPath, scrollToThread, scrollToLine })
    return () => handleRef?.(null)
  }, [handleRef, scrollToPath, scrollToThread, scrollToLine])

  const threadById = useMemo(() => new Map(review.threads.map(thread => [thread.id, thread])), [review.threads])

  const renderAnnotation = useStableCallback((annotation: DiffLineAnnotation<ThreadAnnotation>) => {
    if (annotation.metadata?.kind === 'composer' && composerAnchor) {
      return (
        <ThreadComposer
          selection={composerAnchor}
          files={files}
          itemIdToPath={diffData.itemIdToPath}
          onClose={onComposerClose}
          onCreate={onCreateThread}
          pending={createPending}
        />
      )
    }

    const thread = annotation.metadata?.kind === 'thread' ? threadById.get(annotation.metadata.threadId) : null
    if (!thread) {
      return null
    }
    return (
      <InlineThread
        thread={thread}
        onReply={onReply}
        replyPending={replyPending}
        onResolve={onResolve}
        resolvePending={resolvePending}
        onAskAgent={onAskAgentForThread}
        onExpandedChange={onExpandedThreadIdChange}
      />
    )
  })

  const selectDiffLines = useStableCallback((selection: CodeViewLineSelection | null) => {
    onSelectLines(selection)
    if (!selection) {
      return
    }
    const path = diffData.itemIdToPath.get(selection.id)
    const file = path ? files.find(item => item.path === path) : undefined
    if (file) {
      onFileFromSelection(file.id)
    }
  })

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      {visibleItems.length === 0
        ? (
            <div className="flex h-full items-center justify-center p-4 text-center">
              <p className="text-[12px] text-muted-foreground">Working tree clean</p>
            </div>
          )
        : (
            <CodeView
              ref={viewerRef}
              items={itemsWithAnnotations}
              options={options}
              selectedLines={selectedLineSelection}
              onSelectedLinesChange={selectDiffLines}
              renderAnnotation={renderAnnotation}
              className="min-h-0 h-full overflow-auto overscroll-contain [overflow-anchor:none]"
            />
          )}

    </div>
  )
}
