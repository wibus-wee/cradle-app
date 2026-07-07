import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { KanbanBoardIssue, KanbanMilestone, KanbanStatus } from '~/features/kanban/types'
import { cn } from '~/lib/cn'

import { KanbanGroupHeader } from './kanban-group-header'
import { KanbanListRow } from './kanban-list-row'
import type { IssueSelectionMode } from './kanban-selection'
import type { ParentIssueRef } from './shared/parent-issue-ref'
import { StatusCategorySchema } from './shared/status-icon'
import type { ViewConfig } from './use-view-config'

interface ListProps {
  issues: KanbanBoardIssue[]
  statuses: KanbanStatus[]
  milestones: KanbanMilestone[]
  parentIssueRefs: Map<string, ParentIssueRef>
  config: ViewConfig
  highlightedIssueId?: string | null
  selectedIssueIds?: Set<string>
  onIssueClick: (id: string) => void
  onIssueSelectionGesture?: (id: string, mode: IssueSelectionMode) => void
  onIssueHover?: (id: string | null) => void
  onCreateIssue?: (groupId: string) => void
}

interface GroupDef {
  id: string
  name: string
  category?: 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'
}

export function KanbanList({
  issues,
  statuses,
  milestones,
  parentIssueRefs,
  config,
  highlightedIssueId,
  selectedIssueIds,
  onIssueHover,
  onCreateIssue,
  onIssueClick,
  onIssueSelectionGesture,
}: ListProps) {
  const { t } = useTranslation('kanban')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const groups = (() => {
    if (config.groupBy === 'status') {
      return statuses.map(s => ({
        id: s.id,
        name: s.name,
        category: StatusCategorySchema.parse(s.category),
      }))
    }
    if (config.groupBy === 'priority') {
      return [
        { id: 'urgent', name: t('priority.urgent') },
        { id: 'high', name: t('priority.high') },
        { id: 'medium', name: t('priority.medium') },
        { id: 'low', name: t('priority.low') },
        { id: 'none', name: t('priority.none') },
      ]
    }
    if (config.groupBy === 'milestone') {
      const ms: GroupDef[] = milestones.map(m => ({ id: m.id, name: m.title }))
      ms.push({ id: '__none__', name: t('noMilestone') })
      return ms
    }
    return statuses.map(s => ({
      id: s.id,
      name: s.name,
      category: StatusCategorySchema.parse(s.category),
    }))
  })()

  const groupedIssues = (() => {
    const map: Record<string, KanbanBoardIssue[]> = {}
    for (const g of groups) {
      map[g.id] = []
    }

    for (const issue of issues) {
      let groupId: string
      if (config.groupBy === 'status') {
        groupId = issue.statusId ?? ''
      }
 else if (config.groupBy === 'priority') {
        groupId = issue.priority
      }
 else if (config.groupBy === 'milestone') {
        groupId = issue.milestoneId ?? '__none__'
      }
 else {
        groupId = issue.statusId ?? ''
      }
      if (!map[groupId]) {
        map[groupId] = []
      }
      map[groupId].push(issue)
    }
    return map
  })()

  const visibleGroups = config.showEmptyGroups
    ? groups
    : groups.filter(g => (groupedIssues[g.id]?.length ?? 0) > 0)

  const toggleCollapse = (groupId: string) => {
    setCollapsed(prev => ({ ...prev, [groupId]: !prev[groupId] }))
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-1">
      {visibleGroups.map((group) => {
        const groupIssues = groupedIssues[group.id] ?? []
        const isCollapsed = collapsed[group.id] ?? false

        return (
          <div key={group.id} className="flex flex-col">
            <KanbanGroupHeader
              name={group.name}
              count={groupIssues.length}
              category={group.category}
              collapsed={isCollapsed}
              onToggle={() => toggleCollapse(group.id)}
              onCreateIssue={onCreateIssue ? () => onCreateIssue(group.id) : undefined}
            />
            {!isCollapsed && (
              <div
                className={cn(
                  'overflow-hidden flex flex-col gap-0.5',
                )}
              >
                {groupIssues.map(issue => (
                  <KanbanListRow
                    key={issue.id}
                    issue={issue}
                    statuses={statuses}
                    milestones={milestones}
                    parentIssueRef={parentIssueRefs.get(issue.id) ?? null}
                    displayProperties={config.displayProperties}
                    onOpenIssue={onIssueClick}
                    onSelectionGesture={onIssueSelectionGesture}
                    onHover={onIssueHover}
                    highlighted={issue.id === highlightedIssueId}
                    selected={selectedIssueIds?.has(issue.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
