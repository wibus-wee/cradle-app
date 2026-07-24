import {
  ExternalLinkLine as ExternalLinkIcon,
  GitPullRequestLine as PullRequestIcon,
} from '@mingcute/react'

import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip'
import { PullRequestTabLinkView } from '~/features/pull-requests/pull-request-tab-link-view'
import type { SessionPullRequest } from '~/features/session/api/pull-request'

interface WorkHeaderChromeViewProps {
  pullRequest: SessionPullRequest | null
  pullRequestStatusLabel: string | null
  showPublish: boolean
  canSubmit: boolean
  blockedReason: string | null
  submitLabel: string
  markReadyLabel: string
  markingReadyLabel: string
  isSubmitting?: boolean
  isMarkingReady?: boolean
  onSubmit: () => void
  onMarkReady: () => void
  onOpenPullRequest?: () => void
}

export function WorkHeaderChromeView({
  pullRequest,
  pullRequestStatusLabel,
  showPublish,
  canSubmit,
  blockedReason,
  submitLabel,
  markReadyLabel,
  markingReadyLabel,
  isSubmitting = false,
  isMarkingReady = false,
  onSubmit,
  onMarkReady,
  onOpenPullRequest,
}: WorkHeaderChromeViewProps) {
  const showMarkReady = !!pullRequest
    && pullRequest.isDraft
    && pullRequest.state === 'open'
    && !pullRequest.merged

  if (!showPublish && !pullRequest) {
    return null
  }

  const submitButton = (
    <Button
      type="button"
      size="sm"
      className="h-6 gap-1 px-2 text-[11px]"
      disabled={!canSubmit || isSubmitting}
      onClick={onSubmit}
      data-testid="work-submit"
    >
      {isSubmitting ? <Spinner className="size-3" /> : submitLabel}
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
      {pullRequest && (
        <PullRequestTabLinkView
          pullRequest={pullRequest}
          onOpen={onOpenPullRequest}
          className="inline-flex max-w-[220px] items-center gap-1 rounded-md border border-border/60 bg-fill/40 px-1.5 py-0.5 text-[11px] text-foreground/90 transition-colors duration-150 hover:bg-fill active:scale-[0.98]"
        >
          <PullRequestIcon className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
          <span className="truncate font-medium">{`#${pullRequest.number}`}</span>
          <span className="shrink-0 text-muted-foreground">{pullRequestStatusLabel}</span>
          <ExternalLinkIcon className="size-3 shrink-0 opacity-50" aria-hidden="true" />
        </PullRequestTabLinkView>
      )}
      {showMarkReady && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[11px]"
          disabled={isMarkingReady}
          onClick={onMarkReady}
          data-testid="work-mark-ready"
        >
          {isMarkingReady ? markingReadyLabel : markReadyLabel}
        </Button>
      )}
    </div>
  )
}
