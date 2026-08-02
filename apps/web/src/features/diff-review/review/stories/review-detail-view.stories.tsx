import { CodeView } from '@pierre/diffs/react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useMemo, useState } from 'react'

import { buildDiffData } from '~/components/common/diff/diff-data'
import { buildDiffOptions } from '~/components/common/diff/diff-options'
import { DiffWorkerProvider } from '~/components/common/diff/diff-runtime'

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
    () => buildDiffData(review.currentRevision?.patch ?? ''),
    [review.currentRevision?.patch],
  )
  const options = useMemo(() => buildDiffOptions(diffStyle), [diffStyle])

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
              items={diffData.items}
              options={options}
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
