import { CalendarLine as CalendarIcon } from '@mingcute/react'
import type { ReactElement } from 'react'

import { HoverCard, HoverCardContent, HoverCardTrigger } from '~/components/ui/preview-card'
import type { Workspace } from '~/features/workspace/types'
import { cn } from '~/lib/cn'

import type { KanbanStatus } from '../types'
import type { IssuePriority } from '../use-kanban'
import { formatIssueId } from './format-issue-id'
import { LabelChip } from './label-chip'
import { PriorityIcon } from './priority-icon'
import { StatusIcon } from './status-icon'

/** Minimal shape a preview needs — satisfied by a full `KanbanIssue` or a relation counterpart. */
export interface IssueHoverCardData {
  id: string
  workspaceId: string
  number: number
  title: string
  statusId: string | null
  priority: IssuePriority
  labels?: string[]
  dueDate?: number | null
}

const priorityLabels: Record<IssuePriority, string> = {
  none: 'No priority',
  low: 'Low priority',
  medium: 'Medium priority',
  high: 'High priority',
  urgent: 'Urgent priority',
}

const LABEL_PREVIEW_LIMIT = 3

/**
 * Linear-style reference preview: hovering an issue mention/breadcrumb/chip
 * surfaces its key, status, title, priority, labels, and due date without
 * navigating. The trigger renders as `display:contents` so it never adds an
 * extra interactive element around the wrapped child.
 */
export function IssueHoverCard({
  issue,
  statuses,
  workspaces,
  children,
  disabled = false,
}: {
  issue: IssueHoverCardData
  statuses: KanbanStatus[]
  workspaces: Workspace[]
  children: ReactElement
  disabled?: boolean
}) {
  if (disabled) {
    return children
  }

  const status = statuses.find(candidate => candidate.id === issue.statusId)
  const dueDateLabel = issue.dueDate
    ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
        new Date(issue.dueDate * 1000),
      )
    : null
  const labels = issue.labels ?? []
  const visibleLabels = labels.slice(0, LABEL_PREVIEW_LIMIT)
  const overflowCount = labels.length - visibleLabels.length

  return (
    <HoverCard>
      <HoverCardTrigger delay={350} closeDelay={100} render={<span className="contents" />}>
        {children}
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-72 p-3" data-testid="issue-hover-card">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="font-mono tabular-nums">{formatIssueId(issue, workspaces)}</span>
          {status && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <StatusIcon category={status.category} size={12} />
              <span className="truncate">{status.name}</span>
            </>
          )}
        </div>

        <p className="mt-1.5 line-clamp-3 text-[13px] font-medium leading-snug text-foreground">
          {issue.title}
        </p>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <PriorityIcon priority={issue.priority} size={12} />
            {priorityLabels[issue.priority]}
          </span>
          {dueDateLabel && (
            <span className="flex items-center gap-1">
              <CalendarIcon className="size-3" aria-hidden="true" />
              {dueDateLabel}
            </span>
          )}
        </div>

        {visibleLabels.length > 0 && (
          <div className={cn('mt-2 flex flex-wrap items-center gap-1')}>
            {visibleLabels.map(label => (
              <LabelChip key={label} label={label} />
            ))}
            {overflowCount > 0 && (
              <span className="text-[10px] text-muted-foreground/70">
                +
                {overflowCount}
              </span>
            )}
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}
