import {
  CheckLine as CheckIcon,
  CloseLine as XIcon,
  PlayLine as PlayIcon,
} from '@mingcute/react'

import { ShikiSnippet } from '~/components/editor/shiki-snippet'
import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { Spinner } from '~/components/ui/spinner'
import { cn } from '~/lib/cn'
import { formatTimeAgo } from '~/lib/format-time'

export type JavaScriptAwaitStatus = 'pending' | 'triggered' | 'failed' | 'expired' | 'cancelled'

export interface JavaScriptAwaitCardViewProps {
  status: JavaScriptAwaitStatus
  /** What the await is waiting for (the await's reason text). */
  title: string
  /** Human-readable current state (error text, completion summary, or reason). */
  statusText: string
  hasError: boolean
  program: string | null
  observation: unknown
  lastCheckedAt: number | null
  consecutiveErrors: number
  /** Set when a manual "Run now" preview matched the condition. */
  matchedText: string | null
  previewErrorText: string | null
  isRunning: boolean
  onRunNow?: () => void
  onCancel?: () => void
}

function formatObservationValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value) ?? String(value)
  }
  catch {
    return String(value)
  }
}

/** Renders a cell-reported progress observation; `{ note, ...rest }` objects lead with the note. */
function ObservationView({ observation }: { observation: unknown }) {
  if (observation !== null && typeof observation === 'object' && !Array.isArray(observation)) {
    const entries = Object.entries(observation as Record<string, unknown>)
    const note = entries.find(([key, value]) => key === 'note' && typeof value === 'string')?.[1] as string | undefined
    const rest = entries.filter(([key]) => key !== 'note')
    return (
      <div className="space-y-0.5">
        {note && <span className="block text-[11px] text-foreground/80">{note}</span>}
        {rest.map(([key, value]) => (
          <span key={key} className="block break-words font-mono text-[10px] text-muted-foreground">
            {key}
            :
            {' '}
            {formatObservationValue(value)}
          </span>
        ))}
      </div>
    )
  }
  return (
    <span className="block break-words font-mono text-[10px] text-muted-foreground">
      {formatObservationValue(observation)}
    </span>
  )
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="mb-1 text-[9px] font-medium uppercase tracking-wider text-muted-foreground/50">
      {children}
    </div>
  )
}

/**
 * Presentational card for a JavaScript condition await: the polled program is the
 * identity, the latest observation is the evidence, and the status pill is the state.
 */
export function JavaScriptAwaitCardView({
  status,
  title,
  statusText,
  hasError,
  program,
  observation,
  lastCheckedAt,
  consecutiveErrors,
  matchedText,
  previewErrorText,
  isRunning,
  onRunNow,
  onCancel,
}: JavaScriptAwaitCardViewProps) {
  const isPending = status === 'pending'

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-card inset-shadow-[0_1px_--theme(--color-white/10%)]',
        hasError ? 'border-red-500/35' : 'border-border/70',
      )}
      data-testid="javascript-await-card"
      data-status={status}
    >
      {/* Header: what we wait for + which state it is in */}
      <div className="flex items-start gap-2.5 px-3 pt-2.5 pb-2">
        <span
          className={cn(
            'flex size-7 shrink-0 select-none items-center justify-center rounded-md',
            'bg-[#f7df1e] text-[11px] font-bold tracking-tight text-black/75',
            'inset-shadow-[0_1px_--theme(--color-white/50%)] shadow-sm',
            hasError && 'ring-1 ring-red-500/40',
          )}
          aria-hidden
        >
          JS
        </span>
        <div className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium leading-4 text-foreground">
            {isPending && <span className="size-1 shrink-0 rounded-full bg-amber-500 animate-pulse" aria-hidden />}
            <span className="min-w-0 break-words">{title}</span>
          </span>
          {statusText && statusText !== title && (
            <span
              className={cn(
                'block min-w-0 break-words text-[11px] leading-4',
                hasError ? 'text-red-500' : status === 'triggered' ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground/70',
              )}
            >
              {statusText}
            </span>
          )}
        </div>
        {isPending && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 rounded p-0.5 text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Cancel await"
          >
            <XIcon className="size-3" />
          </button>
        )}
      </div>

      {/* The polled condition; click the preview to read it in full */}
      {program && (
        <div className="px-3 pb-2">
          <SectionLabel>Condition</SectionLabel>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="block w-full overflow-hidden rounded-md border border-border/60 bg-muted/30 text-left transition-[transform,background-color,border-color] duration-150 hover:border-border hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 active:translate-y-px active:bg-muted/60 active:duration-75"
                aria-label="View full condition program"
              >
                <div className="pointer-events-none max-h-28 overflow-auto">
                  <ShikiSnippet
                    code={program}
                    language="javascript"
                    wrap={false}
                    className="w-fit min-w-full p-2 text-[10.5px] leading-4"
                    fallbackClassName="whitespace-pre p-2 text-[10.5px] leading-4"
                  />
                </div>
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" side="bottom" className="w-[28rem] max-w-[80vw] p-0">
              <div className="max-h-[60vh] overflow-auto">
                <ShikiSnippet code={program} language="javascript" />
              </div>
            </PopoverContent>
          </Popover>
        </div>
      )}

      {/* Evidence from the latest evaluation */}
      {observation != null && (
        <div className="px-3 pb-2">
          <SectionLabel>Last observation</SectionLabel>
          <div className="max-h-32 overflow-y-auto rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 leading-4">
            <ObservationView observation={observation} />
          </div>
        </div>
      )}

      {matchedText && (
        <div className="px-3 pb-2">
          <div className="flex items-start gap-1.5 rounded-md bg-green-500/10 px-2 py-1.5 text-[11px] leading-4 text-green-600 dark:text-green-400">
            <CheckIcon className="mt-0.5 size-3 shrink-0" strokeWidth={2.2} aria-hidden />
            <span className="min-w-0 break-words">
              Condition met:
              {' '}
              {matchedText}
            </span>
          </div>
        </div>
      )}
      {previewErrorText && (
        <div className="px-3 pb-2">
          <div className="flex items-start gap-1.5 rounded-md bg-red-500/10 px-2 py-1.5 text-[11px] leading-4 text-red-500">
            <XIcon className="mt-0.5 size-3 shrink-0" strokeWidth={2.1} aria-hidden />
            <span className="min-w-0 break-words">{previewErrorText}</span>
          </div>
        </div>
      )}

      {/* Footer: polling cadence + manual evaluation */}
      <div className="flex items-center gap-2 border-t border-border/50 px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground/60">
          {lastCheckedAt ? `Checked ${formatTimeAgo(lastCheckedAt)}` : 'Not checked yet'}
          {consecutiveErrors > 0 && (
            <span className="text-amber-500">
              {' · '}
              {consecutiveErrors}
              {' eval error'}
              {consecutiveErrors === 1 ? '' : 's'}
            </span>
          )}
        </span>
        {isPending && onRunNow && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 gap-1 px-1.5 text-[10px] text-muted-foreground/70 hover:text-foreground"
            disabled={isRunning}
            onClick={onRunNow}
          >
            {isRunning ? <Spinner className="size-3" /> : <PlayIcon className="size-3" aria-hidden />}
            Run now
          </Button>
        )}
      </div>
    </div>
  )
}
