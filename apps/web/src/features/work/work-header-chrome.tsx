import {
  ExternalLinkLine as ExternalLinkIcon,
  GitPullRequestLine as PullRequestIcon,
} from '@mingcute/react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { getWorksByIdQueryKey } from '~/api-gen/@tanstack/react-query.gen'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { toastManager } from '~/components/ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { trackProductTaskFinished, trackProductTaskStarted } from '~/features/product-analytics/client'
import { useMarkSessionPullRequestReady } from '~/features/session/use-session-pull-request'
import { apiErrorMessage } from '~/lib/api-error'

import type { WorkDetail } from './use-work'
import { useSubmitWork, useWorkDetail } from './use-work'

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
  const showMarkReady = !!pr && pr.isDraft && pr.state === 'open' && !pr.merged

  if (!showPublish && !pr) {
    return null
  }

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
      trackProductTaskFinished(analyticsTask, 'failed')
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
      trackProductTaskFinished(analyticsTask, 'failed')
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

  const submitButton = (
    <Button
      type="button"
      size="sm"
      className="h-6 gap-1 px-2 text-[11px]"
      disabled={!canSubmit || submitWork.isPending}
      onClick={() => void handleSubmit()}
      data-testid="work-submit"
    >
      {submitWork.isPending
        ? <Spinner className="size-3" />
        : pr
          ? t('aside.updateDraft')
          : t('aside.createDraft')}
    </Button>
  )

  return (
    <div className="flex min-w-0 items-center gap-1.5" data-testid="work-header-chrome">
      {showPublish && (
        blockedReason
          ? (
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex">{submitButton}</span>} />
              <TooltipContent side="bottom">{blockedReason}</TooltipContent>
            </Tooltip>
          )
          : submitButton
      )}
      {pr && (
        <a
          href={pr.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex max-w-[220px] items-center gap-1 rounded-md border border-border/60 bg-fill/40 px-1.5 py-0.5 text-[11px] text-foreground/90 transition-colors duration-150 hover:bg-fill active:scale-[0.98]"
          title={pr.title}
        >
          <PullRequestIcon className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
          <span className="truncate font-medium">{`#${pr.number}`}</span>
          <span className="shrink-0 text-muted-foreground">{prStatusLabel}</span>
          <ExternalLinkIcon className="size-3 shrink-0 opacity-50" aria-hidden="true" />
        </a>
      )}
      {showMarkReady && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[11px]"
          disabled={markReady.isPending}
          onClick={() => void handleMarkReady()}
          data-testid="work-mark-ready"
        >
          {markReady.isPending ? t('aside.markingReady') : t('aside.markReady')}
        </Button>
      )}
    </div>
  )
}
