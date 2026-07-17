import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { BetaNotice } from '~/components/common/beta-notice'
import { DiffWorkerProvider } from '~/components/common/diff/diff-runtime'
import { useRegisterLayoutSlots } from '~/components/layout/use-layout-slots'
import { CommitPlanPage } from '~/features/diff-review/commit-plan-page'
import { GuideView } from '~/features/diff-review/review-detail/guide-view'
import { ReviewDetailPage } from '~/features/diff-review/review-detail/review-detail-page'
import { ReviewsListPage } from '~/features/diff-review/reviews-list-page'
import { navigateToReview, WORKING_TREE_REVIEW_ID } from '~/features/diff-review/shared/navigation'

export interface WorkspaceDiffsViewProps {
  workspaceId: string
  repo?: string
  path?: string
  review?: string
  view?: 'commit' | 'guide'
  line?: number
  side?: 'base' | 'head'
}

/**
 * Decoupled, route-agnostic renderer for the workspace diffs surface.
 *
 * Registers its own layout slots (aside scoped to the workspace) so it behaves
 * identically whether mounted by the `/workspaces/$workspaceId/diffs` route or
 * by the split-view / tear-off surface renderer.
 *
 * One shared highlighter worker pool for every CodeView under /diffs (review
 * detail, guide, commit plan). Without this, each CodeView tokenizes on the
 * main thread and the singleton pool is never initialized — see
 * shared/diff-items.ts for the option constants.
 */
export function WorkspaceDiffsView({
  workspaceId,
  repo,
  path,
  review,
  view,
  line,
  side,
}: WorkspaceDiffsViewProps) {
  const { t } = useTranslation('diff-review')

  useRegisterLayoutSlots(`workspace-diffs:${workspaceId}`, useMemo(() => ({
    asideWorkspaceId: workspaceId,
    hasAside: true,
    hasBrowserPanel: false,
    hasPanel: false,
  }), [workspaceId]))

  return (
    <DiffWorkerProvider>
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
        <BetaNotice title={t('beta.title')} description={t('beta.description')} />
        <div className="min-h-0 flex-1 overflow-hidden">
          <WorkspaceDiffsContent
            workspaceId={workspaceId}
            repo={repo}
            path={path}
            review={review}
            view={view}
            line={line}
            side={side}
          />
        </div>
      </div>
    </DiffWorkerProvider>
  )
}

function WorkspaceDiffsContent({
  workspaceId,
  repo,
  path,
  review,
  view,
  line,
  side,
}: WorkspaceDiffsViewProps) {
  if (review && view === 'commit') {
    return <CommitPlanPage workspaceId={workspaceId} repositoryPath={repo} reviewId={review} />
  }

  if (review && view === 'guide') {
    return (
      <GuideView
        workspaceId={workspaceId}
        repositoryPath={repo}
        reviewId={review}
        onBack={() => navigateToReview(workspaceId, review, { repositoryPath: repo })}
      />
    )
  }

  if (review) {
    return (
      <ReviewDetailPage
        key={`${review}:${path ?? ''}`}
        workspaceId={workspaceId}
        repositoryPath={repo}
        reviewId={review}
        initialPath={path}
        initialLine={line}
        initialSide={side}
      />
    )
  }

  if (path) {
    return (
      <ReviewDetailPage
        key={`${WORKING_TREE_REVIEW_ID}:${path}`}
        workspaceId={workspaceId}
        repositoryPath={repo}
        reviewId={WORKING_TREE_REVIEW_ID}
        initialPath={path}
        initialLine={line}
        initialSide={side}
      />
    )
  }

  return <ReviewsListPage workspaceId={workspaceId} repositoryPath={repo} />
}
