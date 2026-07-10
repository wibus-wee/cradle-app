import {
  ExternalLinkLine as ExternalLinkIcon,
  GitPullRequestLine as GitPullRequestIcon,
} from '@mingcute/react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { toastManager } from '~/components/ui/toast'
import { cn } from '~/lib/cn'

import {
  useMarkSessionPullRequestReady,
  useSessionPullRequest,
} from './use-session-pull-request'

interface SessionPullRequestChromeProps {
  sessionId: string
}

export function SessionPullRequestChrome({ sessionId }: SessionPullRequestChromeProps) {
  const { t } = useTranslation('session-pull-request')
  const pullRequestQuery = useSessionPullRequest(sessionId)
  const markReady = useMarkSessionPullRequestReady()
  const pullRequest = pullRequestQuery.data

  if (!pullRequest) {
    return null
  }

  const statusLabel = pullRequest.merged
    ? t('chrome.merged')
    : pullRequest.state === 'closed'
      ? t('chrome.closed')
      : pullRequest.isDraft
        ? t('chrome.draft')
        : t('chrome.ready')

  const handleMarkReady = async () => {
    try {
      await markReady.mutateAsync(sessionId)
      toastManager.add({
        type: 'success',
        title: t('chrome.readySuccessTitle'),
        description: t('chrome.readySuccessDescription', { number: pullRequest.number }),
      })
    }
    catch (error) {
      toastManager.add({
        type: 'error',
        title: t('chrome.errorTitle'),
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return (
    <div
      className="flex min-w-0 items-center gap-1.5"
      data-testid="session-pull-request-chrome"
    >
      <a
        href={pullRequest.url}
        target="_blank"
        rel="noreferrer"
        className={cn(
          'inline-flex max-w-[220px] items-center gap-1 rounded-md border border-border/60',
          'bg-fill/40 px-1.5 py-0.5 text-[11px] text-foreground/90',
          'transition-colors duration-150 hover:bg-fill active:scale-[0.98]',
        )}
        title={pullRequest.title}
      >
        <GitPullRequestIcon className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
        <span className="truncate font-medium">
          {`#${pullRequest.number}`}
        </span>
        <span className="shrink-0 text-muted-foreground">{statusLabel}</span>
        <ExternalLinkIcon className="size-3 shrink-0 opacity-50" aria-hidden="true" />
      </a>
      {pullRequest.isDraft && pullRequest.state === 'open' && !pullRequest.merged && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[11px]"
          disabled={markReady.isPending}
          onClick={() => void handleMarkReady()}
          data-testid="session-pull-request-mark-ready"
        >
          {markReady.isPending ? t('chrome.markingReady') : t('chrome.markReady')}
        </Button>
      )}
    </div>
  )
}
