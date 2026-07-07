// Input: Zustand ipc-devtool stores, IpcTrace model, cn utility
// Output: IpcEventsTable — sortable, selectable table of IPC traces grouped by traceId
// Position: Left/main pane inside the IPC devtool page

import { useMemo, useState } from 'react'

import { cn } from '~/lib/cn'

import { flowColor } from '../flow-color'
import type { IpcTrace } from './use-ipc-events'
import { useIpcDevtoolStore, useIpcFilteredTraces } from './use-ipc-events'

function pad(n: number, w: number): string {
  return String(n).padStart(w, '0')
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}:${pad(d.getSeconds(), 2)}.${pad(d.getMilliseconds(), 3)}`
}

const STATUS_STYLES: Record<IpcTrace['status'], string> = {
  pending: 'bg-amber-500/20 text-amber-700 dark:text-amber-400',
  success: 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400',
  error: 'bg-rose-500/20 text-rose-700 dark:text-rose-400',
}

type SortKey = 'startedAt' | 'channel' | 'status' | 'durationMs'

export function IpcEventsTable() {
  const filteredTraces = useIpcFilteredTraces()
  const selectedTraceId = useIpcDevtoolStore(s => s.selectedTraceId)
  const selectTrace = useIpcDevtoolStore(s => s.selectTrace)
  const [sortKey, setSortKey] = useState<SortKey>('startedAt')
  const [sortDesc, setSortDesc] = useState(true)

  const traces = useMemo(() => {
    const sorted = [...filteredTraces].sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'startedAt':
          cmp = a.startedAt - b.startedAt
          break
        case 'channel':
          cmp = a.channel.localeCompare(b.channel)
          break
        case 'status':
          cmp = a.status.localeCompare(b.status)
          break
        case 'durationMs':
          cmp = (a.durationMs ?? Infinity) - (b.durationMs ?? Infinity)
          break
      }
      return sortDesc ? -cmp : cmp
    })
    return sorted
  }, [filteredTraces, sortKey, sortDesc])

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDesc(!sortDesc)
    }
    else {
      setSortKey(key)
      setSortDesc(true)
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) { return '' }
    return sortDesc ? ' ↓' : ' ↑'
  }

  return (
    <div className="relative h-full overflow-auto font-mono text-[11px]">
      <table className="w-full border-separate border-spacing-0 text-left">
        <thead className="sticky top-0 z-10 bg-muted/70 backdrop-blur">
          <tr>
            <th
              onClick={() => handleSort('startedAt')}
              className="cursor-pointer select-none border-b border-border px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
              style={{ width: 100 }}
            >
              Time
{sortIndicator('startedAt')}
            </th>
            <th
              onClick={() => handleSort('channel')}
              className="cursor-pointer select-none border-b border-border px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
              style={{ width: 260 }}
            >
              Channel
{sortIndicator('channel')}
            </th>
            <th
              className="select-none border-b border-border px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              style={{ width: 90 }}
            >
              Flow
            </th>
            <th
              onClick={() => handleSort('status')}
              className="cursor-pointer select-none border-b border-border px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
              style={{ width: 72 }}
            >
              Status
{sortIndicator('status')}
            </th>
            <th
              onClick={() => handleSort('durationMs')}
              className="cursor-pointer select-none border-b border-border px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
              style={{ width: 80 }}
            >
              Duration
{sortIndicator('durationMs')}
            </th>
            <th
              className="select-none border-b border-border px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              Args
            </th>
          </tr>
        </thead>
        <tbody>
          {traces.map((trace) => {
            const selected = trace.traceId === selectedTraceId
            const color = flowColor(trace.flowId)
            return (
              <tr
                key={trace.traceId}
                data-ipc-trace-id={trace.traceId}
                onClick={() => selectTrace(trace.traceId)}
                className={cn(
                  'cursor-pointer hover:bg-muted/30',
                  selected && 'bg-primary/10 hover:bg-primary/10',
                )}
              >
                <td className="truncate border-b border-border/40 px-2 py-1 align-middle tabular-nums text-muted-foreground">
                  {formatTime(trace.startedAt)}
                </td>
                <td className="truncate border-b border-border/40 px-2 py-1 align-middle">
                  <span className="flex min-w-0 items-center gap-1.5 font-mono">
                    {color
                      ? (
                          <span
                            className={cn('h-2 w-2 shrink-0 rounded-full', color)}
                            title={`flow: ${trace.flowId}`}
                            aria-hidden="true"
                          />
                        )
                      : (
                          <span className="h-2 w-2 shrink-0 rounded-full bg-transparent" aria-hidden="true" />
                        )}
                    <span className="truncate">{trace.channel}</span>
                  </span>
                </td>
                <td className="border-b border-border/40 px-2 py-1 align-middle">
                  <FlowDots trace={trace} />
                </td>
                <td className="border-b border-border/40 px-2 py-1 align-middle">
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide',
                      STATUS_STYLES[trace.status],
                    )}
                  >
                    {trace.status}
                  </span>
                </td>
                <td className="border-b border-border/40 px-2 py-1 align-middle">
                  {trace.durationMs === null
                    ? <span className="text-muted-foreground">…</span>
                    : (
                        <span
                          className={cn(
                            'block text-right tabular-nums',
                            trace.status === 'error'
                              ? 'text-rose-500'
                              : trace.durationMs > 100
                                ? 'text-amber-500 dark:text-amber-400'
                                : 'text-muted-foreground',
                          )}
                        >
                          {trace.durationMs}
                          ms
                        </span>
                      )}
                </td>
                <td className="truncate border-b border-border/40 px-2 py-1 align-middle text-muted-foreground">
                  {trace.args?.summary ?? ''}
                </td>
              </tr>
            )
          })}
          {traces.length === 0 && (
            <tr>
              <td
                colSpan={6}
                className="px-4 py-12 text-center text-muted-foreground"
              >
                No IPC traffic matches the current filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function FlowDots({ trace }: { trace: IpcTrace }) {
  const entries = [
    { key: 'renderer:start' as const, color: 'bg-sky-500' },
    { key: 'main:start' as const, color: 'bg-violet-500' },
    { key: 'main:finish' as const, color: 'bg-violet-500' },
    { key: 'renderer:finish' as const, color: 'bg-sky-500' },
  ]
  return (
    <div className="flex items-center gap-[3px]">
      {entries.map((entry, idx) => {
        const filled = trace.phases[entry.key] !== null
        return (
          <div key={entry.key} className="flex items-center gap-[3px]">
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                filled ? entry.color : 'bg-muted-foreground/20',
              )}
              title={entry.key}
            />
            {idx < entries.length - 1 && (
              <span className="block h-px w-1.5 bg-muted-foreground/30" />
            )}
          </div>
        )
      })}
    </div>
  )
}
