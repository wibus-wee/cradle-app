import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { getWorksByIdQueryKey } from '~/api-gen/@tanstack/react-query.gen'
import { toastManager } from '~/components/ui/toast'
import {
  classifyProductAnalyticsFailure,
  trackProductTaskFinished,
  trackProductTaskStarted,
} from '~/features/product-analytics/client'
import { useMarkSessionPullRequestReady } from '~/features/session/use-session-pull-request'
import { apiErrorMessage } from '~/lib/api-error'
import { useBrowserPanelStore } from '~/store/browser-panel'

import type { WorkDetail } from './use-work'
import { useSubmitWork, useWorkDetail } from './use-work'
import { WorkHeaderChromeView } from './work-header-chrome-view'

// Work's delivery chrome lives in the always-visible app header, reusing the
// same PR-pill + Mark Ready pattern as a normal session's pull request chrome.
// The only Work-specific addition is the "publish" step (Create/Update Draft
// PR) that precedes the PR. When there's nothing to deliver yet (agent still
// working, no PR) this renders nothing - just like a normal session with no PR
// chrome - so Work doesn't carry a divergent mental model.
export function WorkHeaderChrome({ workId }: { workId: string }) {
  const { t } = useTranslation('work')
  const { t: tPr } = useTranslation('session-pull-request')
  const queryClient = useQueryClient()
  const { data: detail } = useWorkDetail(workId)
  const submitWork = useSubmitWork()
  const markReady = useMarkSessionPullRequestReady()
  const openPullRequestTab = useBrowserPanelStore(state => state.openPullRequestTab)

  if (!detail) {
    return null
  }

  const { readiness, pullRequest: pr } = detail
  const preparedForDelivery = detail.work.preparedAt !== null
    && (detail.work.lastSubmittedAt === null || detail.work.preparedAt > detail.work.lastSubmittedAt)
  const canSubmit = preparedForDelivery
    && readiness.isolated
    && readiness.clean
    && readiness.commitsAhead > 0

  const blockedReason = preparedForDelivery && !canSubmit
    ? (!readiness.isolated
        ? t('aside.blocked.notIsolated')
        : !readiness.clean
          ? t('aside.blocked.dirty')
          : readiness.commitsAhead === 0
            ? t('aside.blocked.noCommits')
            : null)
    : null

  const showPublish = preparedForDelivery
  const handleSubmit = async () => {
    const action = pr ? 'update_draft' : 'create_draft'
    const analyticsTask = trackProductTaskStarted({
      feature_domain: 'work',
      task_kind: 'draft_submit',
      task_variant: action,
    })
    try {
      await submitWork.mutateAsync({ path: { id: workId }, body: {} })
      trackProductTaskFinished(analyticsTask, 'success')
    }
    catch (error) {
      trackProductTaskFinished(
        analyticsTask,
        'failed',
        classifyProductAnalyticsFailure(error),
      )
      toastManager.add({
        type: 'error',
        title: t('aside.submitFailed'),
        description: apiErrorMessage(error),
      })
    }
  }

  const handleMarkReady = async () => {
    if (!pr) {
      return
    }
    const analyticsTask = trackProductTaskStarted({
      feature_domain: 'work',
      task_kind: 'mark_ready',
      task_variant: null,
    })
    try {
      const pullRequest = await markReady.mutateAsync(detail.primaryThread.id)
      queryClient.setQueryData<WorkDetail>(
        getWorksByIdQueryKey({ path: { id: workId } }),
        current => current ? { ...current, pullRequest } : current,
      )
      trackProductTaskFinished(analyticsTask, 'success')
      toastManager.add({
        type: 'success',
        title: t('aside.markReadySuccessTitle'),
        description: t('aside.markReadySuccessDescription', { number: pullRequest.number }),
      })
    }
    catch (error) {
      trackProductTaskFinished(
        analyticsTask,
        'failed',
        classifyProductAnalyticsFailure(error),
      )
      toastManager.add({
        type: 'error',
        title: t('aside.markReadyFailed'),
        description: apiErrorMessage(error),
      })
    }
  }

  const prStatusLabel = pr
    ? pr.merged
      ? tPr('chrome.merged')
      : pr.state === 'closed'
        ? tPr('chrome.closed')
        : pr.isDraft
          ? tPr('chrome.draft')
          : tPr('chrome.ready')
    : null

  const handleOpenPullRequest = () => {
    if (!pr) {
      return
    }
    openPullRequestTab({
      owner: pr.owner,
      repo: pr.repo,
      number: pr.number,
      workId,
      sessionId: detail.primaryThread.id,
      title: pr.title,
    })
  }

  return (
    <WorkHeaderChromeView
      pullRequest={pr}
      pullRequestStatusLabel={prStatusLabel}
      showPublish={showPublish}
      canSubmit={canSubmit}
      blockedReason={blockedReason}
      submitLabel={pr ? t('aside.updateDraft') : t('aside.createDraft')}
      markReadyLabel={t('aside.markReady')}
      markingReadyLabel={t('aside.markingReady')}
      isSubmitting={submitWork.isPending}
      isMarkingReady={markReady.isPending}
      onSubmit={() => void handleSubmit()}
      onMarkReady={() => void handleMarkReady()}
      onOpenPullRequest={handleOpenPullRequest}
    />
  )
}
