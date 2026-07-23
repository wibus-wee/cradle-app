import { CloseLine as XIcon } from '@mingcute/react'

import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { cn } from '~/lib/cn'

import { GitHubCIAwaitCardView } from './github-ci-await-card-view'
import { GitHubReviewAwaitCardView } from './github-review-await-card-view'
import type { SessionAwait, SessionAwaitLiveStatus } from './types'

function parseResumePayload(
  awaitRow: SessionAwait,
): Record<string, unknown> | null {
  if (!awaitRow.resumePayloadJson) {
    return null
  }
  try {
    const parsed = JSON.parse(awaitRow.resumePayloadJson)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  }
  catch {
    return null
  }
}

function formatCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function describeStoredAwaitStatus(awaitRow: SessionAwait): string {
  if (awaitRow.lastErrorText) {
    return awaitRow.lastErrorText
  }
  if (awaitRow.status === 'triggered') {
    const payload = parseResumePayload(awaitRow)
    if (payload?.kind === 'github-ci') {
      const totalCount = formatCount(payload.totalCount)
      const failureCount = formatCount(payload.failureCount)
      if (payload.noCIConfigured === true) {
        return 'Completed without CI signals'
      }
      if (payload.allSuccess === true) {
        return `Completed: ${totalCount} checks/statuses passed`
      }
      if (failureCount > 0) {
        return `Completed: ${failureCount} checks/statuses failed`
      }
      return 'Completed: GitHub checks finished'
    }
    if (payload?.kind === 'github-review') {
      const approvedCount = formatCount(payload.approvedCount)
      const changesRequestedCount = formatCount(payload.changesRequestedCount)
      if (changesRequestedCount > 0) {
        return `Completed: ${changesRequestedCount} changes requested`
      }
      if (approvedCount > 0) {
        return `Completed: ${approvedCount} approvals`
      }
      return 'Completed: review activity found'
    }
    return 'Completed'
  }
  if (awaitRow.status === 'failed') {
    return 'Failed'
  }
  if (awaitRow.status === 'expired') {
    return 'Expired'
  }
  if (awaitRow.status === 'cancelled') {
    return 'Cancelled'
  }
  return awaitRow.reason ?? 'Waiting...'
}

export interface AwaitSourceCardViewProps {
  awaitRow: SessionAwait
  liveStatus?: SessionAwaitLiveStatus
  isCancelling?: boolean
  isRetryingDelivery?: boolean
  bypassingCheckName?: string | null
  onCancel: (awaitId: string) => void
  onRetryDelivery: (awaitId: string) => void
  onBypassCheck: (awaitId: string, checkName: string) => void
}

export function AwaitSourceCardView({
  awaitRow,
  liveStatus,
  isCancelling,
  isRetryingDelivery,
  bypassingCheckName,
  onCancel,
  onRetryDelivery,
  onBypassCheck,
}: AwaitSourceCardViewProps) {
  if (liveStatus?.supported) {
    return liveStatus.kind === 'github-review'
      ? <GitHubReviewAwaitCardView review={liveStatus} />
      : (
          <GitHubCIAwaitCardView
            ci={liveStatus}
            onBypassCheck={checkName => onBypassCheck(awaitRow.id, checkName)}
            bypassingCheckName={bypassingCheckName}
          />
        )
  }

  const errorText = liveStatus?.error?.message ?? awaitRow.lastErrorText
  const statusText = errorText ?? describeStoredAwaitStatus(awaitRow)
  const hasError = !!errorText || awaitRow.status === 'failed'
  const isRetryableDeliveryFailure = awaitRow.status === 'failed'
    && awaitRow.failureKind === 'delivery'

  return (
    <div
      className={cn(
        'relative rounded-md border p-3',
        hasError
          ? 'border-red-500/35 bg-red-500/[0.04]'
          : 'border-border',
      )}
    >
      {awaitRow.status === 'pending' && (
        <button
          type="button"
          onClick={() => onCancel(awaitRow.id)}
          disabled={isCancelling}
          className="absolute right-1.5 top-1.5 rounded p-0.5 text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Cancel await"
        >
          <XIcon className="size-3" />
        </button>
      )}
      <div className="space-y-1.5 text-xs">
        <div
          className={cn(
            'flex items-center gap-2',
            hasError ? 'text-red-500' : 'text-muted-foreground',
          )}
        >
          {hasError && <XIcon className="size-3 shrink-0" aria-hidden />}
          <span className="capitalize">{awaitRow.source}</span>
        </div>
        <span
          className={cn(
            'block min-w-0 whitespace-normal break-words leading-5',
            hasError ? 'text-red-500' : 'text-muted-foreground',
          )}
        >
          {statusText}
        </span>
        {isRetryableDeliveryFailure && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-1 h-8 w-full transition-transform active:scale-[0.96]"
            disabled={isRetryingDelivery}
            onClick={() => onRetryDelivery(awaitRow.id)}
          >
            {isRetryingDelivery ? <Spinner className="size-3" /> : null}
            Retry delivery
          </Button>
        )}
      </div>
    </div>
  )
}
