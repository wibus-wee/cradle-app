import {
  ArrowLeftLine as ArrowLeftIcon,
  CopyLine as CopyIcon,
  CornerUpLeftLine as CornerUpLeftIcon,
  DeleteLine as TrashIcon,
  LeftSmallLine as ChevronLeftIcon,
  More2Line as MoreHorizontalIcon,
  RightSmallLine as ChevronRightIcon,
} from '@mingcute/react'

import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '~/components/ui/menu'
import { toastManager } from '~/components/ui/toast'
import type { KanbanIssue, KanbanStatus } from '~/features/kanban/types'
import type { Workspace } from '~/features/workspace/types'

import { formatIssueId } from '../shared/format-issue-id'
import { IssueHoverCard } from '../shared/issue-hover-card'
import { StatusIcon } from '../shared/status-icon'
import type { StatusCategory } from '../use-board-view'

interface IssueHeaderProps {
  issue: KanbanIssue
  status?: KanbanStatus
  statuses: KanbanStatus[]
  workspaces: Workspace[]
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
  statuses,
  workspaces,
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
  const issueKey = formatIssueId(issue, workspaces)

  const copyIssueId = () => {
    void navigator.clipboard.writeText(issueKey)
    toastManager.add({ type: 'success', title: 'Copied issue ID', description: issueKey })
  }

  return (
    <div
      className="flex h-11 shrink-0 items-center gap-1.5 border-b border-border px-3"
      data-testid="issue-detail-header"
    >
      <button
        type="button"
        onClick={onBack}
        className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-fill hover:text-foreground"
        data-testid="issue-detail-close-btn"
        aria-label="Back to board"
      >
        <ArrowLeftIcon className="size-4" aria-hidden="true" />
      </button>

      <div className="flex min-w-0 items-center gap-1.5 text-[13px]">
        <button
          type="button"
          onClick={copyIssueId}
          className="shrink-0 rounded px-1.5 py-1 font-mono text-[12px] tabular-nums text-muted-foreground transition-colors hover:bg-fill hover:text-foreground"
          title="Copy issue ID"
          data-testid="issue-detail-key-badge"
        >
          {issueKey}
        </button>
        <ChevronRightIcon
          className="size-3 shrink-0 !text-muted-foreground/50"
          aria-hidden="true"
        />

        {parentIssue && (
          <>
            <IssueHoverCard issue={parentIssue} statuses={statuses} workspaces={workspaces}>
              <button
                type="button"
                onClick={() => onOpenIssue(parentIssue.id)}
                className="flex min-w-0 max-w-52 items-center gap-1.5 rounded px-1.5 py-1 text-muted-foreground transition-colors hover:bg-fill hover:text-foreground"
                aria-label={`Open parent issue ${parentIssue.title}`}
                data-testid="issue-detail-parent-link"
              >
                <CornerUpLeftIcon className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{parentIssue.title}</span>
              </button>
            </IssueHoverCard>
            <ChevronRightIcon
              className="size-3 shrink-0 !text-muted-foreground/50"
              aria-hidden="true"
            />
          </>
        )}
        {status && (
          <>
            <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
              <StatusIcon category={status.category as StatusCategory} size={13} />
              <span>{status.name}</span>
            </span>
            <ChevronRightIcon
              className="size-3 shrink-0 !text-muted-foreground/50"
              aria-hidden="true"
            />
          </>
        )}
        <span className="truncate font-medium text-foreground">{issue.title}</span>
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
            className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-fill hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
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
            className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-fill hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            aria-label="Open next sub-issue"
          >
            <ChevronRightIcon className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {!readOnly && (
        <Menu>
          <MenuTrigger
            className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-fill hover:text-foreground"
            data-testid="issue-detail-menu-trigger"
            aria-label="Issue actions"
          >
            <MoreHorizontalIcon className="size-4" aria-hidden="true" />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem onClick={copyIssueId} data-testid="issue-detail-copy-id">
              <CopyIcon className="size-3.5" aria-hidden="true" />
              Copy issue ID
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              onClick={onDelete}
              variant="destructive"
              data-testid="issue-detail-delete-issue"
            >
              <TrashIcon className="size-3.5" aria-hidden="true" />
              Delete issue
            </MenuItem>
          </MenuPopup>
        </Menu>
      )}
    </div>
  )
}
