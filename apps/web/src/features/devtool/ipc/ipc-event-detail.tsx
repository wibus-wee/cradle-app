// Input: Zustand selection store, cn utility
// Output: IpcEventDetail — selected trace metadata + args/result/error/stack tabs + flow timeline for push streams
// Position: Right pane inside the IPC devtool page

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '~/lib/cn'

import { flowColor } from '../flow-color'
import type { IpcDetailTab, IpcObservedPayload, IpcTrace, IpcTracePhases } from './use-ipc-events'
import { useIpcDevtoolStore, useIpcFlowTraces, useIpcTraces } from './use-ipc-events'

const TABS: Array<{ key: IpcDetailTab, label: string }> = [
  { key: 'args', label: 'Args' },
  { key: 'result', label: 'Result' },
  { key: 'error', label: 'Error' },
  { key: 'stack', label: 'Stack' },
]

const PHASE_ORDER: Array<keyof IpcTracePhases> = [
  'renderer:start',
  'main:start',
  'main:finish',
  'renderer:finish',
]

function formatPayload(payload: IpcObservedPayload | null): string {
  if (!payload) { return '' }
  try {
    const value = JSON.parse(payload.json)
    return JSON.stringify(value, null, 2)
  }
  catch {
    return payload.json
  }
}

function pad(n: number, w: number): string {
  return String(n).padStart(w, '0')
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(d.getSeconds(), 2)}.${pad(d.getMilliseconds(), 3)}`
}

function formatDelta(ms: number): string {
  if (ms < 1000) { return `+${ms}ms` }
  return `+${(ms / 1000).toFixed(2)}s`
}

export function IpcEventDetail() {
  const { t } = useTranslation('devtool')
  const selectedTraceId = useIpcDevtoolStore(s => s.selectedTraceId)
  const traces = useIpcTraces()
  const trace = useMemo(
    () => traces.find(t => t.traceId === selectedTraceId) ?? null,
    [traces, selectedTraceId],
  )
  const flowTraces = useIpcFlowTraces(trace?.flowId ?? null)
  const tab = useIpcDevtoolStore(s => s.detailTab)
  const setTab = useIpcDevtoolStore(s => s.setDetailTab)

  if (!trace) {
    return (
      <div className="flex h-full items-center justify-center p-4 font-mono text-xs text-muted-foreground">
        Select a trace to inspect
      </div>
    )
  }

  const payloadText = (() => {
    switch (tab) {
      case 'args':
        return formatPayload(trace.args)
      case 'result':
        return formatPayload(trace.result)
      case 'error':
        return formatPayload(trace.error)
      case 'stack':
        return trace.callerStack.join('\n')
    }
  })()

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background font-mono">
      <div className="shrink-0 border-b border-border px-3 py-2 text-[10px]">
        <div className="flex items-baseline justify-between gap-2">
          <div className="truncate text-[11px] font-medium text-foreground">{trace.channel}</div>
          <div className="shrink-0 tabular-nums text-muted-foreground">
            {trace.durationMs !== null ? `${trace.durationMs}ms` : 'pending'}
          </div>
        </div>
        <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-muted-foreground">
          <div>trace</div>
          <div className="truncate text-foreground">{trace.traceId}</div>
          <div>started</div>
          <div className="text-foreground">{new Date(trace.startedAt).toISOString()}</div>
          <div>status</div>
          <div className="text-foreground">{trace.status}</div>
          {trace.flowId && (
            <>
              <div>flow</div>
              <div className="truncate text-foreground">{trace.flowId}</div>
            </>
          )}
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1">
          {PHASE_ORDER.map((key) => {
            const ev = trace.phases[key]
            return (
              <div
                key={key}
                className={cn(
                  'rounded border px-1.5 py-1 text-[9px]',
                  ev === null
                    ? 'border-border bg-muted/20 text-muted-foreground'
                    : ev.status === 'error'
                      ? 'border-rose-500/40 bg-rose-500/10'
                      : ev.status === 'success'
                        ? 'border-emerald-500/40 bg-emerald-500/10'
                        : 'border-amber-500/40 bg-amber-500/10',
                )}
              >
                <div className="font-medium">{key}</div>
                <div className="tabular-nums text-muted-foreground">
                  {ev === null
                    ? 'missing'
                    : ev.durationMs !== null
                      ? `${ev.durationMs}ms`
                      : '—'}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 border-b border-border bg-muted/10 px-2 py-1">
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              'h-6 rounded px-2 text-[10px] font-medium transition-colors',
              tab === t.key
                ? 'border border-border bg-background text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => {
            if (payloadText) {
              void navigator.clipboard.writeText(payloadText)
            }
          }}
          className="h-6 rounded border border-border bg-background px-2 text-[10px] hover:bg-muted/40"
        >
          Copy
        </button>
      </div>

      <pre className="flex-1 overflow-auto whitespace-pre-wrap break-all p-3 text-[11px] leading-5">
        {payloadText || <span className="text-muted-foreground">{t('events.empty')}</span>}
      </pre>

      {flowTraces.length > 1 && (
        <FlowTimeline traces={flowTraces} selectedTraceId={selectedTraceId} flowId={trace.flowId} />
      )}
    </div>
  )
}

interface FlowTimelineProps {
  traces: IpcTrace[]
  selectedTraceId: string | null
  flowId: string | undefined
}

function FlowTimeline({ traces, selectedTraceId, flowId }: FlowTimelineProps) {
  const selectTrace = useIpcDevtoolStore(s => s.selectTrace)
  const t0 = traces[0]?.startedAt ?? 0
  const totalMs = (traces.at(-1)?.startedAt ?? t0) - t0
  const color = flowColor(flowId)

  return (
    <div className="shrink-0 max-h-[40%] overflow-auto border-t border-border bg-muted/10">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-muted/60 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground backdrop-blur">
        {color && (
          <span className={cn('h-2 w-2 shrink-0 rounded-full', color)} aria-hidden="true" />
        )}
        <span className="shrink-0">Flow</span>
        <span className="shrink-0 text-muted-foreground/70">·</span>
        <span className="shrink-0 tabular-nums">
          {traces.length}
          {' '}
          events
        </span>
        {flowId && (
          <span className="min-w-0 truncate normal-case text-muted-foreground/80" title={flowId}>
            {flowId}
          </span>
        )}
        <span className="ml-auto shrink-0 tabular-nums normal-case text-muted-foreground">
          total
          {' '}
          {totalMs}
          ms
        </span>
      </div>
      <div className="sticky top-6.25 z-10 grid grid-cols-[96px_72px_1fr_1fr] gap-2 border-b border-border bg-muted/40 px-2 py-1 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>Time</span>
        <span className="text-right">Δ</span>
        <span>Channel</span>
        <span>Payload</span>
      </div>
      <ul className="divide-y divide-border/40 text-[11px]">
        {traces.map((t) => {
          const selected = t.traceId === selectedTraceId
          const delta = t.startedAt - t0
          return (
            <li key={t.traceId}>
              <button
                type="button"
                onClick={() => selectTrace(t.traceId)}
                className={cn(
                  'grid w-full grid-cols-[96px_72px_1fr_1fr] items-center gap-2 px-2 py-1 text-left hover:bg-muted/40',
                  selected && 'bg-primary/10 hover:bg-primary/10',
                )}
              >
                <span className="truncate tabular-nums text-muted-foreground">
                  {formatTime(t.startedAt)}
                </span>
                <span className="truncate text-right tabular-nums text-muted-foreground">
                  {formatDelta(delta)}
                </span>
                <span className="truncate font-mono text-foreground">{t.channel}</span>
                <span className="truncate text-muted-foreground">
                  {t.result?.summary ?? t.args?.summary ?? t.error?.summary ?? ''}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
