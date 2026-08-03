import {
  CloseLine as CloseIcon,
  ExternalLinkLine as ExternalLinkIcon,
  GitCompareLine as FileDiffIcon,
} from '@mingcute/react'
import type { CodeViewItem } from '@pierre/diffs'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { DiffData } from '~/components/common/diff/diff-data'
import { buildDiffData, emptyDiffData } from '~/components/common/diff/diff-data'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'

import { ReviewDetailView } from '../review/review-detail-view'
import type { CodeViewLineSelection, ThreadAnnotation } from '../shared/diff-items'
import {
  formatSelectedReviewRange,
  getSelectedReviewRange,
} from '../shared/diff-items'
import { navigateToReviewsList } from '../shared/navigation'
import type { DiffStyle, ReviewFile, ReviewThread } from '../shared/types'
import { useReview } from '../shared/use-review'
import { AgentRail } from './agent-rail'
import type { DiffStageHandle } from './diff-stage'
import { DiffStage } from './diff-stage'
import { GitHubReviewContext } from './github-review-context'
import { OpenThreadsRail } from './open-threads-rail'
import { DisplayPopover, ReviewPopover } from './review-top-bar'

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
  const { t } = useTranslation('diff-review')
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
    mergeMutation,
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

  const [overviewCollapsed, setOverviewCollapsed] = useState(false)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [railMode, setRailMode] = useState<'threads' | 'agent'>('threads')

  const files = useMemo(() => review?.files ?? [], [review?.files])
  const patch = review?.currentRevision?.patch ?? ''
  const deferredPatch = useDeferredValue(patch)

  const diffData: DiffData<ThreadAnnotation> = useMemo(
    () => (deferredPatch.trim().length === 0
      ? emptyDiffData<ThreadAnnotation>()
      : buildDiffData<ThreadAnnotation>(deferredPatch)),
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

  const selectFile = (file: ReviewFile) => {
    setSelectedFileId(file.id)
    setSelectedLineSelection(null)
    stageHandleRef.current?.scrollToPath(file.path)
  }

  // Keep review navigation keyboard-first, matching the dense browsing workflow users expect
  // from Linear-style review surfaces. Shortcuts are ignored while editing a text control.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target?.tagName === 'INPUT'
        || target?.tagName === 'TEXTAREA'
        || target?.isContentEditable
      if (!typing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        const nextStyle = diffStyle === 'split' ? 'unified' : 'split'
        setDiffStyle(nextStyle)
        preferenceMutation.mutate({ diffStyle: nextStyle })
        return
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) {
        return
      }
      if (event.key === 'Escape') {
        if (composerAnchor || selectedLineSelection) {
          event.preventDefault()
          setComposerAnchor(null)
          setSelectedLineSelection(null)
          return
        }
        if (overlayOpen) {
          event.preventDefault()
          setOverlayOpen(false)
        }
        return
      }
      if (visibleFiles.length === 0) {
        return
      }
      const currentIndex = selectedFileId
        ? visibleFiles.findIndex(file => file.id === selectedFileId)
        : -1
      const direction = event.key === 'j' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'k' || event.key === 'ArrowUp'
          ? -1
          : 0
      if (direction === 0) {
        return
      }
      const nextIndex = Math.min(Math.max(currentIndex + direction, 0), visibleFiles.length - 1)
      const nextFile = visibleFiles[nextIndex]
      if (!nextFile || nextIndex === currentIndex) {
        return
      }
      event.preventDefault()
      selectFile(nextFile)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    composerAnchor,
    diffStyle,
    overlayOpen,
    preferenceMutation,
    selectedFileId,
    selectedLineSelection,
    visibleFiles,
  ])

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
        setOverlayOpen(true)
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
  const hiddenFileCount = hiddenWhitespaceFileCount + hiddenGeneratedFileCount

  const canCloseReview = review.status === 'open'
    && review.sourceKind !== 'local-working-tree'
    && review.sourceKind !== 'github-pull-request'

  const showOverlay = overlayOpen
  const agentOpen = showOverlay && railMode === 'agent'

  return (
    <div className="h-full w-full min-h-0" data-testid="review-detail-page">
      <ReviewDetailView
        review={review}
        files={visibleFiles}
        hiddenFileCount={hiddenFileCount}
        selectedFileId={selectedFileId}
        onSelectFile={selectFile}
        onToggleViewed={file => viewedMutation.mutate({ fileId: file.id, viewed: !file.isViewed })}
        diffStyle={diffStyle}
        onDiffStyleChange={(style) => {
          setDiffStyle(style)
          preferenceMutation.mutate({ diffStyle: style })
        }}
        overviewCollapsed={overviewCollapsed}
        onToggleOverview={() => setOverviewCollapsed(value => !value)}
        onBack={() => navigateToReviewsList(workspaceId, repositoryPath)}
        onRefresh={() => refreshMutation.mutate()}
        refreshPending={refreshMutation.isPending || isFetching}
        onSubmit={decision => submitMutation.mutate({ decision, bodyMarkdown: '' })}
        submitPending={submitMutation.isPending}
        threadsOpen={showOverlay}
        onToggleThreads={() => {
          if (showOverlay && railMode === 'threads') {
            setOverlayOpen(false)
            return
          }
          setRailMode('threads')
          setOverlayOpen(true)
        }}
        agentOpen={agentOpen}
        onToggleAgent={() => {
          if (showOverlay && railMode === 'agent') {
            setOverlayOpen(false)
            return
          }
          setRailMode('agent')
          setOverlayOpen(true)
        }}
        agentFixCount={review.agentFixes.length}
        extraActions={(
          <>
            <DisplayPopover
              hideWhitespaceOnly={review.preferences.hideWhitespaceOnly}
              structuralHighlighting={review.preferences.structuralHighlighting}
              collapseGeneratedFiles={review.preferences.collapseGeneratedFiles}
              pending={preferenceMutation.isPending}
              onToggleWhitespace={() => preferenceMutation.mutate({
                hideWhitespaceOnly: !review.preferences.hideWhitespaceOnly,
              })}
              onToggleStructural={() => preferenceMutation.mutate({
                structuralHighlighting: !review.preferences.structuralHighlighting,
              })}
              onToggleGenerated={() => preferenceMutation.mutate({
                collapseGeneratedFiles: !review.preferences.collapseGeneratedFiles,
              })}
            />
            {review.githubPullRequest && (
              <GitHubReviewContext
                pullRequest={review.githubPullRequest}
                onMerge={method => mergeMutation.mutate(method)}
                mergePending={mergeMutation.isPending}
              />
            )}
            {review.githubPullRequest && (
              <Button variant="ghost" size="icon" className="size-7" asChild>
                <a
                  href={`https://github.com/${review.githubPullRequest.owner}/${review.githubPullRequest.repo}/pull/${review.githubPullRequest.number}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={t('review.github.open')}
                  title={t('review.github.open')}
                >
                  <ExternalLinkIcon className="size-3.5" />
                </a>
              </Button>
            )}
            {canCloseReview
              ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-[12px] text-muted-foreground hover:text-foreground"
                    onClick={() => closeReviewMutation.mutate(undefined, {
                      onSuccess: () => navigateToReviewsList(workspaceId, repositoryPath),
                    })}
                    disabled={closeReviewMutation.isPending}
                  >
                    <CloseIcon className="size-3.5" />
                    Close
                  </Button>
                )
              : null}
          </>
        )}
        submitControl={(
          <ReviewPopover
            pending={submitMutation.isPending}
            state={review.reviewState}
            requireBodyForFeedback={review.sourceKind === 'github-pull-request'}
            onSubmit={(decision, bodyMarkdown) => submitMutation.mutate({ decision, bodyMarkdown })}
          />
        )}
        diffSlot={(
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
                anchor: {
                  fileId: input.anchor.fileId,
                  side: input.anchor.side,
                  startLine: input.anchor.startLine,
                  endLine: input.anchor.endLine,
                },
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
        )}
        threadsSlot={showOverlay
          ? (
              railMode === 'agent'
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
                      onCollapse={() => setOverlayOpen(false)}
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
                      onCollapse={() => setOverlayOpen(false)}
                    />
                  )
            )
          : undefined}
      />
    </div>
  )
}
