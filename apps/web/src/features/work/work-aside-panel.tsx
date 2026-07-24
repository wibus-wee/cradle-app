import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { postWorkspacesByWorkspaceIdDiffReviewsLocalBranchCompareMutation } from '~/api-gen/@tanstack/react-query.gen'
import { toastManager } from '~/components/ui/toast'
import { useRepairSessionIsolation } from '~/features/session/use-session-isolation'
import { apiErrorMessage } from '~/lib/api-error'
import { openWorkspaceDiffs } from '~/navigation/navigation-commands'

import { useWorkDetail } from './use-work'
import { WorkAsidePanelView } from './work-aside-panel-view'

// The aside is a calm reference view: objective, execution state, and handoff.
// Delivery actions (publish, mark ready) live in the header chrome so Work
// reads like a normal session - this panel never competes as a control center.
// Hierarchy is carried by icons + contrast, not boxes: the objective's larger
// darker text leads, execution is a scannable icon-row list, handoff recedes.
export function WorkAsidePanel({ workId }: { workId: string }) {
  const { t } = useTranslation('work')
  const workQuery = useWorkDetail(workId)
  const reviewChanges = useMutation(postWorkspacesByWorkspaceIdDiffReviewsLocalBranchCompareMutation())
  const repair = useRepairSessionIsolation()
  const detail = workQuery.data

  const canReviewChanges = !!detail
    && detail.primaryThread.workspaceId !== null
    && detail.readiness.baseRef !== null
    && detail.readiness.branch !== null

  const handleReviewChanges = async () => {
    if (!detail) {
      return
    }
    const baseRef = detail.readiness.baseRef
    const headRef = detail.readiness.branch
    const workspaceId = detail.primaryThread.workspaceId
    if (!baseRef || !headRef || !workspaceId) {
      return
    }
    try {
      const review = await reviewChanges.mutateAsync({
        path: { workspaceId },
        body: { baseRef, headRef },
      })
      openWorkspaceDiffs({ workspaceId, reviewId: review.id })
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t('aside.reviewChangesFailed'),
        description: apiErrorMessage(error),
      })
    }
  }

  const handleRepair = async () => {
    if (!detail) {
      return
    }
    try {
      await repair.mutateAsync({
        sessionId: detail.primaryThread.id,
        workspaceId: detail.primaryThread.workspaceId,
      })
      void workQuery.refetch()
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t('aside.execution.unhealthy'),
        description: apiErrorMessage(error),
      })
    }
  }

  return (
    <WorkAsidePanelView
      detail={detail ?? null}
      labels={{
        objective: t('aside.objective'),
        objectiveEmpty: t('aside.objective.empty'),
        execution: t('aside.execution'),
        executionUnhealthy: t('aside.execution.unhealthy'),
        tryAgain: t('new.tryAgain'),
        managedWorktree: t('aside.managedWorktree'),
        changes: t('aside.execution.changes'),
        clean: t('aside.clean'),
        changedFiles: t('aside.changedFiles', { count: detail?.readiness.changedFiles ?? 0 }),
        commits: t('aside.execution.commits'),
        commitsAhead: t('aside.commitsAhead', { count: detail?.readiness.commitsAhead ?? 0 }),
        reviewChanges: t('aside.reviewChanges'),
        handoff: t('aside.handoff'),
        handoffTestPlan: t('aside.handoff.testPlan'),
        handoffEmpty: t('aside.handoff.empty'),
      }}
      canReviewChanges={canReviewChanges}
      isReviewingChanges={reviewChanges.isPending}
      isRepairing={repair.isPending}
      onReviewChanges={() => void handleReviewChanges()}
      onRepair={() => void handleRepair()}
    />
  )
}
