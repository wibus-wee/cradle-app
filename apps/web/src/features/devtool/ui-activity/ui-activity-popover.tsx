import {
  EyeLine as EyeIcon,
  HeartbeatLine as ActivityIcon,
  HistoryLine as HistoryIcon,
  RouteLine as RouteIcon,
  ShareForwardLine as SinkIcon,
} from '@mingcute/react'
import type { ReactNode } from 'react'
import { useSyncExternalStore } from 'react'

import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { Progress } from '~/components/ui/progress'
import {
  formatBrowserTabLabel,
  formatSurfaceRoute,
} from '~/features/activity/resolution-inputs'
import type { UiActivityEndReason, UiActivityEntityType, UiActivityEvent } from '~/features/activity/types'
import { cn } from '~/lib/cn'

import {
  getActivityDebugSnapshot,
  subscribeActivityDebug,
} from './activity-debug-store'

const ENTITY_TYPE_CHIP: Record<UiActivityEntityType, string> = {
  chat: 'bg-violet-500/10 text-violet-700 ring-violet-500/20 dark:text-violet-300',
  file: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300',
  settings: 'bg-slate-500/10 text-slate-700 ring-slate-500/20 dark:text-slate-300',
  pr: 'bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300',
  diff: 'bg-orange-500/10 text-orange-700 ring-orange-500/20 dark:text-orange-300',
  kanban: 'bg-pink-500/10 text-pink-700 ring-pink-500/20 dark:text-pink-300',
  plugin: 'bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300',
  work: 'bg-rose-500/10 text-rose-700 ring-rose-500/20 dark:text-rose-300',
  app: 'bg-blue-500/10 text-blue-700 ring-blue-500/20 dark:text-blue-300',
}

const END_REASON_CHIP: Record<UiActivityEndReason, string> = {
  'entity-changed': 'bg-muted text-muted-foreground ring-border',
  'idle': 'bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300',
  'hidden': 'bg-slate-500/10 text-slate-600 ring-slate-500/20 dark:text-slate-300',
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp))
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes > 0) {
    return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
  }
  return `${seconds}s`
}

function truncateEntity(entity: string, maxLength = 24): string {
  if (entity.length <= maxLength) {
    return entity
  }
  return `${entity.slice(0, maxLength - 1)}…`
}

function EntityTypeChip({ type }: { type: UiActivityEntityType }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset',
        ENTITY_TYPE_CHIP[type],
      )}
    >
      {type}
    </span>
  )
}

function PanelSection({
  icon,
  title,
  badge,
  children,
}: {
  icon: ReactNode
  title: string
  badge?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="px-3 py-2">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {icon}
        </span>
        <span className="flex-1 text-[11px] font-medium text-foreground">{title}</span>
        {badge}
      </div>
      <div className="rounded-lg bg-muted/20 px-2.5 py-2 ring-1 ring-border/60">
        {children}
      </div>
    </div>
  )
}

