import { Streamdown } from '@cradle/streamdown'
import {
  AnticlockwiseLine as RotateCcwIcon,
  ArrowLeftLine as ArrowLeftIcon,
  DownSmallLine as ChevronDownIcon,
  ExternalLinkLine as ExternalLinkIcon,
  GitCompareLine as FileDiffIcon,
  RightSmallLine as ChevronRightIcon,
  TreeLine as ListTreeIcon,
} from '@mingcute/react'
import type { CodeViewItem, FileDiffMetadata } from '@pierre/diffs'
import type { CodeViewHandle } from '@pierre/diffs/react'
import { CodeView } from '@pierre/diffs/react'
import type { CSSProperties } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { DiffData } from '~/components/common/diff/diff-data'
import { buildDiffData, emptyDiffData } from '~/components/common/diff/diff-data'
import { buildDiffOptions } from '~/components/common/diff/diff-options'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { cn } from '~/lib/cn'
import { STREAMDOWN_RENDER_OPTIONS } from '~/store/streamdown'

import type { CodeViewLineSelection, ThreadAnnotation } from '../shared/diff-items'
import {
  anchorToLineSelection,
  formatAnchorRange,
  guideAnchorsForPath,
} from '../shared/diff-items'
import { isGuideReady } from '../shared/guide-insights'
import { navigateToReview, navigateToReviewAtAnchor } from '../shared/navigation'
import type { GenerateGuideInput, ReviewFile, ReviewGuideAnchor, ReviewGuideStep, ReviewThread } from '../shared/types'
import { useReview } from '../shared/use-review'
import {
  GuideGenerateGate,
  GuideRegenBanner,
  ProvenanceLine,
} from './guide-shared'

interface GuideViewProps {
  workspaceId: string
  repositoryPath?: string | null
  reviewId: string
  onBack: () => void
}

export function GuideView({ workspaceId, repositoryPath, reviewId, onBack }: GuideViewProps) {
  const { review, isLoading, generateGuideMutation, cancelGuideMutation } = useReview({ workspaceId, repositoryPath, reviewId })
  const [regenerating, setRegenerating] = useState(false)
  // Snapshot of the last ready guide so the reader can keep reading the old walkthrough while a
  // regenerate runs. The server wipes steps to 'running' immediately on force, so without this the
  // reading view would blank out mid-regen. Updated whenever a fresh ready guide arrives.
  const previousGuideRef = useRef<NonNullable<ReturnType<typeof useReview>['review']>['guide'] | null>(null)

  const handleGenerate = (input: GenerateGuideInput) => {
    generateGuideMutation.mutate(input)
  }

  useEffect(() => {
    if (!review) {
      return
    }
    if (review.guide.status === 'ready' && review.guide.steps.length > 0) {
      previousGuideRef.current = review.guide
    }
    if (review.guide.status === 'ready') {
      setRegenerating(false)
    }
  }, [review])

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center" data-testid="guide-loading">
        <Spinner className="size-4 !text-muted-foreground/40" aria-hidden />
      </div>
    )
  }

  if (!review) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center">
        <p className="text-xs text-muted-foreground">Review unavailable</p>
        <Button variant="outline" size="sm" onClick={onBack}>Back</Button>
      </div>
    )
  }

  const guideFailed = review.guide.status === 'failed'
  const hasGuide = isGuideReady(review)
  const hasSnapshot = previousGuideRef.current != null
  // While regenerating with a snapshot, keep the old guide readable under a slim banner instead
  // of swapping to the full generation gate. Falls back to the gate if there's no snapshot yet
  // or if the regen failed.
  const showReadingFromSnapshot = regenerating && hasSnapshot && !guideFailed
  const showReading = (hasGuide && !regenerating) || showReadingFromSnapshot
  const showGate = !showReading
  const reviewForReading = showReadingFromSnapshot && previousGuideRef.current
    ? { ...review, guide: previousGuideRef.current }
    : review

  return (
    <div className="flex h-full w-full min-h-0 flex-col overflow-hidden" data-testid="guide-view">
      <header className="flex h-11 shrink-0 items-center gap-3 px-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 text-xs">
          <ArrowLeftIcon className="size-3.5" />
          Back to review
        </Button>
        <div className="h-4 w-px bg-border" />
        <ListTreeIcon className="size-3.5 !text-muted-foreground/60" aria-hidden />
        <h1 className="text-sm font-medium text-foreground">Guide</h1>
        {hasGuide && (
          <span className="rounded-full bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
            generated
          </span>
        )}
        {hasGuide && !regenerating && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto gap-1.5 text-xs text-muted-foreground"
            onClick={() => setRegenerating(true)}
            disabled={generateGuideMutation.isPending}
          >
            <RotateCcwIcon className="size-3.5" />
            Regenerate
          </Button>
        )}
      </header>

      {showGate
        ? (
            <GuideGenerateGate
              review={review}
              force={regenerating}
              pending={generateGuideMutation.isPending}
              cancelling={cancelGuideMutation.isPending}
              requestError={generateGuideMutation.error}
              onCancel={regenerating ? () => setRegenerating(false) : undefined}
              onCancelGeneration={() => cancelGuideMutation.mutate()}
              onGenerate={handleGenerate}
            />
          )
        : showReadingFromSnapshot
          ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <GuideRegenBanner
                  review={review}
                  cancelPending={cancelGuideMutation.isPending}
                  onCancel={() => cancelGuideMutation.mutate()}
                />
                <GuideReading review={reviewForReading} />
              </div>
            )
          : <GuideReading review={reviewForReading} />}
    </div>
  )
}

