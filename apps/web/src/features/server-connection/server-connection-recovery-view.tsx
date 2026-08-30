import {
  AnticlockwiseLine as ResetIcon,
  Refresh1Line as RetryIcon,
  WifiLine as TestConnectionIcon,
} from '@mingcute/react'

import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { cn } from '~/lib/cn'

export type ServerConnectionStatus
  = | { kind: 'idle' }
    | { kind: 'checking' }
    | { kind: 'success', message: string }
    | { kind: 'error', message: string }

export interface ServerConnectionRecoveryLabels {
  title: string
  hostedDescription: string
  desktopDescription: string
  endpointLabel: string
  endpointHint: string
  invalidEndpoint: string
  retry: string
  retrying: string
  test: string
  testing: string
  connect: string
  useDefault: string
  securityNote: string
  details: string
}

export interface ServerConnectionRecoveryViewProps {
  labels: ServerConnectionRecoveryLabels
  endpoint: string
  draftEndpoint: string
  canConfigureEndpoint: boolean
  hasCustomEndpoint: boolean
  validationError: boolean
  retrying: boolean
  status: ServerConnectionStatus
  errorDetail: string | null
  onDraftEndpointChange: (value: string) => void
  onRetry: () => void
  onTestConnection: () => void
  onConnect: () => void
  onUseDefault: () => void
}

export function ServerConnectionRecoveryView({
  labels,
  endpoint,
  draftEndpoint,
  canConfigureEndpoint,
  hasCustomEndpoint,
  validationError,
  retrying,
  status,
  errorDetail,
  onDraftEndpointChange,
  onRetry,
  onTestConnection,
  onConnect,
  onUseDefault,
}: ServerConnectionRecoveryViewProps) {
  const checking = status.kind === 'checking'

  return (
    <main className="flex h-full min-h-0 bg-sidebar p-1 text-foreground">
      <section className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto rounded-xl bg-background px-5 py-8 shadow-[var(--shadow-sm)] sm:px-8">
        <div className="w-full max-w-[440px]">
          <img
            src="/icon.png"
            alt=""
            aria-hidden="true"
            className="size-11 rounded-xl ring-1 ring-black/10 dark:ring-white/10"
          />

          <div className="mt-5">
            <h1 className="text-balance text-[22px] font-semibold leading-7">
              {labels.title}
            </h1>
            <p className="mt-2 text-pretty text-[13px] leading-5 text-muted-foreground">
              {canConfigureEndpoint ? labels.hostedDescription : labels.desktopDescription}
            </p>
          </div>

          <form
            className="mt-6 flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (canConfigureEndpoint) {
                if (!checking && draftEndpoint.trim().length > 0) {
                  onConnect()
                }
              }
              else if (!retrying) {
                onRetry()
              }
            }}
          >
            {canConfigureEndpoint
              ? (
                  <div className="flex flex-col gap-2">
                    <label htmlFor="server-recovery-endpoint" className="text-[13px] font-medium">
                      {labels.endpointLabel}
                    </label>
                    <Input
                      id="server-recovery-endpoint"
                      type="url"
                      inputMode="url"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      value={draftEndpoint}
                      onChange={event => onDraftEndpointChange(event.target.value)}
                      aria-invalid={validationError || undefined}
                      aria-describedby="server-recovery-endpoint-hint"
                      className="h-10 font-mono text-[13px]"
                      autoFocus
                    />
                    <p
                      id="server-recovery-endpoint-hint"
                      className={cn(
                        'text-pretty text-[12px] leading-[18px]',
                        validationError ? 'text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      {validationError ? labels.invalidEndpoint : labels.endpointHint}
                    </p>
                  </div>
                )
              : (
                  <div className="rounded-lg bg-muted px-3 py-2.5 shadow-[var(--shadow-inset-ring)]">
                    <p className="truncate font-mono text-[12px] text-muted-foreground">{endpoint}</p>
                  </div>
                )}

            {status.kind === 'success' || status.kind === 'error'
              ? (
                  <p
                    role={status.kind === 'error' ? 'alert' : 'status'}
                    className={cn(
                      'text-pretty text-[12px] leading-[18px]',
                      status.kind === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive',
                    )}
                  >
                    {status.message}
                  </p>
                )
              : null}

            <div className="flex flex-wrap gap-2">
              {canConfigureEndpoint
                ? (
                    <Button
                      type="submit"
                      size="lg"
                      className="h-10"
                      disabled={checking || draftEndpoint.trim().length === 0}
                      onClick={onConnect}
                    >
                      {labels.connect}
                    </Button>
                  )
                : (
                    <Button type="submit" size="lg" className="h-10" disabled={retrying}>
                      <RetryIcon data-icon="inline-start" className={cn(retrying && 'animate-spin')} aria-hidden="true" />
                      {retrying ? labels.retrying : labels.retry}
                    </Button>
                  )}

              {canConfigureEndpoint
                ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      className="h-10"
                      disabled={checking || draftEndpoint.trim().length === 0}
                      onClick={onTestConnection}
                    >
                      <TestConnectionIcon data-icon="inline-start" aria-hidden="true" />
                      {checking ? labels.testing : labels.test}
                    </Button>
                  )
                : null}

              {canConfigureEndpoint && hasCustomEndpoint
                ? (
                    <Button type="button" variant="ghost" size="lg" className="h-10" onClick={onUseDefault}>
                      <ResetIcon data-icon="inline-start" aria-hidden="true" />
                      {labels.useDefault}
                    </Button>
                  )
                : null}
            </div>
          </form>

          {canConfigureEndpoint
            ? (
                <p className="mt-6 text-pretty text-[11px] leading-4 text-muted-foreground">
                  {labels.securityNote}
                </p>
              )
            : null}

          {errorDetail
            ? (
                <details className="mt-5 text-[11px] text-muted-foreground">
                  <summary className="min-h-10 w-fit cursor-pointer content-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
                    {labels.details}
                  </summary>
                  <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 font-mono leading-4 shadow-[var(--shadow-inset-ring)]">
                    {errorDetail}
                  </pre>
                </details>
              )
            : null}
        </div>
      </section>
    </main>
  )
}