function InfoRow({ label, value, mono = true }: { label: string, value: string, mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="shrink-0 text-[10px] text-muted-foreground">{label}</span>
      <span
        className={cn(
          'min-w-0 text-right text-[11px] text-foreground',
          mono && 'font-mono',
        )}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}

function SinkChip({ kind, name }: { kind: 'host' | 'plugin', name: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-background px-2 py-1 ring-1 ring-border">
      <span className="text-[9px] font-medium text-muted-foreground">{kind}</span>
      <span className="font-mono text-[10px] text-foreground">{name}</span>
    </span>
  )
}

function EventTimelineItem({ event }: { event: UiActivityEvent }) {
  const isStarted = event.kind === 'ui.segment.started'

  return (
    <li className="relative pb-3 pl-5 last:pb-0">
      <span
        className={cn(
          'absolute left-0 top-1.5 size-2 rounded-full ring-2 ring-popover',
          isStarted ? 'bg-emerald-500' : 'bg-muted-foreground/50',
        )}
        aria-hidden="true"
      />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-foreground">
            {isStarted ? 'Segment started' : 'Segment ended'}
          </p>
          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
            {event.entity}
          </p>
        </div>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
          {formatTimestamp(event.occurredAt)}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <EntityTypeChip type={event.entityType} />
        {isStarted
          ? event.previousEntity && (
            <span className="text-[10px] text-muted-foreground">
              from
              {' '}
              <span className="font-mono">{truncateEntity(event.previousEntity, 18)}</span>
            </span>
          )
          : (
            <>
              <span
                className={cn(
                  'inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset',
                  END_REASON_CHIP[event.endReason],
                )}
              >
                {event.endReason}
              </span>
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {formatDuration(event.durationMs)}
              </span>
            </>
          )}
      </div>
    </li>
  )
}

function eventTimelineKey(event: UiActivityEvent): string {
  if (event.kind === 'ui.segment.started') {
    return `${event.kind}:${event.occurredAt}:${event.entity}:${event.previousEntity ?? 'none'}`
  }
  return `${event.kind}:${event.occurredAt}:${event.entity}:${event.endReason}:${event.durationMs}`
}

function useActivityDebugSnapshot() {
  return useSyncExternalStore(subscribeActivityDebug, getActivityDebugSnapshot, getActivityDebugSnapshot)
}

export function UiActivityPopover() {
  const debug = useActivityDebugSnapshot()
  const segment = debug.segment
  const segmentDurationMs = segment ? debug.now - segment.startedAt : 0
  const idleRemainingMs = segment
    ? Math.max(0, segment.startedAt + debug.idleTimeoutMs - debug.now)
    : 0
  const idleProgress = segment
    ? Math.min(100, (segmentDurationMs / debug.idleTimeoutMs) * 100)
    : 0
  const isActive = Boolean(segment && debug.resolution.visible)

  const triggerType = segment?.entityType ?? debug.resolution.resolved?.entityType ?? null
  const triggerEntity = segment?.entity ?? debug.resolution.resolved?.entity ?? null
  const sinkCount = debug.subscribers.host.length + debug.subscribers.plugin.length

  const triggerLabel = triggerType && triggerEntity
    ? `${triggerType} · ${truncateEntity(triggerEntity, 14)}`
    : 'idle'

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            'h-5 max-w-[15rem] gap-1 px-1.5 text-[11px] font-normal tabular-nums transition-transform hover:text-foreground active:scale-[0.96]',
            isActive ? 'text-foreground' : 'text-muted-foreground',
          )}
          aria-label={`UI Activity: ${triggerLabel}`}
          title="UI Activity"
        >
          <ActivityIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="whitespace-nowrap">UI Activity</span>
          <span
            className={cn('size-1.5 shrink-0 rounded-full', {
              'bg-emerald-500 shadow-[0_0_0_2px_rgba(16,185,129,0.25)]': isActive,
              'bg-muted-foreground/35': !isActive,
            })}
            aria-hidden="true"
          />
          <span className="truncate font-mono text-[10px]">{triggerLabel}</span>
          {segment && (
            <span className="shrink-0 text-muted-foreground">
              {formatDuration(segmentDurationMs)}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-xl gap-0 overflow-hidden p-0"
      >
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <ActivityIcon className="size-4" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-medium text-foreground">UI Activity</p>
              <p className="text-[10px] text-muted-foreground">
                Segment engine · entity · idle · hidden
              </p>
            </div>
          </div>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset',
              isActive
                ? 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300'
                : 'bg-muted text-muted-foreground ring-border',
            )}
          >
            <span
              className={cn('size-1.5 rounded-full', isActive ? 'bg-emerald-500' : 'bg-muted-foreground/50')}
              aria-hidden="true"
            />
            {isActive ? 'Live' : 'Idle'}
          </span>
        </div>

        {segment
          ? (
              <div className="mx-3 rounded-xl bg-muted/25 p-3 ring-1 ring-border/80">
                <div className="flex items-start gap-2.5">
                  <EntityTypeChip type={segment.entityType} />
                  <div className="min-w-0 flex-1">
                    <p className="break-all font-mono text-xs leading-snug text-foreground">
                      {segment.entity}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Started
                      {' '}
                      {formatTimestamp(segment.startedAt)}
                    </p>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-border">
                  <div className="bg-popover px-2.5 py-2">
                    <p className="text-[10px] text-muted-foreground">Duration</p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums leading-none">
                      {formatDuration(segmentDurationMs)}
                    </p>
                  </div>
                  <div className="bg-popover px-2.5 py-2">
                    <p className="text-[10px] text-muted-foreground">Idle in</p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums leading-none">
                      {formatDuration(idleRemainingMs)}
                    </p>
                  </div>
                  <div className="bg-popover px-2.5 py-2">
                    <p className="text-[10px] text-muted-foreground">Visible</p>
                    <p className="mt-0.5 flex items-center gap-1 text-sm font-semibold leading-none">
                      <EyeIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                      {debug.resolution.visible ? 'Yes' : 'No'}
                    </p>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>Idle timer</span>
                    <span className="tabular-nums">
                      {Math.round(idleProgress)}
                      %
                    </span>
                  </div>
                  <Progress value={idleProgress} className="h-1" />
                </div>
              </div>
            )
          : (
              <div className="mx-3 rounded-xl border border-dashed border-border/80 bg-muted/15 px-4 py-7 text-center">
                <ActivityIcon className="mx-auto size-7 text-muted-foreground/35" aria-hidden="true" />
                <p className="mt-2 text-xs font-medium text-foreground">No active segment</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Switch surfaces or wait for the idle boundary.
                </p>
              </div>
            )}

        <div className="mt-2 space-y-1 pb-1">
          <PanelSection
            icon={<RouteIcon className="size-3.5" aria-hidden="true" />}
            title="Resolution"
          >
            <InfoRow
              label="Surface"
              value={debug.resolution.activeSurface?.route
                ? formatSurfaceRoute(debug.resolution.activeSurface.route)
                : '—'}
            />
            <InfoRow
              label="Split pane"
              value={formatSurfaceRoute(debug.resolution.focusedSplitRoute)}
            />
            <InfoRow
              label="Browser tab"
              value={formatBrowserTabLabel(debug.resolution.activeBrowserTab)}
            />
            <InfoRow
              label="Resolved"
              value={debug.resolution.resolved
                ? `${debug.resolution.resolved.entityType}:${debug.resolution.resolved.entity}`
                : '—'}
            />
          </PanelSection>

          <PanelSection
            icon={<SinkIcon className="size-3.5" aria-hidden="true" />}
            title="Sinks"
            badge={(
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                {sinkCount}
              </span>
            )}
          >
            {sinkCount === 0
              ? (
                  <p className="py-1 text-center text-[11px] text-muted-foreground">No subscribers yet.</p>
                )
              : (
                  <div className="flex flex-wrap gap-1.5 py-0.5">
                    {debug.subscribers.host.map(owner => (
                      <SinkChip key={`host:${owner}`} kind="host" name={owner} />
                    ))}
                    {debug.subscribers.plugin.map(owner => (
                      <SinkChip key={`plugin:${owner}`} kind="plugin" name={owner} />
                    ))}
                  </div>
                )}
          </PanelSection>

          <PanelSection
            icon={<HistoryIcon className="size-3.5" aria-hidden="true" />}
            title="Recent events"
            badge={(
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                {debug.recentEvents.length}
              </span>
            )}
          >
            {debug.recentEvents.length === 0
              ? (
                  <p className="py-3 text-center text-[11px] text-muted-foreground">No events yet.</p>
                )
              : (
                  <ul className="relative max-h-[12rem] overflow-y-auto py-1 pl-1">
                    <span
                      className="pointer-events-none absolute bottom-2 left-[3px] top-2 w-px bg-border"
                      aria-hidden="true"
                    />
                    {debug.recentEvents.map(event => (
                      <EventTimelineItem
                        key={eventTimelineKey(event)}
                        event={event}
                      />
                    ))}
                  </ul>
                )}
          </PanelSection>
        </div>

        <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[10px] tabular-nums text-muted-foreground/70">
          <span className="inline-flex items-center gap-1">
            <ActivityIcon className="size-3" aria-hidden="true" />
            Live preview
          </span>
          <span>
            {debug.recentEvents.length}
            {' '}
            events buffered
          </span>
        </div>
      </PopoverContent>
    </Popover>
  )
}