function GuideReading({
  review,
}: {
  review: NonNullable<ReturnType<typeof useReview>['review']>
}) {
  const steps = review.guide.steps
  const guideTitle = review.guide.title
  const files = review.files
  const fileById = useMemo(() => new Map(files.map(file => [file.id, file])), [files])
  const pathToFile = useMemo(() => new Map(files.map(file => [file.path, file])), [files])
  const threadById = useMemo(() => new Map(review.threads.map(thread => [thread.id, thread])), [review.threads])

  const diffData: DiffData<ThreadAnnotation> = useMemo(
    () => (review.currentRevision?.patch?.trim()
      ? buildDiffData<ThreadAnnotation>(review.currentRevision.patch)
      : emptyDiffData<ThreadAnnotation>()),
    [review.currentRevision?.patch],
  )

  // Jump from a guide anchor (or thread) into the review detail at that line. Drops the guide
  // view and lands on the file + line so the reader can see the full diff context.
  const handleOpenInReview = (path?: string, line?: number, side?: 'base' | 'head') => {
    if (path && line != null) {
      navigateToReviewAtAnchor(review.workspaceId, review.id, { repositoryPath: review.repositoryPath, path, line, side: side ?? 'head' })
    }
    else if (path) {
      navigateToReview(review.workspaceId, review.id, { repositoryPath: review.repositoryPath, path })
    }
    else {
      navigateToReview(review.workspaceId, review.id, { repositoryPath: review.repositoryPath })
    }
  }

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [activeChapterId, setActiveChapterId] = useState<string | null>(steps[0]?.id ?? null)

  // Scrollspy: the topmost section entering the container's upper ~40% becomes the active chapter.
  // Re-runs when steps identity changes (e.g. after a regenerate swaps in a new chapter set).
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container || steps.length === 0) {
      return
    }
    const sections = steps
      .map(step => document.getElementById(step.id))
      .filter((el): el is HTMLElement => el !== null)
    if (sections.length === 0) {
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter(entry => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) {
          setActiveChapterId(visible[0].target.id)
        }
      },
      { root: container, rootMargin: '0px 0px -60% 0px', threshold: 0 },
    )
    for (const section of sections) {
      observer.observe(section)
    }
    return () => observer.disconnect()
  }, [steps])

  const handleJump = (chapterId: string) => {
    document.getElementById(chapterId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="flex min-h-0 flex-1">
      <GuideChapterRail
        steps={steps}
        activeChapterId={activeChapterId}
        onJump={handleJump}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <GuideChapterScroller
          steps={steps}
          activeChapterId={activeChapterId}
          onJump={handleJump}
        />
        <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto bg-background">
          <article className="mx-auto max-w-6xl px-8 py-10 lg:px-12 lg:py-14">
            <header className="mb-12 border-b border-border/60 pb-6">
              <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-muted-foreground/60">
                Guided review
              </p>
              <h2 className="mt-2 text-2xl font-semibold leading-tight tracking-tight text-foreground">
                {guideTitle ?? review.title}
              </h2>
              {!guideTitle && (
                <p className="mt-1 text-[11px] text-muted-foreground/50">
                  {review.title}
                </p>
              )}
              <p className="mt-2 text-[12px] tabular-nums text-muted-foreground">
                {steps.length}
                {' '}
                chapter
                {steps.length === 1 ? '' : 's'}
              </p>
              <ProvenanceLine guide={review.guide} fileCount={review.currentRevision?.fileCount} />
            </header>

            <div className="space-y-14">
              {steps.map((step, index) => (
                <GuideSection
                  key={step.id}
                  step={step}
                  index={index}
                  fileById={fileById}
                  pathToFile={pathToFile}
                  diffData={diffData}
                  preferences={review.preferences}
                  threadById={threadById}
                  onOpenInReview={handleOpenInReview}
                />
              ))}
            </div>
          </article>
        </div>
      </div>
    </div>
  )
}

