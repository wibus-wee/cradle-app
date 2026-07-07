import { CalendarLine as CalendarIcon, Flag2Line as FlagIcon } from '@mingcute/react'

import type { KanbanMilestone } from '~/features/kanban/types'
import { cn } from '~/lib/cn'

import type { MilestoneProgressSummary } from './milestone-progress'

export function MilestoneBanner({
  milestone,
  progress,
  onOpenMilestone,
}: {
  milestone: KanbanMilestone
  progress: MilestoneProgressSummary
  onOpenMilestone?: (id: string) => void
}) {
  const dueDateLabel = milestone.dueDate
    ? new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(new Date(milestone.dueDate * 1000))
    : 'No due date'
  const isClosed = milestone.status === 'closed'

  return (
    <button
      type="button"
      onClick={() => onOpenMilestone?.(milestone.id)}
      disabled={!onOpenMilestone}
      className={cn(
        'mt-4 mb-5 flex w-full flex-col gap-3 rounded-lg bg-card p-3 text-left shadow-xs ring-1 ring-border',
        'transition-[background-color,box-shadow,transform] hover:bg-fill/60 hover:shadow-sm active:scale-[0.99]',
        'disabled:pointer-events-none',
      )}
      data-testid="issue-milestone-banner"
      aria-label={`Open milestone ${milestone.title}`}
    >
      <div className="flex items-start gap-3">
        <span className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-md',
          isClosed ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300' : 'bg-blue-500/10 text-blue-600 dark:text-blue-300',
        )}
        >
          <FlagIcon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px] font-semibold text-foreground">{milestone.title}</span>
            <span className={cn(
              'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize',
              isClosed ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300' : 'bg-blue-500/10 text-blue-600 dark:text-blue-300',
            )}
            >
              {milestone.status}
            </span>
          </div>
          {milestone.description && (
            <p className="mt-1 line-clamp-2 text-[12px] font-normal leading-5 text-muted-foreground">
              {milestone.description}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <span className="tabular-nums">
          {progress.completed}
/
{progress.total}
{' '}
done
        </span>
        <span className="flex min-w-0 items-center gap-1">
          <CalendarIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{dueDateLabel}</span>
        </span>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-150',
            isClosed ? 'bg-emerald-500' : 'bg-blue-500',
          )}
          style={{ width: `${progress.percentage}%` }}
        />
      </div>
    </button>
  )
}
