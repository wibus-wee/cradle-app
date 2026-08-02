import {
  DownSmallLine as ChevronDownIcon,
  PlusLine as PlusIcon,
} from '@mingcute/react'
import { AnimatePresence, m } from 'motion/react'
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
import type { Workspace } from '~/features/workspace/types'
import { cn } from '~/lib/utils'

import { IssueHoverCard } from '../shared/issue-hover-card'
import { priorityOptions } from '../shared/issue-metadata'
import { PriorityIcon } from '../shared/priority-icon'
import { StatusIcon } from '../shared/status-icon'
import type { StatusCategory } from '../use-board-view'
import type { IssuePriority } from '../use-kanban'
import { useCreateIssue, useIssues, useUpdateIssue } from '../use-kanban'

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

const ROW_SPRING = { type: 'spring', stiffness: 500, damping: 40, mass: 0.7 } as const
const SECTION_TRANSITION = { duration: 0.2, ease: [0.19, 1, 0.22, 1] } as const

interface SubIssuesListProps {
  issueId: string
  workspaceId: string
  statuses: KanbanStatus[]
  workspaces: Workspace[]
  onOpenIssue: (id: string) => void
  readOnly?: boolean
}

export function SubIssuesList({
  issueId,
  workspaceId,
  statuses,
  workspaces,
  onOpenIssue,
  readOnly = false,
}: SubIssuesListProps) {
  const { t } = useTranslation('kanban')
  const { data: subIssues = [] } = useIssues({ workspaceId, parentIssueId: issueId })
  const createIssue = useCreateIssue()
  const updateIssue = useUpdateIssue()
  const [collapsed, setCollapsed] = useState(false)
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

  if (subIssues.length === 0 && readOnly) {
    return null
  }

  const completedCount = subIssues.filter(
    sub => statuses.find(s => s.id === sub.statusId)?.category === 'completed',
  ).length

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
    <div data-testid="sub-issues-list">
      <button
        type="button"
        onClick={() => setCollapsed(prev => !prev)}
        className="flex w-full items-center gap-2 rounded-md py-1 text-left transition-colors hover:text-foreground"
        data-testid="sub-issues-toggle"
        aria-expanded={!collapsed}
      >
        <ChevronDownIcon
          className={cn(
            'size-3.5 !text-muted-foreground/70 transition-transform duration-200',
            collapsed && '-rotate-90',
          )}
          aria-hidden="true"
        />
        <h3 className="text-sm font-semibold text-foreground text-balance">
          {t('subIssue.sectionTitle')}
        </h3>
        {subIssues.length > 0 && (
          <>
            <span className="text-[12px] text-muted-foreground">
              {completedCount}
              /
              {subIssues.length}
            </span>
            <div className="h-1 max-w-24 flex-1 overflow-hidden rounded-full bg-fill">
              <div
                className="h-full rounded-full bg-emerald-500 transition-[width] duration-300 ease-out"
                style={{ width: `${subIssues.length > 0 ? (completedCount / subIssues.length) * 100 : 0}%` }}
              />
            </div>
          </>
        )}
      </button>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <m.div
            key="sub-issues-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SECTION_TRANSITION}
            style={{ overflow: 'hidden' }}
          >
            <div className="flex flex-col gap-0.5 pt-1">
              <AnimatePresence initial={false}>
                {subIssues.map((sub) => {
                  const status = statuses.find(s => s.id === sub.statusId)
                  return (
                    <m.div
                      key={sub.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={ROW_SPRING}
                      className="group flex h-7 items-center gap-1 rounded-md pr-1 transition-colors hover:bg-fill"
                    >
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          disabled={readOnly}
                          className="ml-1 flex size-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-fill"
                          data-testid={`sub-issue-status-trigger-${sub.id}`}
                          aria-label={t('property.status')}
                        >
                          <StatusIcon category={status?.category as StatusCategory} size={14} />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-44">
                          <DropdownMenuRadioGroup
                            value={sub.statusId ?? ''}
                            onValueChange={v => updateIssue.mutate({ id: sub.id, patch: { statusId: v } })}
                          >
                            {statuses.map(s => (
                              <DropdownMenuRadioItem key={s.id} value={s.id}>
                                <StatusIcon category={s.category as StatusCategory} size={14} />
                                {s.name}
                              </DropdownMenuRadioItem>
                            ))}
                          </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <IssueHoverCard issue={sub} statuses={statuses} workspaces={workspaces}>
                        <button
                          type="button"
                          onClick={() => onOpenIssue(sub.id)}
                          className="flex min-w-0 flex-1 items-center rounded-md px-1 text-left text-[13px]"
                          data-testid={`sub-issue-${sub.id}`}
                          aria-label={t('subIssue.openAria', { title: sub.title })}
                        >
                          <span className="flex-1 truncate text-foreground">{sub.title}</span>
                        </button>
                      </IssueHoverCard>
                    </m.div>
                  )
                })}
              </AnimatePresence>

              {creating && !readOnly
                ? (
                    <div className="mt-1 rounded-lg border border-border bg-card shadow-xs">
                      <div className="px-3 pb-2 pt-3">
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
                                className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
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
                                className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
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
                            className="rounded px-2 py-0.5 text-[11px] text-text-dim transition-colors hover:text-foreground"
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
                              'bg-primary text-primary-foreground transition-colors hover:bg-primary/90',
                              'disabled:cursor-not-allowed disabled:opacity-40',
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
                        'flex w-fit items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] text-text-dim transition-colors',
                        readOnly ? 'cursor-default opacity-60' : 'hover:bg-fill hover:text-foreground',
                      )}
                    >
                      <PlusIcon className="size-3.5" aria-hidden="true" />
                      {t('subIssue.add')}
                    </button>
                  )}
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}