/**
 * Persistent vertical chapter index, shown on `xl` and up where the viewport has room for a
 * dedicated rail. Tracks the active chapter via scrollspy and jumps on click.
 */
function GuideChapterRail({
  steps,
  activeChapterId,
  onJump,
}: {
  steps: ReviewGuideStep[]
  activeChapterId: string | null
  onJump: (chapterId: string) => void
}) {
  if (steps.length <= 1) {
    return null
  }
  return (
    <nav
      aria-label="Guide chapters"
      className="hidden w-68 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border/40 px-3 py-8 xl:flex"
    >
      <p className="px-2 pb-2 text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground/50">
        Chapters
      </p>
      {steps.map((step, index) => {
        const active = step.id === activeChapterId
        return (
          <button
            key={step.id}
            type="button"
            onClick={() => onJump(step.id)}
            className={cn(
              'flex items-start gap-2 rounded-md px-2 py-1.5 text-left text-[12px] leading-snug transition-colors',
              active
                ? 'bg-muted/60 text-foreground'
                : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
            )}
          >
            <span className={cn(
              'mt-px shrink-0 font-mono text-[10px] tabular-nums',
              active ? 'text-orange-600 dark:text-orange-400' : 'text-muted-foreground/50',
            )}
            >
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className="line-clamp-2">{step.title}</span>
          </button>
        )
      })}
    </nav>
  )
}

/**
 * Compact horizontal chapter scroller for narrow viewports (below `xl`). Stays pinned above the
 * reading column so the active chapter is always reachable while scrolling.
 */
