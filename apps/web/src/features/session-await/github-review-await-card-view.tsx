import {
  GitPullRequestLine as GitPullRequestIcon,
  Message1Line as MessageSquareCheckIcon,
  WarningLine as MessageSquareWarningIcon,
} from '@mingcute/react'

import { GitHubIcon } from './github-icon'
import type { LiveReviewStatus } from './use-live-await-status'

export interface GitHubReviewAwaitCardViewProps {
  review: LiveReviewStatus
}

export function GitHubReviewAwaitCardView({
  review,
}: GitHubReviewAwaitCardViewProps) {
  if (!review.hasToken) {
    return (
      <div className="rounded-md border border-border p-3">
        <div className="flex items-center gap-2 text-xs text-amber-500">
          <GitHubIcon />
          <span>GitHub token not available</span>
        </div>
      </div>
    )
  }

  const modeLabel = review.mode === 'approved'
    ? 'Waiting for approval'
    : review.mode === 'changes-requested'
      ? 'Waiting for changes requested'
      : 'Waiting for review'
  const statusLabel = review.matched
    ? review.mode === 'changes-requested'
      ? 'Changes requested'
      : review.mode === 'reviewed'
        ? 'Review activity found'
        : `Approved by ${review.approvedCount}`
    : modeLabel

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div className="flex items-center gap-2 px-3 py-2">
        <GitHubIcon className="shrink-0 text-foreground/70" />
        <div className="min-w-0 flex-1">
          <span className="block truncate text-[11px] font-medium text-foreground/90">
            <span className="text-muted-foreground/60">
              #
              {review.prNumber}
            </span>
            {' '}
            {review.prTitle ?? `${review.owner}/${review.repo}`}
          </span>
          <span className="block truncate text-[10px] text-muted-foreground/70">
            {statusLabel}
            {review.headSha && ` @${review.headSha.slice(0, 12)}`}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 px-3 pb-2 text-[11px]">
        <div className="flex items-center gap-1.5 text-green-500">
          <MessageSquareCheckIcon className="size-3" aria-hidden />
          <span>
            {review.approvedCount}
            {' approved'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-red-500">
          <MessageSquareWarningIcon className="size-3" aria-hidden />
          <span>
            {review.changesRequestedCount}
            {' requested'}
          </span>
        </div>
      </div>

      {review.reviews.length > 0 && (
        <div className="space-y-1 px-3 pb-2">
          {review.reviews.map(item => (
            <div key={item.id} className="flex min-w-0 items-center gap-1.5 text-[11px]">
              {item.state === 'APPROVED'
                ? <MessageSquareCheckIcon className="size-3 shrink-0 !text-green-500" aria-hidden />
                : item.state === 'CHANGES_REQUESTED'
                  ? <MessageSquareWarningIcon className="size-3 shrink-0 !text-red-500" aria-hidden />
                  : <GitPullRequestIcon className="size-3 shrink-0 !text-muted-foreground/70" aria-hidden />}
              <span className="min-w-0 flex-1 truncate">
                {item.reviewer ?? 'Unknown reviewer'}
              </span>
              <span className="shrink-0 text-muted-foreground/70">
                {item.state.toLowerCase().replaceAll('_', ' ')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
