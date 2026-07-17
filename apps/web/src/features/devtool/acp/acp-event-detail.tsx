// Input: ACP devtool store, cn utility
// Output: AcpEventDetail — metadata and raw output viewer for a selected ACP runtime event
// Position: Right pane of the ACP runtime mode inside the devtool page

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useAcpDevtoolStore } from './use-acp-events'

function formatCommand(command: string | null, args: string[] | null): string {
  if (!command) {
    return ''
  }
  return [command, ...(args ?? [])].join(' ')
}

export function AcpEventDetail() {
  const { t } = useTranslation('devtool')
  const selectedEventId = useAcpDevtoolStore(s => s.selectedEventId)
  const events = useAcpDevtoolStore(s => s.events)
  const event = useMemo(
    () => events.find(entry => entry.id === selectedEventId) ?? null,
    [events, selectedEventId],
  )

  if (!event) {
    return (
      <div className="flex h-full items-center justify-center p-4 font-mono text-xs text-muted-foreground">
        Select an ACP event to inspect
      </div>
    )
  }

  const commandLine = formatCommand(event.command, event.args)

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background font-mono">
      <div className="shrink-0 border-b border-border px-3 py-2 text-[10px]">
        <div className="flex items-baseline justify-between gap-2">
          <div className="truncate text-[11px] font-medium text-foreground">
            {event.agentId}
            {' '}
            ·
            {' '}
            {event.stream}
          </div>
          <div className="shrink-0 tabular-nums text-muted-foreground">
            {new Date(event.timestamp).toISOString()}
          </div>
        </div>
        <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-muted-foreground">
          <div>id</div>
          <div className="truncate text-foreground">{event.id}</div>
          <div>kind</div>
          <div className="text-foreground">{event.kind}</div>
          <div>pid</div>
          <div className="text-foreground">{event.pid ?? 'n/a'}</div>
          {commandLine && (
            <>
              <div>command</div>
              <div className="truncate text-foreground" title={commandLine}>{commandLine}</div>
            </>
          )}
          {event.cwd && (
            <>
              <div>cwd</div>
              <div className="truncate text-foreground" title={event.cwd}>{event.cwd}</div>
            </>
          )}
          {event.kind === 'exit' && (
            <>
              <div>exit</div>
              <div className="text-foreground">
                code=
                {event.exitCode ?? 'null'}
                {' '}
                signal=
                {event.signal ?? 'null'}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="shrink-0 border-b border-border bg-muted/10 px-3 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        Raw Output
      </div>

      <pre className="flex-1 overflow-auto whitespace-pre-wrap break-all p-3 text-[11px] leading-5">
        {event.text || <span className="text-muted-foreground">{t('events.empty')}</span>}
      </pre>
    </div>
  )
}
