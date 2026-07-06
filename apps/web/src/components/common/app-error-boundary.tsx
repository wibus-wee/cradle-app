/**
 * App-wide React error boundary for isolating renderer crashes behind a stable fallback.
 */
import {
  ArrowLeftLine as ArrowLeftIcon,
  ClockwiseLine as RotateCwIcon,
  RefreshAnticlockwise1Line as RefreshCcwIcon,
  WarningLine as AlertTriangleIcon,
} from '@mingcute/react'
import type { ErrorInfo, ReactNode } from 'react'
import { Component } from 'react'
import { Translation } from 'react-i18next'

import { Button } from '~/components/ui/button'

interface AppErrorBoundaryProps {
  children: ReactNode
}

interface AppErrorBoundaryState {
  error: Error | null
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    error: null,
  }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Unhandled React render error', error, errorInfo)
  }

  private handleRetry = (): void => {
    this.setState({ error: null })
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  private handleBack = (): void => {
    if (window.history.length > 1) {
      window.history.back()
      return
    }

    window.location.reload()
  }

  render(): ReactNode {
    if (this.state.error === null) {
      return this.props.children
    }

    return (
      <AppErrorFallback
        error={this.state.error}
        onBack={this.handleBack}
        onRetry={this.handleRetry}
        onReload={this.handleReload}
      />
    )
  }
}

function AppErrorFallback({
  error,
  onBack,
  onRetry,
  onReload,
}: {
  error: Error
  onBack: () => void
  onRetry: () => void
  onReload: () => void
}) {
  return (
    <Translation ns="common">
      {t => (
        <div className="flex h-screen w-screen items-center justify-center bg-sidebar p-4 text-foreground">
          <section
            role="alert"
            aria-live="assertive"
            className="flex w-full max-w-[520px] flex-col gap-4 rounded-xl bg-background p-5 shadow-[var(--shadow-lg)]"
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                <AlertTriangleIcon className="size-4" aria-hidden="true" />
              </div>
              <div className="min-w-0 space-y-1">
                <h1 className="text-sm font-medium text-foreground">{t('errorBoundary.title')}</h1>
                <p className="text-sm leading-6 text-muted-foreground">
                  {t('errorBoundary.description')}
                </p>
              </div>
            </div>

            {import.meta.env.DEV && (
              <details className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                <summary className="cursor-pointer select-none text-foreground">{t('errorBoundary.details')}</summary>
                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5">
                  {error.stack ?? error.message}
                </pre>
              </details>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onBack}>
                <ArrowLeftIcon className="size-3.5" aria-hidden="true" />
                {t('action.back')}
              </Button>
              <Button type="button" variant="default" size="sm" onClick={onRetry}>
                <RotateCwIcon className="size-3.5" aria-hidden="true" />
                {t('action.retry')}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={onReload}>
                <RefreshCcwIcon className="size-3.5" aria-hidden="true" />
                {t('action.reload')}
              </Button>
            </div>
          </section>
        </div>
      )}
    </Translation>
  )
}
