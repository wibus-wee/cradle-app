import { useDroppable } from '@dnd-kit/react'
import { PlusLine as PlusIcon } from '@mingcute/react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { KanbanIssue, KanbanMilestone, KanbanStatus } from '~/features/kanban/types'
import { cn } from '~/lib/cn'

import type { KanbanCardRuntimeData } from './kanban-card'
import { KanbanCard } from './kanban-card'
import type { IssueSelectionMode } from './kanban-selection'
import type { ParentIssueRef } from './shared/parent-issue-ref'
import { StatusIcon } from './shared/status-icon'
import { useCreateIssue } from './use-kanban'
import type { StatusCategory, ViewConfig } from './use-view-config'

interface ColumnProps {
  workspaceId: string
  groupId: string
  groupName: string
  category?: StatusCategory
  issues: KanbanIssue[]
  statuses: KanbanStatus[]
  milestones: KanbanMilestone[]
  parentIssueRefs: Map<string, ParentIssueRef>
  displayProperties: ViewConfig['displayProperties']
  onIssueClick: (id: string) => void
  onIssueSelectionGesture?: (id: string, mode: IssueSelectionMode) => void
  onIssueHover?: (id: string | null) => void
  onCreateIssue: (groupId: string) => void
  highlightedIssueId?: string | null
  selectedIssueIds?: Set<string>
  runtimeData?: KanbanCardRuntimeData
}

export function KanbanColumn({
  workspaceId,
  groupId,
  groupName,
  category,
  issues,
  statuses,
  milestones,
  parentIssueRefs,
  displayProperties,
  onIssueClick,
  onIssueSelectionGesture,
  onIssueHover,
  onCreateIssue,
  highlightedIssueId,
  selectedIssueIds,
  runtimeData,
}: ColumnProps) {
  const { t } = useTranslation('kanban')
  const droppable = useDroppable({ id: groupId })
  const [showInlineInput, setShowInlineInput] = useState(false)
  const [inlineTitle, setInlineTitle] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const createIssue = useCreateIssue()

  const handleStartInlineCreate = () => {
    setShowInlineInput(true)
    setInlineTitle('')
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const handleConfirmInlineCreate = () => {
    const title = inlineTitle.trim()
    if (!title) {
      setShowInlineInput(false)
      return
    }
    if (runtimeData) {
      onCreateIssue(groupId)
      setInlineTitle('')
      setShowInlineInput(false)
      return
    }
    createIssue.mutate({
      workspaceId,
      title,
      priority: 'none',
      statusId: groupId,
    }, {
      onSuccess: () => {
        setInlineTitle('')
        setShowInlineInput(false)
      },
      onError: () => {
        setShowInlineInput(false)
      },
    })
  }

  return (
    <div className="flex flex-col w-80 shrink-0 bg-muted/20 rounded-xl h-full" data-kanban-column-id={groupId}>
      {/* Column header */}
      <div className="flex items-center gap-2 p-3">
        {category && <StatusIcon category={category} size={14} />}
        <span className="text-[12px] font-medium text-foreground" data-testid={`kanban-column-title-${groupId}`}>{groupName}</span>
        <span className="text-[11px] text-muted-foreground tabular-nums">{issues.length}</span>
      </div>

      {/* Droppable zone — stretches to fill remaining height */}
      <div
        ref={droppable.ref}
        data-testid={`kanban-column-dropzone-${groupId}`}
        className={cn(
          'flex-1 flex flex-col gap-1.5 px-2 pb-1.5 min-h-0 overflow-y-auto',
          'transition-colors duration-150 ease-out',
          droppable.isDropTarget && 'bg-muted/80 rounded-b-xl',
        )}
      >
        {issues.map((issue, index) => (
          <KanbanCard
            key={issue.id}
            issue={issue}
            index={index}
            sortableGroupId={groupId}
            statuses={statuses}
            milestones={milestones}
            parentIssueRef={parentIssueRefs.get(issue.id) ?? null}
            displayProperties={displayProperties}
            category={category}
            onOpenIssue={onIssueClick}
            onSelectionGesture={onIssueSelectionGesture}
            onHover={onIssueHover}
            highlighted={issue.id === highlightedIssueId}
            selected={selectedIssueIds?.has(issue.id)}
            runtimeData={runtimeData}
          />
        ))}

        {showInlineInput && (
          <div className="overflow-hidden">
            <div className="p-0.5">
              <input
                ref={inputRef}
                value={inlineTitle}
                aria-label={t('issue.newTitlePlaceholder')}
                onChange={e => setInlineTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleConfirmInlineCreate()
                  }
                  else if (e.key === 'Escape') {
                    setShowInlineInput(false)
                  }
                }}
                onBlur={handleConfirmInlineCreate}
                placeholder={t('issue.newTitlePlaceholder')}
                data-testid="kanban-new-issue-input"
                className="w-full rounded-md border border-border bg-background px-2 py-1 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
              />
            </div>
          </div>
        )}

        {/* Quick create button */}
        <button
          type="button"
          onClick={handleStartInlineCreate}
          data-testid={`kanban-column-add-${groupId}`}
          className={cn(
            'flex items-center gap-1.5 px-2 py-1.5 text-[12px]',
            'text-muted-foreground hover:text-foreground',
            'rounded-md transition-[color,transform] duration-150 ease-out',
            'active:scale-[0.96]',
          )}
        >
          <PlusIcon className="size-3" />
          {t('issue.create')}
        </button>
      </div>
    </div>
  )
}
