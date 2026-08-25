import type { DiffLineAnnotation } from '@pierre/diffs'
import { CodeView, useStableCallback } from '@pierre/diffs/react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useMemo, useState } from 'react'

import { buildDiffData } from '~/components/common/diff/diff-data'
import { buildDiffOptions } from '~/components/common/diff/diff-options'
import { DiffWorkerProvider } from '~/components/common/diff/diff-runtime'
import { useAppThemeType } from '~/components/common/diff/use-app-theme'

import { InlineThread } from '../../review-detail/inline-thread'
import { ThreadComposer } from '../../review-detail/thread-composer'
import type { CodeViewLineSelection, ThreadAnnotation } from '../../shared/diff-items'
import { buildThreadAnnotations } from '../../shared/diff-items'
import type { CradleDiffReview, DiffStyle, ReviewFile } from '../../shared/types'
import { reviewFixture, workingTreeReviewFixture } from '../fixtures/review-fixtures'
import { ReviewDetailView } from '../review-detail-view'

/**
 * Stateful harness so the story exercises the View's real interaction surface
 * (rail selection, viewed toggles, overview collapse, threads overlay) instead
 * of a frozen snapshot.
 */
function ReviewDetailScene({ review: initialReview }: { review: CradleDiffReview }) {
  const [review, setReview] = useState(initialReview)
  const [diffStyle, setDiffStyle] = useState<DiffStyle>('split')
  const [selectedFileId, setSelectedFileId] = useState<string | null>(initialReview.files[0]?.id ?? null)
  const [overviewCollapsed, setOverviewCollapsed] = useState(false)
  const [threadsOpen, setThreadsOpen] = useState(false)

  const diffData = useMemo(
    () => buildDiffData<ThreadAnnotation>(review.currentRevision?.patch ?? ''),
    [review.currentRevision?.patch],
  )
  const themeType = useAppThemeType()
  const [composerAnchor, setComposerAnchor] = useState<CodeViewLineSelection | null>(null)

  const options = useMemo(
    () => buildDiffOptions<ThreadAnnotation>(diffStyle, {
      themeType,
      enableGutterUtility: true,
      enableLineSelection: true,
      onGutterUtilityClick: (range, context) => {
        setComposerAnchor({ id: context.item.id, range })
      },
    }),
    [diffStyle, themeType],
  )

  const itemsWithAnnotations = useMemo(
    () => buildThreadAnnotations(review.threads, diffData.itemIdToPath),
    [diffData.itemIdToPath, review.threads],
  )

  const annotatedItems = useMemo(() => {
    const byItem = new Map(itemsWithAnnotations)
    if (composerAnchor) {
      const list = byItem.get(composerAnchor.id) ?? []
      list.push({
        side: composerAnchor.range.side === 'deletions' ? 'deletions' : 'additions',
        lineNumber: composerAnchor.range.start,
        metadata: { kind: 'composer' },
      })
      byItem.set(composerAnchor.id, list)
    }
    return diffData.items.map((item) => {
      const annotations = byItem.get(item.id)
      if (!annotations) { return item }
      return {
        ...item,
        annotations,
        version: (typeof item.version === 'number' ? item.version : 0) + 1,
      } as typeof item
    })
  }, [composerAnchor, diffData.items, itemsWithAnnotations])

  const renderAnnotation = useStableCallback((annotation: DiffLineAnnotation<ThreadAnnotation>) => {
    if (annotation.metadata?.kind === 'composer' && composerAnchor) {
      return (
        <ThreadComposer
          selection={composerAnchor}
          files={review.files}
          itemIdToPath={diffData.itemIdToPath}
          onClose={() => setComposerAnchor(null)}
          onCreate={() => setComposerAnchor(null)}
          pending={false}
        />
      )
    }
    const metadata = annotation.metadata
    const thread = metadata?.kind === 'thread'
      ? review.threads.find(item => item.id === metadata.threadId)
      : undefined
    if (!thread) {
      return null
    }
    return (
      <InlineThread
        thread={thread}
        onReply={() => {}}
        replyPending={false}
        onResolve={() => {}}
        resolvePending={false}
      />
    )
  })

  const toggleViewed = (target: ReviewFile) => {
    setReview(current => ({
      ...current,
      files: current.files.map(item =>
        item.id === target.id ? { ...item, isViewed: !item.isViewed } : item),
    }))
  }

  return (
    <DiffWorkerProvider>
      <div className="h-screen w-full">
        <ReviewDetailView
          review={review}
          files={review.files}
          selectedFileId={selectedFileId}
          onSelectFile={file => setSelectedFileId(file.id)}
          onToggleViewed={toggleViewed}
          diffStyle={diffStyle}
          onDiffStyleChange={setDiffStyle}
          overviewCollapsed={overviewCollapsed}
          onToggleOverview={() => setOverviewCollapsed(value => !value)}
          onBack={() => {}}
          onRefresh={() => {}}
          onSubmit={() => {}}
          threadsOpen={threadsOpen}
          onToggleThreads={() => setThreadsOpen(value => !value)}
          diffSlot={(
            <CodeView
              items={annotatedItems}
              options={options}
              selectedLines={composerAnchor}
              onSelectedLinesChange={selection => setComposerAnchor(selection)}
              renderAnnotation={renderAnnotation}
              className="h-full overflow-auto overscroll-contain [overflow-anchor:none]"
            />
          )}
          threadsSlot={(
            <div className="flex h-full flex-col">
              <div className="flex h-9 items-center border-b border-[var(--rv-line)] px-3 text-[12px] font-medium">
                Threads
              </div>
              <ul className="min-h-0 flex-1 overflow-y-auto p-2">
                {review.threads.map(thread => (
                  <li
                    key={thread.id}
                    className="rounded-[var(--rv-radius)] p-2 text-[12px] hover:bg-[var(--rv-bg-hover)]"
                  >
                    <p className="truncate font-[var(--rv-font-mono)] text-[10.5px] text-[var(--rv-fg-subtle)]">
                      {thread.anchor?.path}
                    </p>
                    <p className="mt-1 text-[var(--rv-fg-muted)]">
                      {thread.comments[0]?.bodyMarkdown}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        />
      </div>
    </DiffWorkerProvider>
  )
}

const meta = {
  title: 'Diffs/ReviewDetailView',
  component: ReviewDetailScene,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof ReviewDetailScene>

export default meta

type Story = StoryObj<typeof meta>

export const PullRequest: Story = {
  args: { review: reviewFixture },
}

export const WorkingTree: Story = {
  args: { review: workingTreeReviewFixture },
}

/** Annotation-slot cards rendered standalone, at split-view column width. */
function AnnotationCardsScene() {
  const diffData = useMemo(
    () => buildDiffData<ThreadAnnotation>(reviewFixture.currentRevision?.patch ?? ''),
    [],
  )
  const filePaths = new Set(reviewFixture.files.map(file => file.path))
  const firstItemId = [...diffData.itemIdToPath.entries()]
    .find(([, path]) => filePaths.has(path))?.[0] ?? ''
  const [thread, setThread] = useState(reviewFixture.threads[0]!)

  return (
    <div className="dark min-h-screen bg-background p-6">
      <div className="mx-auto flex w-96 min-w-0 flex-col gap-4">
        <p className="text-[11px] text-muted-foreground">Composer (split-view column width)</p>
        <ThreadComposer
          selection={{ id: firstItemId, range: { start: 76, end: 78, side: 'additions' } }}
          files={reviewFixture.files}
          itemIdToPath={diffData.itemIdToPath}
          onClose={() => {}}
          onCreate={() => {}}
          pending={false}
        />
        <p className="text-[11px] text-muted-foreground">Open thread</p>
        <InlineThread
          thread={thread}
          onReply={(_threadId, bodyMarkdown) => {
            setThread(current => ({
              ...current,
              comments: [...current.comments, {
                id: `cm-${current.comments.length + 1}`,
                threadId: current.id,
                authorKind: 'user',
                authorId: 'wibus-wee',
                bodyMarkdown,
                externalUrl: null,
                createdAt: Math.floor(Date.now() / 1000),
                updatedAt: Math.floor(Date.now() / 1000),
              }],
            }))
          }}
          replyPending={false}
          onResolve={() => setThread(current => ({ ...current, state: 'resolved' }))}
          resolvePending={false}
          onAskAgent={() => {}}
        />
        <p className="text-[11px] text-muted-foreground">Resolved thread</p>
        <InlineThread
          thread={reviewFixture.threads[1]!}
          onReply={() => {}}
          replyPending={false}
          onResolve={() => {}}
          resolvePending={false}
        />
      </div>
    </div>
  )
}

export const AnnotationCards: Story = {
  args: { review: reviewFixture },
  render: () => <AnnotationCardsScene />,
}
