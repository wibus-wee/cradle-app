import {
  ExternalLinkLine as ExternalLinkIcon,
  GitPullRequestLine as GitPullRequestIcon,
} from '@mingcute/react'

import { Button } from '~/components/ui/button'
import { PullRequestTabLinkView } from '~/features/pull-requests/pull-request-tab-link-view'
import { cn } from '~/lib/cn'

import type { SessionPullRequest } from './api/pull-request'

interface SessionPullRequestChromeViewProps {
  pullRequest: SessionPullRequest
  statusLabel: string
  markReadyLabel: string
  markingReadyLabel: string
  isMarkingReady?: boolean
  onOpenPullRequest?: () => void
  onMarkReady: () => void
}

export function SessionPullRequestChromeView({
  pullRequest,
  statusLabel,
  markReadyLabel,
  markingReadyLabel,
  isMarkingReady = false,
  onOpenPullRequest,
  onMarkReady,
}: SessionPullRequestChromeViewProps) {
  const showMarkReady = pullRequest.isDraft
    && pullRequest.state === 'open'
    && !pullRequest.merged

  return (
    <div
      className="flex min-w-0 items-center gap-1.5"
      data-testid="session-pull-request-chrome"
    >
      <PullRequestTabLinkView
        pullRequest={pullRequest}
        onOpen={onOpenPullRequest}
        className={cn(
          'inline-flex max-w-[220px] items-center gap-1 rounded-md border border-border/60',
          'bg-fill/40 px-1.5 py-0.5 text-[11px] text-foreground/90',
          'transition-colors duration-150 hover:bg-fill active:scale-[0.98]',
        )}
      >
        <GitPullRequestIcon className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
        <span className="truncate font-medium">{`#${pullRequest.number}`}</span>
        <span className="shrink-0 text-muted-foreground">{statusLabel}</span>
        <ExternalLinkIcon className="size-3 shrink-0 opacity-50" aria-hidden="true" />
      </PullRequestTabLinkView>
      {showMarkReady && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[11px]"
          disabled={isMarkingReady}
          onClick={onMarkReady}
          data-testid="session-pull-request-mark-ready"
        >
          {isMarkingReady ? markingReadyLabel : markReadyLabel}
        </Button>
      )}
    </div>
  )
}