function GuideChapterScroller({
  steps,
  activeChapterId,
  onJump,
}: {
  steps: ReviewGuideStep[]
  activeChapterId: string | null
  onJump: (chapterId: string) => void
}) {
  if (steps.length <= 1) {
    return null
  }
  return (
    <div className="border-b border-border/40 bg-background/85 backdrop-blur xl:hidden">
      <div className="flex items-center gap-1.5 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {steps.map((step, index) => {
          const active = step.id === activeChapterId
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => onJump(step.id)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
                active
                  ? 'bg-orange-500/15 text-orange-700 dark:text-orange-300'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <span className="font-mono tabular-nums opacity-60">{String(index + 1).padStart(2, '0')}</span>
              <span className="max-w-32 truncate">{step.title}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * One chapter rendered as a horizontal card: the narrative on the left, the chapter's file group on
 * the right. Each file in the group is a collapsed block by default and expands into its diff.
 */
function GuideSection({
  step,
  index,
  fileById,
  pathToFile,
  diffData,
  preferences,
  threadById,
  onOpenInReview,
}: {
  step: ReviewGuideStep
  index: number
  fileById: Map<string, ReviewFile>
  pathToFile: Map<string, ReviewFile>
  diffData: DiffData<ThreadAnnotation>
  preferences: NonNullable<ReturnType<typeof useReview>['review']>['preferences']
  threadById: Map<string, ReviewThread>
  onOpenInReview: (path?: string, line?: number, side?: 'base' | 'head') => void
}) {
  // Resolve this chapter's files into CodeView items.
  const fileItems = useMemo(() => {
    const seen = new Set<string>()
    const items: CodeViewItem<ThreadAnnotation>[] = []
    for (const fileId of step.fileIds) {
      const file = fileById.get(fileId)
      if (!file) {
        continue
      }
      const itemId = diffData.pathToItemId.get(file.path)
      if (!itemId || seen.has(itemId)) {
        continue
      }
      seen.add(itemId)
      const base = diffData.items.find(i => i.id === itemId)
      if (base) {
        items.push(base)
      }
    }
    return items
  }, [step.fileIds, fileById, diffData])

  // Per-section expansion state, keyed by item id. Files render as lightweight collapsed blocks
  // by default; a CodeView is mounted only for a file the reader actually expands. This avoids
  // keeping one full CodeView instance (virtualizer, interaction manager, ResizeObserver, worker
  // highlighter, scroll listeners) alive per chapter on a long scrolling page.
  //
  // The primary anchored file auto-expands so the reader lands on the relevant code without an
  // extra click. GuideSection is keyed by step.id at the parent, so this initializer re-runs per
  // chapter.
  const [expandedFileIds, setExpandedFileIds] = useState<Set<string>>(() => {
    const primary = step.anchors[0]
    if (!primary) {
      return new Set()
    }
    const itemId = diffData.pathToItemId.get(primary.path)
    return itemId ? new Set([itemId]) : new Set()
  })

  const options = useMemo(
    () => buildDiffOptions<ThreadAnnotation>('unified', {
      controlledSelection: true,
      enableGutterUtility: true,
      enableLineSelection: true,
    }),
    [],
  )

  const diffStyleVars = {
    '--diffs-font-size': `${preferences.fontSize ?? 12}px`,
    '--diffs-line-height': `${preferences.lineHeight ?? 18}px`,
  } as CSSProperties

  const toggleFile = (itemId: string) => {
    setExpandedFileIds((current) => {
      const next = new Set(current)
      if (next.has(itemId)) {
        next.delete(itemId)
      }
      else {
        next.add(itemId)
      }
      return next
    })
  }

  const hasFiles = step.fileIds.length > 0
  const hasThreads = step.threadIds.length > 0

  return (
    <section id={step.id} className="grid grid-cols-1 gap-8 scroll-mt-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Narrative */}
      <div className="relative pl-12">
        <span className="pointer-events-none absolute left-0 top-0 select-none font-mono text-2xl font-semibold leading-none text-muted-foreground/25 tabular-nums">
          {String(index + 1).padStart(2, '0')}
        </span>
        <h3 className="text-base font-semibold leading-snug tracking-tight text-foreground">
          {step.title}
        </h3>
        <Streamdown
          content={step.rationale}
          streaming={false}
          animationPreset={STREAMDOWN_RENDER_OPTIONS.animationPreset}
          animateMode={STREAMDOWN_RENDER_OPTIONS.animateMode}
          showCursor={false}
          className="mt-3 text-[14px] leading-[1.75] text-foreground/85"
        />

        {(hasFiles || hasThreads) && (
          <footer className="mt-4 border-t border-dashed border-border/70 pt-2.5">
            <ol className="space-y-1 text-[11px] leading-relaxed text-muted-foreground">
              {hasFiles && (
                <li className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
                  <FootnoteMark />
                  <span className="text-muted-foreground/70">Files touched:</span>
                  {step.fileIds.map((fileId) => {
                    const file = fileById.get(fileId)
                    return file
                      ? <span key={fileId} className="font-mono text-[10px] text-foreground/70">{file.path}</span>
                      : null
                  })}
                </li>
              )}
              {hasThreads && (
                <li className="flex flex-wrap items-center gap-1.5">
                  <FootnoteMark />
                  <span className="text-muted-foreground/70">Threads:</span>
                  {step.threadIds.map((threadId) => {
                    const thread = threadById.get(threadId)
                    if (!thread) {
                      return null
                    }
                    const commentCount = thread.comments.length
                    return (
                      <button
                        key={threadId}
                        type="button"
                        onClick={() => onOpenInReview(
                          thread.anchor?.path,
                          thread.anchor?.startLine,
                          thread.anchor?.side,
                        )}
                        className="inline-flex items-center gap-1 rounded-full bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        title={`Open in review · ${commentCount} comment${commentCount === 1 ? '' : 's'}`}
                      >
                        <span
                          className={cn(
                            'size-1.5 rounded-full',
                            thread.state === 'resolved'
                              ? 'bg-emerald-500'
                              : thread.state === 'stale'
                                ? 'bg-amber-500'
                                : 'bg-sky-500',
                          )}
                          aria-hidden
                        />
                        <span className="tabular-nums">{commentCount}</span>
                      </button>
                    )
                  })}
                </li>
              )}
            </ol>
          </footer>
        )}
      </div>

      {/* File group: collapsed blocks by default; a bounded CodeView mounts only for expanded files. */}
      <div className="min-h-0 max-h-128 overflow-y-auto [overflow-anchor:none] space-y-2">
        {fileItems.length === 0
          ? (
              <div className="flex h-full items-center justify-center p-4 text-center">
                <p className="text-xs text-muted-foreground">No code attached to this chapter.</p>
              </div>
            )
          : fileItems.map((item) => {
              if (item.type !== 'diff') {
                return null
              }
              const file = pathToFile.get(item.fileDiff.name) ?? null
              const fileAnchors = guideAnchorsForPath(step.anchors, item.fileDiff.name)
              const focusLabel = fileAnchors[0] ? formatAnchorRange(fileAnchors[0]) : null
              const expanded = expandedFileIds.has(item.id)
              return (
                <div key={item.id} className="rounded-lg border border-border/60">
                  <CollapsedFileBlock
                    fileDiff={item.fileDiff}
                    file={file}
                    focusLabel={focusLabel}
                    anchorCount={fileAnchors.length}
                    expanded={expanded}
                    onToggle={() => toggleFile(item.id)}
                  />
                  {expanded && (
                    <GuideFileCodeView
                      item={item}
                      anchors={step.anchors}
                      options={options}
                      diffStyleVars={diffStyleVars}
                      onOpenInReview={onOpenInReview}
                    />
                  )}
                </div>
              )
            })}
      </div>
    </section>
  )
}

/**
 * The expanded diff for one file in a chapter. Mounts a single-file CodeView and highlights the
 * chapter's active anchor range for this file as the controlled selection, centering it on mount.
 * When a chapter has multiple anchors in the same file, a pill switcher above the CodeView lets
 * the reader move between them — each pill re-sets the controlled selection and re-centers.
 */
function GuideFileCodeView({
  item,
  anchors,
  options,
  diffStyleVars,
  onOpenInReview,
}: {
  item: Extract<CodeViewItem<ThreadAnnotation>, { type: 'diff' }>
  anchors: ReviewGuideAnchor[]
  options: ReturnType<typeof buildDiffOptions<ThreadAnnotation>>
  diffStyleVars: CSSProperties
  onOpenInReview: (path?: string, line?: number, side?: 'base' | 'head') => void
}) {
  const viewerRef = useRef<CodeViewHandle<ThreadAnnotation>>(null)
  const fileAnchors = useMemo(
    () => guideAnchorsForPath(anchors, item.fileDiff.name),
    [anchors, item.fileDiff.name],
  )
  const [activeAnchorIndex, setActiveAnchorIndex] = useState(0)
  const activeAnchor = fileAnchors[activeAnchorIndex] ?? fileAnchors[0] ?? null

  const selectedLines = useMemo<CodeViewLineSelection | null>(
    () => activeAnchor ? anchorToLineSelection(item.id, activeAnchor) : null,
    [activeAnchor, item.id],
  )

  // Center the active anchor range whenever it changes. Two rAFs on first mount let the freshly
  // mounted CodeView measure its virtual window before we ask it to scroll; subsequent pill
  // clicks reuse the same path and just re-center on the new range.
  useEffect(() => {
    if (!selectedLines) {
      return
    }
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        viewerRef.current?.scrollTo({
          type: 'range',
          id: item.id,
          range: selectedLines.range,
          align: 'center',
          behavior: 'instant',
        })
      })
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [item.id, selectedLines])

  return (
    <div className="flex flex-col">
      {fileAnchors.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border/40 px-3 py-2">
          {fileAnchors.length > 1 && fileAnchors.map((anchor, index) => {
            const active = index === activeAnchorIndex
            return (
              <button
                key={`${anchor.side}-${anchor.startLine}-${anchor.endLine}`}
                type="button"
                onClick={() => setActiveAnchorIndex(index)}
                className={cn(
                  'rounded-full px-2 py-0.5 font-mono text-[10px] font-medium transition-colors',
                  active
                    ? 'bg-orange-500/15 text-orange-700 dark:text-orange-300'
                    : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {formatAnchorRange(anchor)}
              </button>
            )
          })}
          <button
            type="button"
            onClick={() => activeAnchor && onOpenInReview(item.fileDiff.name, activeAnchor.startLine, activeAnchor.side)}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Open this range in the review diff"
          >
            <ExternalLinkIcon className="size-3" />
            Open in review
          </button>
        </div>
      )}
      <CodeView
        ref={viewerRef}
        items={[{ ...item, collapsed: false }]}
        options={options}
        selectedLines={selectedLines}
        style={diffStyleVars}
        className="max-h-[28rem] overflow-auto [overflow-anchor:none]"
      />
    </div>
  )
}

/** Compact collapsed file block: icon · path · focus range · +N more anchors · +/− diff changes · change type. Expands on click. */
function CollapsedFileBlock({
  fileDiff,
  file,
  focusLabel,
  anchorCount,
  expanded,
  onToggle,
}: {
  fileDiff: FileDiffMetadata
  file: ReviewFile | null
  focusLabel: string | null
  anchorCount: number
  expanded: boolean
  onToggle: () => void
}) {
  const additions = file?.additions ?? 0
  const deletions = file?.deletions ?? 0
  const changeLabel = changeTypeLabel(fileDiff.type)
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onToggle}
      className="h-auto w-full justify-start gap-2 rounded-none px-3 py-2 text-left font-normal hover:bg-muted/40"
    >
      {expanded
        ? <ChevronDownIcon className="size-3.5 shrink-0 !text-muted-foreground/60" />
        : <ChevronRightIcon className="size-3.5 shrink-0 !text-muted-foreground/60" />}
      <FileDiffIcon className="size-3.5 shrink-0 !text-muted-foreground/60" />
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/90">
        {fileDiff.name}
      </span>
      {focusLabel && (
        <span className="shrink-0 rounded bg-orange-500/12 px-1.5 py-0.5 font-mono text-[9px] font-medium text-orange-600 dark:text-orange-400">
          {focusLabel}
        </span>
      )}
      {focusLabel && anchorCount > 1 && (
        <span className="shrink-0 rounded bg-orange-500/8 px-1.5 py-0.5 font-mono text-[9px] font-medium text-orange-600/80 dark:text-orange-400/80">
          +
{anchorCount - 1}
        </span>
      )}
      {changeLabel && (
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
          {changeLabel}
        </span>
      )}
      <span className="flex shrink-0 items-center gap-1 font-mono text-[10px] tabular-nums">
        <span className="text-emerald-600 dark:text-emerald-400">
+
{additions}
        </span>
        <span className="text-red-600 dark:text-red-400">
−
{deletions}
        </span>
      </span>
    </Button>
  )
}

function changeTypeLabel(type: FileDiffMetadata['type']): string | null {
  switch (type) {
    case 'new':
      return 'added'
    case 'deleted':
      return 'deleted'
    case 'rename-pure':
    case 'rename-changed':
      return 'renamed'
    case 'change':
      return null
    default:
      return null
  }
}

function FootnoteMark() {
  return (
    <span className="font-mono text-[9px] text-muted-foreground/50" aria-hidden>
      ※
    </span>
  )
}
