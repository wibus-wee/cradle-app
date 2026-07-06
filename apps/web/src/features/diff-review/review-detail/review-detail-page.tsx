import type { CodeViewItem } from '@pierre/diffs'
import { GitCompareLine as FileDiffIcon } from '@mingcute/react'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'

import { ResizeHandle } from '~/components/layout/resize-handle'
import { Spinner } from '~/components/ui/spinner'

import type { CodeViewLineSelection, DiffData, ThreadAnnotation } from '../shared/diff-items'
import {
  buildItemsFromPatch,
  EMPTY_DIFF_DATA,
  formatSelectedReviewRange,
  getSelectedReviewRange,
} from '../shared/diff-items'
import { navigateToCommitView, navigateToGuideView, navigateToReviewsList } from '../shared/navigation'
import type { DiffStyle, ReviewFile, ReviewThread } from '../shared/types'
import { useReview } from '../shared/use-review'
import { AgentRail } from './agent-rail'
import type { DiffStageHandle } from './diff-stage'
import { DiffStage } from './diff-stage'
import { FileListAside } from './file-tree-aside'
import { OpenThreadsRail } from './open-threads-rail'
import { ReviewTopBar } from './review-top-bar'

interface ReviewDetailPageProps {
  workspaceId: string
  repositoryPath?: string | null
  reviewId: string
  initialPath?: string | null
  initialLine?: number
  initialSide?: 'base' | 'head'
}

