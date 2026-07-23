import {
  Home4Line as HomeIcon,
  RefreshAnticlockwise1Line as RefreshIcon,
  WarningLine as WarningIcon,
} from '@mingcute/react'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'

export interface RouteErrorViewProps {
  title: string
  description: string
  messageLabel: string
  message: string
  retryLabel: string
  homeLabel: string
  onRetry: () => void
  onHome: () => void
  detailsLabel?: string
  details?: string | null
  className?: string
}

/** Props-only route failure surface. Router recovery stays in RouteErrorFallback. */
export function RouteErrorView({
  title,
  description,
  messageLabel,
  message,
  retryLabel,
  homeLabel,
  onRetry,
  onHome,
  detailsLabel,
  details,
  className,
}: RouteErrorViewProps) {
  return (
    <div className={cn('flex h-full min-h-0 w-full items-center justify-center bg-background p-4 text-foreground', className)}>
      <section
        role="alert"
        aria-live="assertive"
        className="w-full max-w-[560px] rounded-2xl bg-card p-5 text-card-foreground shadow-[var(--shadow-lg)] ring-1 ring-foreground/10"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <WarningIcon className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 space-y-2">
            <div className="space-y-1">
              <h1 className="text-balance text-base font-medium leading-snug text-foreground">
                {title}
              </h1>
              <p className="text-pretty text-sm leading-6 text-muted-foreground">
                {description}
              </p>
            </div>

            <div className="rounded-xl bg-muted/60 px-3 py-2 shadow-[inset_0_0_0_1px_hsl(var(--border)/0.55)]">
              <div className="text-[11px] font-medium uppercase text-muted-foreground">
                {messageLabel}
              </div>
              <p className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground">
                {message}
              </p>
            </div>

            {details && detailsLabel && (
              <details className="rounded-xl bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <summary className="cursor-pointer select-none text-foreground">
                  {detailsLabel}
                </summary>
                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5">
                  {details}
                </pre>
              </details>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button type="button" variant="default" size="sm" onClick={onRetry}>
                <RefreshIcon className="size-3.5" aria-hidden="true" />
                {retryLabel}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={onHome}>
                <HomeIcon className="size-3.5" aria-hidden="true" />
                {homeLabel}
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
