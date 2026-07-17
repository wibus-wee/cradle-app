// Input: Zustand ipc-devtool stores, @cradle/ipc status/side types, cn utility
// Output: IpcFilterBar — search / status / side toggles + pause & clear controls for the devtool
// Position: Top toolbar inside the IPC devtool page

import { useTranslation } from 'react-i18next'

import { cn } from '~/lib/cn'

import type { IpcObservedSide, IpcObservedStatus } from './use-ipc-events'
import { useIpcDevtoolStore, useIpcFiltersStore, useIpcTraces } from './use-ipc-events'

const STATUSES: Array<{ key: IpcObservedStatus, label: string, color: string }> = [
  { key: 'pending', label: 'pending', color: 'bg-amber-500' },
  { key: 'success', label: 'success', color: 'bg-emerald-500' },
  { key: 'error', label: 'error', color: 'bg-rose-500' },
]

const SIDES: Array<{ key: IpcObservedSide, label: string }> = [
  { key: 'renderer', label: 'R' },
  { key: 'main', label: 'M' },
]

export function IpcFilterBar() {
  const { t } = useTranslation('devtool')
  const events = useIpcDevtoolStore(s => s.events)
  const paused = useIpcDevtoolStore(s => s.paused)
  const setPaused = useIpcDevtoolStore(s => s.setPaused)
  const clear = useIpcDevtoolStore(s => s.clear)
  const traces = useIpcTraces()

  const filters = useIpcFiltersStore(s => s.filters)
  const setSearch = useIpcFiltersStore(s => s.setSearch)
  const toggleStatus = useIpcFiltersStore(s => s.toggleStatus)
  const toggleSide = useIpcFiltersStore(s => s.toggleSide)

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border bg-muted/20 px-3 py-2 font-mono text-[11px]">
      <input
        type="text"
        value={filters.search}
        onChange={e => setSearch(e.target.value)}
        placeholder={t('ipc.filter.placeholder')}
        data-ipc-devtool-search
        className="h-7 w-72 rounded border border-border bg-background px-2 text-[11px] placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary"
      />

      <div className="flex items-center gap-1">
        {STATUSES.map(s => (
          <button
            key={s.key}
            type="button"
            onClick={() => toggleStatus(s.key)}
            className={cn(
              'h-6 rounded border px-2 text-[10px] transition-colors',
              filters.statuses[s.key]
                ? 'border-border bg-background text-foreground'
                : 'border-border bg-muted/30 text-muted-foreground/50 line-through',
            )}
          >
            <span className={cn('mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle', s.color)} />
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1">
        {SIDES.map(s => (
          <button
            key={s.key}
            type="button"
            onClick={() => toggleSide(s.key)}
            title={s.key}
            className={cn(
              'h-6 w-7 rounded border text-[10px] font-medium transition-colors',
              filters.sides[s.key]
                ? 'border-border bg-background text-foreground'
                : 'border-border bg-muted/30 text-muted-foreground/50 line-through',
            )}
          >
            {s.label}
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
        {traces.length}
        {' '}
        /
        {events.length}
      </div>
    </div>
  )
}
