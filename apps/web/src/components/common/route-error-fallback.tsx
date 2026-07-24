import {
  Home4Line as HomeIcon,
  RefreshAnticlockwise1Line as RefreshIcon,
  WarningLine as WarningIcon,
} from '@mingcute/react'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import { cn } from '~/lib/cn'

interface RouteErrorFallbackProps extends ErrorComponentProps {
  className?: string
}

export function RouteErrorFallback({
  className,
  error,
  reset,
}: RouteErrorFallbackProps) {
  const router = useRouter()
  const navigate = useNavigate()
  const { t } = useTranslation('common')
  const message = readErrorMessage(error) ?? t('routeError.unknownMessage')

  const retryRoute = useCallback(() => {
    reset()
    void router.invalidate().catch((invalidateError) => {
      console.error('Failed to invalidate route after error reset', invalidateError)
    })
  }, [reset, router])

  const navigateHome = useCallback(() => {
    reset()
    void navigate({ to: '/', replace: true }).catch((navigationError) => {
      console.error('Failed to navigate home after route error', navigationError)
    })
  }, [navigate, reset])

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
                {t('routeError.title')}
              </h1>
              <p className="text-pretty text-sm leading-6 text-muted-foreground">
                {t('routeError.description')}
              </p>
            </div>

            <div className="rounded-xl bg-muted/60 px-3 py-2 shadow-[inset_0_0_0_1px_hsl(var(--border)/0.55)]">
              <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {t('routeError.messageLabel')}
              </div>
              <p className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground">
                {message}
              </p>
            </div>

            {import.meta.env.DEV && error instanceof Error && error.stack && (
              <details className="rounded-xl bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <summary className="cursor-pointer select-none text-foreground">
                  {t('errorBoundary.details')}
                </summary>
                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5">
                  {error.stack}
                </pre>
              </details>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button type="button" variant="default" size="sm" onClick={retryRoute}>
                <RefreshIcon className="size-3.5" aria-hidden="true" />
                {t('action.retry')}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={navigateHome}>
                <HomeIcon className="size-3.5" aria-hidden="true" />
                {t('action.backToHome')}
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

function readErrorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }
  if (typeof error === 'string' && error.trim().length > 0) {
    return error
  }
  return null
}
