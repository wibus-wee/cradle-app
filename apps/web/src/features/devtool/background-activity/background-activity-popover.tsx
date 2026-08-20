import { Refresh1Line as RefreshIcon, TaskLine as TaskIcon } from '@mingcute/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  getBackgroundActivitiesOptions,
  getBackgroundActivitiesQueryKey,
  postBackgroundActivitiesByOwnerNamespaceByKeyRunMutation,
} from '~/api-gen/@tanstack/react-query.gen'
import type { GetBackgroundActivitiesResponse } from '~/api-gen/types.gen'
import { Button } from '~/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover'
import { cn } from '~/lib/cn'

const REFRESH_INTERVAL_MS = 2_000

type BackgroundActivity = GetBackgroundActivitiesResponse[number]

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp))
}

function getStatusLabel(status: BackgroundActivity['status']): string {
  if (status === 'running') { return 'Running' }
  if (status === 'succeeded') { return 'Completed' }
  if (status === 'failed') { return 'Failed' }
  return 'Idle'
}

function statusClassName(status: BackgroundActivity['status']): string {
  return cn('border', {
    'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300': status === 'running',
    'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300': status === 'succeeded',
    'border-destructive/25 bg-destructive/10 text-destructive': status === 'failed',
    'border-border bg-muted/50 text-muted-foreground': status === 'idle',
  })
}

function formatProgress(progress: BackgroundActivity['progress'], trigger: string): string {
  if (!progress || typeof progress !== 'object') { return `Triggered by ${trigger}` }
  const progressRecord = progress as Record<string, unknown>
  if (typeof progressRecord.completed === 'number' && typeof progressRecord.total === 'number') {
    return `${progressRecord.completed}/${progressRecord.total} worktrees measured`
  }
  return 'Reporting progress'
}

function ActivityRow({ activity }: { activity: BackgroundActivity }) {
  const queryClient = useQueryClient()
  const run = useMutation({
    ...postBackgroundActivitiesByOwnerNamespaceByKeyRunMutation(),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: getBackgroundActivitiesQueryKey() }),
  })

  return (
    <li className="border-b border-border/60 px-3 py-3 last:border-b-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-xs font-medium text-foreground">{activity.title}</p>
            <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums', statusClassName(activity.status))}>{getStatusLabel(activity.status)}</span>
          </div>
          <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
{activity.ownerNamespace}
{' '}
·
{' '}
{activity.key}
{' '}
·
{' '}
{activity.priority}
{' '}
priority
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">
{formatProgress(activity.progress, activity.trigger)}
{' '}
· updated
{' '}
<span className="tabular-nums">{formatTimestamp(activity.updatedAt)}</span>
          </p>
          {activity.lastError && <p className="mt-1 text-[10px] text-destructive">{activity.lastError}</p>}
        </div>
        {activity.manuallyRunnable && (
          <Button type="button" variant="ghost" size="icon-sm" disabled={run.isPending || activity.status === 'running'} onClick={() => run.mutate({ path: { ownerNamespace: activity.ownerNamespace, key: activity.key } })} className="shrink-0 active:scale-[0.96] transition-transform" aria-label={`Run ${activity.title}`} title={`Run ${activity.title}`}>
            <RefreshIcon className={cn('size-3.5', { 'animate-spin': run.isPending || activity.status === 'running' })} aria-hidden="true" />
          </Button>
        )}
      </div>
    </li>
  )
}

export function BackgroundActivityPopover() {
  const activities = useQuery({
    ...getBackgroundActivitiesOptions(),
    refetchInterval: query => query.state.data?.some(activity => activity.status === 'running') ? REFRESH_INTERVAL_MS : false,
  })

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="flex h-6 items-center gap-1 rounded px-2 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground active:scale-[0.96]" title="Background activity" aria-label="Background activity">
          <TaskIcon className="size-3.5" aria-hidden="true" />
          <span>Activity</span>
          {activities.data?.some(activity => activity.status === 'running') && <span className="size-1.5 rounded-full bg-amber-500" aria-label="Background activity running" />}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[26rem] overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <div>
<p className="text-xs font-medium text-foreground">Background activity</p>
<p className="mt-0.5 text-[10px] text-muted-foreground">Runtime work outside the active request</p>
          </div>
          <span className="text-[10px] tabular-nums text-muted-foreground">{activities.data?.length ?? 0}</span>
        </div>
        {activities.isLoading && <p className="px-3 py-6 text-center text-xs text-muted-foreground">Loading activity…</p>}
        {activities.isError && <p className="px-3 py-6 text-center text-xs text-destructive">Could not load background activity.</p>}
        {activities.data?.length === 0 && <p className="px-3 py-6 text-center text-xs text-muted-foreground">No registered background activity.</p>}
        {activities.data && activities.data.length > 0 && <ul className="max-h-[26rem] overflow-y-auto">{activities.data.map(activity => <ActivityRow key={`${activity.ownerNamespace}:${activity.key}`} activity={activity} />)}</ul>}
      </PopoverContent>
    </Popover>
  )
}
