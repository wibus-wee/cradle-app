// Input: ACP devtool Zustand stores, cn utility
// Output: AcpFilterBar — search, agent select, stream toggles, pause, and clear controls
// Position: Top toolbar for the ACP runtime pane inside the devtool page

import { cn } from '~/lib/cn'

import {
  useAcpAgentIds,
  useAcpDevtoolStore,
  useAcpFilteredEvents,
  useAcpFiltersStore,
} from './use-acp-events'

const STREAMS = [
  { key: 'stdout' as const, label: 'stdout', color: 'bg-sky-500' },
  { key: 'stderr' as const, label: 'stderr', color: 'bg-rose-500' },
  { key: 'lifecycle' as const, label: 'lifecycle', color: 'bg-violet-500' },
]

export function AcpFilterBar() {
  const events = useAcpDevtoolStore(s => s.events)
  const paused = useAcpDevtoolStore(s => s.paused)
  const setPaused = useAcpDevtoolStore(s => s.setPaused)
  const clear = useAcpDevtoolStore(s => s.clear)
  const filteredEvents = useAcpFilteredEvents()
  const agentIds = useAcpAgentIds()

  const filters = useAcpFiltersStore(s => s.filters)
  const setSearch = useAcpFiltersStore(s => s.setSearch)
  const setSelectedAgentId = useAcpFiltersStore(s => s.setSelectedAgentId)
  const toggleStream = useAcpFiltersStore(s => s.toggleStream)

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border bg-muted/20 px-3 py-2 font-mono text-[11px]">
      <input
        type="text"
        value={filters.search}
        onChange={event => setSearch(event.target.value)}
        placeholder="Filter agent / stream / output...  ( / to focus )"
        data-acp-devtool-search
        className="h-7 w-72 rounded border border-border bg-background px-2 text-[11px] placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary"
      />

      <select
        value={filters.selectedAgentId}
        onChange={event => setSelectedAgentId(event.target.value)}
        className="h-7 rounded border border-border bg-background px-2 text-[11px] focus:outline-none focus:ring-1 focus:ring-primary"
      >
        <option value="all">All agents</option>
        {agentIds.map(agentId => (
          <option key={agentId} value={agentId}>
            {agentId}
          </option>
        ))}
      </select>

      <div className="flex items-center gap-1">
        {STREAMS.map(stream => (
          <button
            key={stream.key}
            type="button"
            onClick={() => toggleStream(stream.key)}
            className={cn(
              'h-6 rounded border px-2 text-[10px] transition-colors',
              filters.streams[stream.key]
                ? 'border-border bg-background text-foreground'
                : 'border-border bg-muted/30 text-muted-foreground/50 line-through',
            )}
          >
            <span className={cn('mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle', stream.color)} />
            {stream.label}
          </button>
        ))}
      </div>

      <div className="flex-1" />

      <button
        type="button"
        onClick={() => setPaused(!paused)}
        className={cn(
          'h-6 rounded border border-border px-2 text-[10px] hover:bg-muted/50',
          paused ? 'bg-amber-500/20 text-amber-700 dark:text-amber-400' : 'bg-background',
        )}
      >
        {paused ? '▶ Resume' : '⏸ Pause'}
      </button>

      <button
        type="button"
        onClick={clear}
        className="h-6 rounded border border-border bg-background px-2 text-[10px] hover:bg-muted/50"
      >
        Clear
      </button>

      <div className="tabular-nums text-muted-foreground">
        {filteredEvents.length}
        {' '}
        /
        {events.length}
      </div>
    </div>
  )
}
