import {
  CloseLine as CloseIcon,
  Key2Line as KeyIcon,
  Refresh2Line as RetryIcon,
} from '@mingcute/react'
import type { ReactNode } from 'react'

import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'

export interface AuthRecoveryViewLabels {
  title: string
  description: string
  retry: string
  retrying: string
  dismiss: string
  dismissing: string
}

export function AuthRecoveryView({
  labels,
  configuration,
  error,
  isRetrying,
  isDismissing,
  onRetry,
  onDismiss,
}: {
  labels: AuthRecoveryViewLabels
  configuration: ReactNode
  error?: string | null
  isRetrying: boolean
  isDismissing: boolean
  onRetry: () => void
  onDismiss: () => void
}) {
  const isPending = isRetrying || isDismissing
  return (
    <section
      className="mt-4 flex flex-col gap-4 rounded-md border border-warning/35 bg-warning/5 p-4"
      data-testid="chat-auth-recovery"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-warning/10 text-warning">
          <KeyIcon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-medium text-foreground">{labels.title}</h3>
          <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{labels.description}</p>
        </div>
      </div>

      {configuration}
      {error && <p className="text-[12px] text-destructive" role="alert">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onRetry} disabled={isPending}>
          {isRetrying ? <Spinner /> : <RetryIcon />}
          {isRetrying ? labels.retrying : labels.retry}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss} disabled={isPending}>
          {isDismissing ? <Spinner /> : <CloseIcon />}
          {isDismissing ? labels.dismissing : labels.dismiss}
        </Button>
      </div>
    </section>
  )
}
