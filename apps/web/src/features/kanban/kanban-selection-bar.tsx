import {
  CheckLine as CheckIcon,
  CircleDashLine as CircleDashedIcon,
  CloseLine as XIcon,
  Flag2Line as FlagIcon,
} from '@mingcute/react'
import { AnimatePresence, m } from 'motion/react'
import { useTranslation } from 'react-i18next'

import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import type { KanbanBoardIssue, KanbanStatus } from '~/features/kanban/types'
import { isExternalKanbanIssue } from '~/features/kanban/types'

import { PriorityIcon } from './shared/priority-icon'
import { StatusIcon } from './shared/status-icon'
import type { IssuePriority } from './use-kanban'
import { useBulkUpdateIssues, useMoveExternalIssue } from './use-kanban'
import type { StatusCategory } from './use-view-config'

interface KanbanSelectionBarProps {
  issues: KanbanBoardIssue[]
  statuses: KanbanStatus[]
  onClear: () => void
}

const priorityOptions: Array<{ value: IssuePriority, label: string }> = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'none', label: 'None' },
]

const priorityLabelKeys: Record<
  IssuePriority,
  'priority.none' | 'priority.low' | 'priority.medium' | 'priority.high' | 'priority.urgent'
> = {
  none: 'priority.none',
  low: 'priority.low',
  medium: 'priority.medium',
  high: 'priority.high',
  urgent: 'priority.urgent',
}

function statusCategory(status: KanbanStatus): StatusCategory {
  return status.category as StatusCategory
}

export function KanbanSelectionBar({ issues, statuses, onClear }: KanbanSelectionBarProps) {
  const { t } = useTranslation('kanban')
  const bulkUpdateIssues = useBulkUpdateIssues()
  const moveExternalIssue = useMoveExternalIssue()
  const nativeIssueIds: string[] = []
  const externalIssueIds: string[] = []
  for (const issue of issues) {
    if (isExternalKanbanIssue(issue)) {
      externalIssueIds.push(issue.id)
    }
    else {
      nativeIssueIds.push(issue.id)
    }
  }
  const isVisible = issues.length > 0
  const isMutating = bulkUpdateIssues.isPending || moveExternalIssue.isPending
  const canUpdateNativeFields = nativeIssueIds.length > 0

  const handleStatusChange = async (statusId: string) => {
    await Promise.all([
      nativeIssueIds.length > 0
        ? bulkUpdateIssues.mutateAsync({
            ids: nativeIssueIds,
            patch: { statusId: statusId || null },
          })
        : Promise.resolve(),
      ...externalIssueIds.map(id => moveExternalIssue.mutateAsync({ id, statusId })),
    ])
    onClear()
  }

  const handlePriorityChange = (priority: string) => {
    if (nativeIssueIds.length === 0) {
      return
    }
    bulkUpdateIssues.mutate(
      { ids: nativeIssueIds, patch: { priority: priority as IssuePriority } },
      { onSuccess: onClear },
    )
  }

  return (
    <AnimatePresence initial={false}>
      {isVisible && (
        <m.div
          key="kanban-selection-bar"
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
          className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex justify-center px-4"
        >
          <div
            className="pointer-events-auto flex min-h-10 max-w-full items-center gap-1.5 rounded-lg bg-popover px-2 py-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10"
            data-testid="kanban-selection-bar"
          >
            <span className="flex items-center gap-1.5 px-2 text-sm font-medium tabular-nums">
              <CheckIcon className="size-4 !text-primary" aria-hidden="true" />
              <span>{issues.length}</span>
              <span>{t('selection.selected')}</span>
            </span>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isMutating || statuses.length === 0}
                >
                  <CircleDashedIcon className="size-4" aria-hidden="true" />
                  {t('property.status')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="w-56">
                <DropdownMenuRadioGroup onValueChange={handleStatusChange}>
                  {statuses.map(status => (
                    <DropdownMenuRadioItem key={status.id} value={status.id} disabled={isMutating}>
                      <StatusIcon category={statusCategory(status)} size={14} />
                      <span className="truncate">{status.name}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isMutating || !canUpdateNativeFields}
                >
                  <FlagIcon className="size-4" aria-hidden="true" />
                  {t('property.priority')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="w-44">
                <DropdownMenuRadioGroup onValueChange={handlePriorityChange}>
                  {priorityOptions.map(priority => (
                    <DropdownMenuRadioItem
                      key={priority.value}
                      value={priority.value}
                      disabled={isMutating}
                    >
                      <PriorityIcon priority={priority.value} size={14} />
                      {t(priorityLabelKeys[priority.value])}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('selection.clearAria')}
              onClick={onClear}
            >
              <XIcon className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </m.div>
      )}
    </AnimatePresence>
  )
}
