import {
  ArrowLeftLine as ArrowLeftIcon,
  CornerUpLeftLine as CornerUpLeftIcon,
  DeleteLine as TrashIcon,
  LeftSmallLine as ChevronLeftIcon,
  More2Line as MoreHorizontalIcon,
  RightSmallLine as ChevronRightIcon,
} from '@mingcute/react'

import { Menu, MenuItem, MenuPopup, MenuTrigger } from '~/components/ui/menu'
import type { KanbanIssue, KanbanStatus } from '~/features/kanban/types'

import { StatusIcon } from '../shared/status-icon'
import type { StatusCategory } from '../use-view-config'

interface IssueHeaderProps {
  issue: KanbanIssue
  status?: KanbanStatus
  parentIssue?: KanbanIssue
  completedSubIssueCount: number
  totalSubIssueCount: number
  siblingNumber?: number
  siblingCount?: number
  previousSiblingIssue?: KanbanIssue
  nextSiblingIssue?: KanbanIssue
  onOpenIssue: (id: string) => void
  onBack: () => void
  onDelete: () => void
  readOnly?: boolean
}

export const IssueHeader = ({
  issue,
  status,
  parentIssue,
  completedSubIssueCount,
  totalSubIssueCount,
  siblingNumber,
  siblingCount,
  previousSiblingIssue,
  nextSiblingIssue,
  onOpenIssue,
  onBack,
  onDelete,
  readOnly = false,
}: IssueHeaderProps) => {
  return (
    <div
      className="flex h-11 shrink-0 items-center gap-1.5 border-b border-border px-3"
      data-testid="issue-detail-header"
    >
      <button
        type="button"
        onClick={onBack}
        className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-fill hover:text-foreground transition-colors shrink-0"
        data-testid="issue-detail-close-btn"
        aria-label="Back to board"
      >
        <ArrowLeftIcon className="size-4" aria-hidden="true" />
      </button>

      <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
        {parentIssue && (
          <>
            <button
              type="button"
              onClick={() => onOpenIssue(parentIssue.id)}
              className="flex min-w-0 max-w-52 items-center gap-1.5 rounded px-1.5 py-1 text-muted-foreground hover:bg-fill hover:text-foreground transition-colors"
              aria-label={`Open parent issue ${parentIssue.title}`}
              data-testid="issue-detail-parent-link"
            >
              <CornerUpLeftIcon className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{parentIssue.title}</span>
            </button>
            <ChevronRightIcon
              className="size-3 shrink-0 !text-muted-foreground/50"
              aria-hidden="true"
            />
          </>
        )}
        {status && (
          <>
            <span className="flex items-center gap-1.5 text-muted-foreground shrink-0">
              <StatusIcon category={status.category as StatusCategory} size={13} />
              <span>{status.name}</span>
            </span>
            <ChevronRightIcon
              className="size-3 !text-muted-foreground/50 shrink-0"
              aria-hidden="true"
            />
          </>
        )}
        <span className="text-foreground font-medium truncate">{issue.title}</span>
      </div>

      <div className="flex-1" />

      {totalSubIssueCount > 0 && (
        <span
          className="shrink-0 rounded-full border border-border bg-fill/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
          data-testid="issue-detail-sub-issue-progress"
        >
          {completedSubIssueCount}
/
{totalSubIssueCount}
{' '}
done
        </span>
      )}

      {siblingNumber && siblingCount && siblingCount > 1 && (
        <div
          className="flex shrink-0 items-center gap-0.5 rounded border border-border bg-card p-0.5"
          data-testid="issue-detail-sub-issue-switcher"
        >
          <button
            type="button"
            onClick={() => previousSiblingIssue && onOpenIssue(previousSiblingIssue.id)}
            disabled={!previousSiblingIssue}
            className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-fill hover:text-foreground disabled:pointer-events-none disabled:opacity-40 transition-colors"
            aria-label="Open previous sub-issue"
          >
            <ChevronLeftIcon className="size-3.5" aria-hidden="true" />
          </button>
          <span className="px-1 text-[11px] tabular-nums text-muted-foreground">
            {siblingNumber}
/
{siblingCount}
          </span>
          <button
            type="button"
            onClick={() => nextSiblingIssue && onOpenIssue(nextSiblingIssue.id)}
            disabled={!nextSiblingIssue}
            className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-fill hover:text-foreground disabled:pointer-events-none disabled:opacity-40 transition-colors"
            aria-label="Open next sub-issue"
          >
            <ChevronRightIcon className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {!readOnly && (
        <Menu>
          <MenuTrigger
            className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-fill hover:text-foreground transition-colors shrink-0"
            data-testid="issue-detail-menu-trigger"
            aria-label="Issue actions"
          >
            <MoreHorizontalIcon className="size-4" aria-hidden="true" />
          </MenuTrigger>
          <MenuPopup>
            <MenuItem
              onClick={onDelete}
              className="text-red-500"
              data-testid="issue-detail-delete-issue"
            >
              <TrashIcon className="size-3.5 mr-2" aria-hidden="true" />
              Delete issue
            </MenuItem>
          </MenuPopup>
        </Menu>
      )}
    </div>
  )
}