export function ReviewDetailPage({
  workspaceId,
  repositoryPath,
  reviewId,
  initialPath,
  initialLine,
  initialSide,
}: ReviewDetailPageProps) {
  const {
    review,
    isLoading,
    isError,
    isFetching,
    refreshMutation,
    viewedMutation,
    createThreadMutation,
    replyMutation,
    resolveThreadMutation,
    submitMutation,
    closeReviewMutation,
    preferenceMutation,
    createAgentFixMutation,
    startAgentFixMutation,
    cancelAgentFixMutation,
    rerunAgentFixMutation,
    deleteAgentFixMutation,
  } = useReview({ workspaceId, repositoryPath, reviewId })

  const [diffStyle, setDiffStyle] = useState<DiffStyle>('split')
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
  const [selectedLineSelection, setSelectedLineSelection] = useState<CodeViewLineSelection | null>(null)
  const [composerAnchor, setComposerAnchor] = useState<CodeViewLineSelection | null>(null)
  const stageHandleRef = useRef<DiffStageHandle | null>(null)
  const pendingScrollRef = useRef<string | null>(initialPath ?? null)
  // Paired with initialPath: when present, mount-scroll targets a specific line (from a guide
  // "Open in review" deep link) instead of just the file header.
  const pendingLineRef = useRef<{ line: number, side: 'base' | 'head' } | null>(
    initialPath && initialLine ? { line: initialLine, side: initialSide ?? 'head' } : null,
  )

  // Panel widths — Linear-style: panels are resizable, the diff stays the protagonist.
  // Right rail auto-hides when there are no open threads so the diff gets the room.
  const [fileTreeWidth, setFileTreeWidth] = useState(256)
  const [threadsRailWidth, setThreadsRailWidth] = useState(320)
  const [threadsRailCollapsed, setThreadsRailCollapsed] = useState(false)
  const [railMode, setRailMode] = useState<'threads' | 'agent'>('threads')

  const files = useMemo(() => review?.files ?? [], [review?.files])
  const patch = review?.currentRevision?.patch ?? ''
  const deferredPatch = useDeferredValue(patch)

  const diffData: DiffData = useMemo(
    () => (deferredPatch.trim().length === 0 ? EMPTY_DIFF_DATA : buildItemsFromPatch(deferredPatch)),
    [deferredPatch],
  )

  const hideWhitespaceOnly = review?.preferences.hideWhitespaceOnly ?? false
  const collapseGeneratedFiles = review?.preferences.collapseGeneratedFiles ?? false

  const generatedPaths = useMemo(() => {
    const next = new Set<string>()
    for (const file of files) {
      if (file.isGenerated) {
        next.add(file.path)
        if (file.previousPath) {
          next.add(file.previousPath)
        }
      }
    }
    return next
  }, [files])

  const visibleFiles = useMemo(() => {
    if (!hideWhitespaceOnly && !collapseGeneratedFiles) {
      return files
    }
    return files.filter((file) => {
      if (collapseGeneratedFiles && file.isGenerated) {
        return false
      }
      return !hideWhitespaceOnly || !diffData.whitespaceOnlyPaths.has(file.path)
    })
  }, [collapseGeneratedFiles, diffData.whitespaceOnlyPaths, files, hideWhitespaceOnly])

  const visibleItems = useMemo(() => {
    if (!hideWhitespaceOnly && !collapseGeneratedFiles) {
      return diffData.items
    }
    return diffData.items.filter((item) => {
      if (item.type !== 'diff') {
        return true
      }
      const generated = generatedPaths.has(item.fileDiff.name)
        || (item.fileDiff.prevName ? generatedPaths.has(item.fileDiff.prevName) : false)
      if (collapseGeneratedFiles && generated) {
        return false
      }
      return !hideWhitespaceOnly || !diffData.whitespaceOnlyPaths.has(item.fileDiff.name)
    })
  }, [collapseGeneratedFiles, diffData.items, diffData.whitespaceOnlyPaths, generatedPaths, hideWhitespaceOnly])

  const visiblePathToItemId = useMemo(() => {
    if (!hideWhitespaceOnly && !collapseGeneratedFiles) {
      return diffData.pathToItemId
    }
    const next = new Map<string, string>()
    for (const [path, itemId] of diffData.pathToItemId) {
      if (
        (!collapseGeneratedFiles || !generatedPaths.has(path))
        && (!hideWhitespaceOnly || !diffData.whitespaceOnlyPaths.has(path))
      ) {
        next.set(path, itemId)
      }
    }
    return next
  }, [collapseGeneratedFiles, diffData.pathToItemId, diffData.whitespaceOnlyPaths, generatedPaths, hideWhitespaceOnly])

  const selectedRange = useMemo(
    () => getSelectedReviewRange(selectedLineSelection, files, diffData.itemIdToPath),
    [diffData.itemIdToPath, files, selectedLineSelection],
  )
  const selectedAgentAnchor = selectedRange
    ? {
        fileId: selectedRange.file.id,
        side: selectedRange.side,
        startLine: selectedRange.startLine,
        endLine: selectedRange.endLine,
      }
    : null
  const selectedAgentLabel = selectedRange ? formatSelectedReviewRange(selectedRange) : null

  useEffect(() => {
    if (review?.preferences.diffStyle) {
      setDiffStyle(review.preferences.diffStyle)
    }
  }, [review?.preferences.diffStyle])

  useEffect(() => {
    if (!selectedFileId && visibleFiles.length > 0) {
      setSelectedFileId(visibleFiles[0]!.id)
    }
    else if (selectedFileId && !visibleFiles.some(file => file.id === selectedFileId)) {
      setSelectedFileId(visibleFiles[0]?.id ?? null)
      setSelectedLineSelection(null)
    }
  }, [selectedFileId, visibleFiles])

  useEffect(() => {
    if (visibleItems.length === 0 || !pendingScrollRef.current) {
      return
    }
    const path = pendingScrollRef.current
    pendingScrollRef.current = null
    const lineTarget = pendingLineRef.current
    pendingLineRef.current = null
    if (lineTarget) {
      stageHandleRef.current?.scrollToLine(path, lineTarget.line, lineTarget.side)
    }
    else {
      stageHandleRef.current?.scrollToPath(path)
    }
  }, [visibleItems])

  const selectFile = (file: ReviewFile) => {
    setSelectedFileId(file.id)
    setSelectedLineSelection(null)
    stageHandleRef.current?.scrollToPath(file.path)
  }

  const jumpToThread = (thread: ReviewThread) => {
    stageHandleRef.current?.scrollToThread(thread)
  }

  const askAgentForThread = (threadId: string) => {
    createAgentFixMutation.mutate({
      threadId,
      instruction: 'Address this review thread.',
      expectedOutput: 'working-tree-change',
    }, {
      onSuccess: () => {
        setRailMode('agent')
        setThreadsRailCollapsed(false)
      },
    })
  }

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center" data-testid="review-detail-loading">
        <Spinner className="size-4 !text-muted-foreground/40" aria-hidden />
      </div>
    )
  }

  if (isError || !review) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center" data-testid="review-detail-error">
        <FileDiffIcon className="size-5 !text-muted-foreground/30" aria-hidden />
        <p className="text-[12px] text-muted-foreground">Review unavailable</p>
      </div>
    )
  }

  const hiddenWhitespaceFileCount = hideWhitespaceOnly
    ? files.filter(file => (!collapseGeneratedFiles || !file.isGenerated) && diffData.whitespaceOnlyPaths.has(file.path)).length
    : 0
  const hiddenGeneratedFileCount = collapseGeneratedFiles ? files.filter(file => file.isGenerated).length : 0

  const openThreadCount = review.threads.filter(thread => thread.state !== 'resolved').length
  const showRightRail = !threadsRailCollapsed

  return (
    <div className="flex h-full w-full min-h-0 flex-col overflow-hidden" data-testid="review-detail-page">
      <ReviewTopBar
        review={review}
        diffStyle={diffStyle}
        onDiffStyleChange={(style) => {
          setDiffStyle(style)
          preferenceMutation.mutate({ diffStyle: style })
        }}
        onPreference={input => preferenceMutation.mutate(input)}
        preferencePending={preferenceMutation.isPending}
        onSubmit={(decision, bodyMarkdown) => submitMutation.mutate({ decision, bodyMarkdown })}
        submitPending={submitMutation.isPending}
        onCloseReview={() => closeReviewMutation.mutate(undefined, {
          onSuccess: () => navigateToReviewsList(workspaceId, repositoryPath),
        })}
        closeReviewPending={closeReviewMutation.isPending}
        onRefresh={() => refreshMutation.mutate()}
        refreshPending={refreshMutation.isPending}
        isFetching={isFetching}
        onOpenGuide={() => navigateToGuideView(workspaceId, review.id, repositoryPath)}
        hasGuide={review.guide.steps.length > 0}
        onOpenCommit={() => navigateToCommitView(workspaceId, review.id, repositoryPath)}
        hasCommitPlan={review.commitPlans.length > 0}
        threadsRailCollapsed={threadsRailCollapsed}
        agentRailActive={!threadsRailCollapsed && railMode === 'agent'}
        onShowThreadsRail={() => {
          setRailMode('threads')
          setThreadsRailCollapsed(value => railMode === 'threads' ? !value : false)
        }}
        onShowAgentRail={() => {
          setRailMode('agent')
          setThreadsRailCollapsed(value => railMode === 'agent' ? !value : false)
        }}
        openThreadCount={openThreadCount}
        agentFixCount={review.agentFixes.length}
      />

      <div className="flex min-h-0 flex-1">
        <FileListAside
          visibleFiles={visibleFiles}
          selectedFileId={selectedFileId}
          onSelectFile={selectFile}
          onToggleViewed={file => viewedMutation.mutate({ fileId: file.id, viewed: !file.isViewed })}
          viewedPending={viewedMutation.isPending}
          hiddenWhitespaceFileCount={hiddenWhitespaceFileCount}
          hiddenGeneratedFileCount={hiddenGeneratedFileCount}
          width={fileTreeWidth}
        />

        <ResizeHandle
          direction="horizontal"
          value={fileTreeWidth}
          onChange={setFileTreeWidth}
          min={200}
          max={420}
          className="w-1.25 h-full"
        />

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <DiffStage
            review={review}
            diffData={diffData}
            visibleItems={visibleItems as CodeViewItem<ThreadAnnotation>[]}
            visiblePathToItemId={visiblePathToItemId}
            diffStyle={diffStyle}
            selectedLineSelection={selectedLineSelection}
            onSelectLines={setSelectedLineSelection}
            onFileFromSelection={setSelectedFileId}
            composerAnchor={composerAnchor}
            onComposerOpen={setComposerAnchor}
            onComposerClose={() => setComposerAnchor(null)}
            onCreateThread={(input) => {
              createThreadMutation.mutate({
                fileId: input.fileId,
                anchor: { fileId: input.anchor.fileId, side: input.anchor.side, startLine: input.anchor.startLine, endLine: input.anchor.endLine },
                bodyMarkdown: input.bodyMarkdown,
              })
              setComposerAnchor(null)
              setSelectedLineSelection(null)
            }}
            createPending={createThreadMutation.isPending}
            onReply={(threadId, body) => replyMutation.mutate({ threadId, bodyMarkdown: body })}
            replyPending={replyMutation.isPending}
            onResolve={threadId => resolveThreadMutation.mutate(threadId)}
            resolvePending={resolveThreadMutation.isPending}
            onAskAgentForThread={askAgentForThread}
            files={files}
            handleRef={handle => stageHandleRef.current = handle}
          />
        </main>

        {showRightRail && (
          <>
            <ResizeHandle
              direction="horizontal"
              value={threadsRailWidth}
              onChange={setThreadsRailWidth}
              min={240}
              max={480}
              inverted
              className="w-1.25 h-full"
            />
            {railMode === 'agent'
              ? (
                  <AgentRail
                    review={review}
                    selectedAnchor={selectedAgentAnchor}
                    selectedLabel={selectedAgentLabel}
                    createPending={createAgentFixMutation.isPending}
                    startPending={startAgentFixMutation.isPending}
                    cancelPending={cancelAgentFixMutation.isPending}
                    rerunPending={rerunAgentFixMutation.isPending}
                    deletePending={deleteAgentFixMutation.isPending}
                    onCreate={input => createAgentFixMutation.mutateAsync(input)}
                    onStart={input => startAgentFixMutation.mutateAsync(input)}
                    onCancel={agentFixId => cancelAgentFixMutation.mutate(agentFixId)}
                    onRerun={input => rerunAgentFixMutation.mutateAsync(input)}
                    onDelete={agentFixId => deleteAgentFixMutation.mutate(agentFixId)}
                    onCollapse={() => setThreadsRailCollapsed(true)}
                    width={threadsRailWidth}
                  />
                )
              : (
                  <OpenThreadsRail
                    review={review}
                    files={files}
                    onJumpToThread={jumpToThread}
                    onResolve={threadId => resolveThreadMutation.mutate(threadId)}
                    resolvePending={resolveThreadMutation.isPending}
                    onAskAgent={askAgentForThread}
                    onCollapse={() => setThreadsRailCollapsed(true)}
                    width={threadsRailWidth}
                  />
                )}
          </>
        )}
      </div>
    </div>
  )
}
