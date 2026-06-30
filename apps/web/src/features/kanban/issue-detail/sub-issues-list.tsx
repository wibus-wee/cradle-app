import { CornerDownRightLine as CornerDownRightIcon, PlusLine as PlusIcon } from '@mingcute/react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import type { KanbanStatus } from '~/features/kanban/types'
import { cn } from '~/lib/utils'

import { priorityOptions } from '../shared/issue-metadata'
import { PriorityIcon } from '../shared/priority-icon'
import { StatusIcon } from '../shared/status-icon'
import type { IssuePriority } from '../use-kanban'
import { useCreateIssue, useIssues } from '../use-kanban'
import type { StatusCategory } from '../use-view-config'

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

interface SubIssuesListProps {
  issueId: string
  workspaceId: string
  statuses: KanbanStatus[]
  onOpenIssue: (id: string) => void
  readOnly?: boolean
}

export function SubIssuesList({
  issueId,
  workspaceId,
  statuses,
  onOpenIssue,
  readOnly = false,
}: SubIssuesListProps) {
  const { t } = useTranslation('kanban')
  const { data: subIssues = [] } = useIssues({ workspaceId, parentIssueId: issueId })
  const createIssue = useCreateIssue()
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [statusId, setStatusId] = useState('')
  const [priority, setPriority] = useState('none')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!creating) {
      return
    }
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [creating])

  const handleCreate = () => {
    if (readOnly) {
      return
    }
    const trimmed = newTitle.trim()
    if (!trimmed) {
      return
    }
    createIssue.mutate({
      workspaceId,
      title: trimmed,
      parentIssueId: issueId,
      statusId: statusId || undefined,
      priority: priority as IssuePriority,
    })
    setNewTitle('')
    setStatusId('')
    setPriority('none')
    setCreating(false)
  }

  const handleCancel = () => {
    setNewTitle('')
    setStatusId('')
    setPriority('none')
    setCreating(false)
  }

  const currentStatus = statuses.find(s => s.id === statusId)

  return (
    <div className="flex flex-col gap-1" data-testid="sub-issues-list">
      {subIssues.map((sub) => {
        const status = statuses.find(s => s.id === sub.statusId)
        return (
          <button
            key={sub.id}
            type="button"
            onClick={() => onOpenIssue(sub.id)}
            className="flex h-7 w-full items-center gap-2 rounded-md px-1.5 text-left text-[13px] hover:bg-fill transition-colors"
            data-testid={`sub-issue-${sub.id}`}
            aria-label={t('subIssue.openAria', { title: sub.title })}
          >
            <CornerDownRightIcon
              className="ml-1 size-3.5 shrink-0 !text-muted-foreground/60"
              aria-hidden="true"
            />
            {status
? (
              <StatusIcon category={status.category as StatusCategory} size={14} />
            )
: (
              <span className="size-3.5 shrink-0" />
            )}
            <span className="flex-1 truncate text-foreground">{sub.title}</span>
          </button>
        )
      })}

      {creating && !readOnly
? (
        <div className="mt-1 rounded-lg border border-border bg-card shadow-xs">
          <div className="px-3 pt-3 pb-2">
            <input
              ref={inputRef}
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  handleCreate()
                }
                if (e.key === 'Escape') {
                  handleCancel()
                }
              }}
              placeholder={t('subIssue.titlePlaceholder')}
              data-testid="sub-issue-title-input"
              aria-label={t('subIssue.titleAria')}
              className="w-full bg-transparent text-[14px] font-medium text-foreground outline-none placeholder:text-muted-foreground/60"
            />
          </div>

          <div className="flex items-center justify-between border-t border-border px-2.5 py-1.5">
            <div className="flex items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {currentStatus
? (
                      <>
                        <StatusIcon category={currentStatus.category as StatusCategory} size={11} />
                        <span>{currentStatus.name}</span>
                      </>
                    )
: (
                      <span>{t('property.status')}</span>
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-44">
                  <DropdownMenuRadioGroup value={statusId} onValueChange={setStatusId}>
                    {statuses.map(s => (
                      <DropdownMenuRadioItem key={s.id} value={s.id}>
                        <StatusIcon category={s.category as StatusCategory} size={13} />
                        {s.name}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <PriorityIcon priority={priority as IssuePriority} size={11} />
                    <span>
                      {t(priorityLabelKeys[priority as IssuePriority] ?? 'property.priority')}
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-40">
                  <DropdownMenuRadioGroup value={priority} onValueChange={setPriority}>
                    {priorityOptions.map(p => (
                      <DropdownMenuRadioItem key={p.value} value={p.value}>
                        <PriorityIcon priority={p.value} size={13} />
                        {t(priorityLabelKeys[p.value])}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleCancel}
                className="rounded px-2 py-0.5 text-[11px] text-text-dim hover:text-foreground transition-colors"
              >
                {t('subIssue.cancel')}
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={!newTitle.trim() || createIssue.isPending}
                data-testid="sub-issue-create-btn"
                className={cn(
                  'flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium',
                  'bg-primary text-primary-foreground hover:bg-primary/90 transition-colors',
                  'disabled:opacity-40 disabled:cursor-not-allowed',
                )}
              >
                {t('subIssue.create')}
                <kbd
                  className="ml-0.5 rounded border border-border/30 bg-primary-foreground/10 px-1 text-[9px] leading-4"
                  aria-hidden="true"
                >
                  ⌘↵
                </kbd>
              </button>
            </div>
          </div>
        </div>
      )
: (
        <button
          type="button"
          onClick={() => {
            if (!readOnly) {
              setCreating(true)
            }
          }}
          disabled={readOnly}
          data-testid="sub-issue-add-btn"
          className={cn(
            'flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] text-text-dim transition-colors w-fit',
            readOnly ? 'cursor-default opacity-60' : 'hover:text-foreground hover:bg-fill',
          )}
        >
          <PlusIcon className="size-3.5" aria-hidden="true" />
          {t('subIssue.add')}
        </button>
      )}
    </div>
  )
}
