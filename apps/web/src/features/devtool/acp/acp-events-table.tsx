// Input: ACP devtool stores, filtered ACP process events, cn utility
// Output: AcpEventsTable — selectable event timeline for ACP lifecycle and stream output
// Position: Left pane of the ACP runtime mode inside the devtool page

import { cn } from '~/lib/cn'

import { useAcpDevtoolStore, useAcpFilteredEvents } from './use-acp-events'

function pad(n: number, w: number): string {
  return String(n).padStart(w, '0')
}

function formatTime(ts: number): string {
  const date = new Date(ts)
  return `${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}.${pad(date.getMilliseconds(), 3)}`
}

const STREAM_STYLES = {
  stdout: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  stderr: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  lifecycle: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
} as const

export function AcpEventsTable() {
  const events = useAcpFilteredEvents()
  const selectedEventId = useAcpDevtoolStore(s => s.selectedEventId)
  const selectEvent = useAcpDevtoolStore(s => s.selectEvent)

  return (
    <div className="relative h-full overflow-auto font-mono text-[11px]">
      <table className="w-full border-separate border-spacing-0 text-left">
        <thead className="sticky top-0 z-10 bg-muted/70 backdrop-blur">
          <tr>
            <th className="border-b border-border px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Time</th>
            <th className="border-b border-border px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Agent</th>
            <th className="border-b border-border px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Stream</th>
            <th className="border-b border-border px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Kind</th>
            <th className="border-b border-border px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Payload</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => {
            const selected = event.id === selectedEventId
            return (
              <tr
                key={event.id}
                data-acp-event-id={event.id}
                onClick={() => selectEvent(event.id)}
                className={cn(
                  'cursor-pointer hover:bg-muted/30',
                  selected && 'bg-primary/10 hover:bg-primary/10',
                )}
              >
                <td className="border-b border-border/40 px-2 py-1 align-middle tabular-nums text-muted-foreground">
                  {formatTime(event.timestamp)}
                </td>
                <td className="max-w-44 truncate border-b border-border/40 px-2 py-1 align-middle">
                  {event.agentId}
                </td>
                <td className="border-b border-border/40 px-2 py-1 align-middle">
                  <span className={cn('rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide', STREAM_STYLES[event.stream])}>
                    {event.stream}
                  </span>
                </td>
                <td className="border-b border-border/40 px-2 py-1 align-middle text-muted-foreground">
                  {event.kind}
                </td>
                <td className="max-w-0 border-b border-border/40 px-2 py-1 align-middle">
                  <span className="block truncate text-muted-foreground">{event.text}</span>
                </td>
              </tr>
            )
          })}
          {events.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                No ACP runtime events match the current filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
