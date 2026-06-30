import { PointerActivationConstraints, PointerSensor } from '@dnd-kit/dom'
import type { DragEndEvent } from '@dnd-kit/react'
import { DragDropProvider, DragOverlay } from '@dnd-kit/react'
import { isSortable } from '@dnd-kit/react/sortable'
import { m } from 'motion/react'

import type { KanbanBoardIssue, KanbanMilestone, KanbanStatus } from '~/features/kanban/types'

import type { KanbanCardRuntimeData } from './kanban-card'
import { KanbanCardPreview } from './kanban-card'
import { KanbanColumn } from './kanban-column'
import type { IssueSelectionMode } from './kanban-selection'
import type { ParentIssueRef } from './shared/parent-issue-ref'
import { StatusCategorySchema } from './shared/status-icon'
import type { ViewConfig } from './use-view-config'

interface BoardProps {
  workspaceId: string
  issues: KanbanBoardIssue[]
  statuses: KanbanStatus[]
  milestones: KanbanMilestone[]
  parentIssueRefs: Map<string, ParentIssueRef>
  config: ViewConfig
  onIssueClick: (id: string) => void
  onIssueSelectionGesture?: (id: string, mode: IssueSelectionMode) => void
  onIssueHover?: (id: string | null) => void
  onMoveIssue: (issueId: string, targetGroupId: string) => void
  onCreateIssue: (groupId: string) => void
  highlightedIssueId?: string | null
  selectedIssueIds?: Set<string>
  runtimeData?: KanbanCardRuntimeData
}

interface GroupDef {
  id: string
  name: string
  category?: 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'
}

export function KanbanBoard({
  workspaceId,
  issues,
  statuses,
  milestones,
  parentIssueRefs,
  config,
  onIssueClick,
  onIssueSelectionGesture,
  onIssueHover,
  onMoveIssue,
  onCreateIssue,
  highlightedIssueId,
  selectedIssueIds,
  runtimeData,
}: BoardProps) {
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
        { id: 'urgent', name: '紧急' },
        { id: 'high', name: '高' },
        { id: 'medium', name: '中' },
        { id: 'low', name: '低' },
        { id: 'none', name: '无' },
      ]
    }
    if (config.groupBy === 'milestone') {
      const ms: GroupDef[] = milestones.map(m => ({ id: m.id, name: m.title }))
      ms.push({ id: '__none__', name: '无里程碑' })
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

  const handleDragEnd = (event: DragEndEvent) => {
    const { operation, canceled } = event
    if (canceled) {
      return
    }
    const { source, target } = operation
    if (!source || !target) {
      return
    }
    const issueId = String(source.id)
    const sortableGroup = isSortable(source)
      ? source.sortable.group
      : undefined
    const sortableGroupId = sortableGroup === undefined ? undefined : String(sortableGroup)
    const targetId = String(target.id)
    const targetGroupId = sortableGroupId && groupIds.has(sortableGroupId)
      ? sortableGroupId
      : groupIds.has(targetId)
        ? targetId
        : issueGroupIds.get(targetId)
    if (targetGroupId && issueGroupIds.get(issueId) !== targetGroupId) {
      onMoveIssue(issueId, targetGroupId)
    }
  }

  const visibleGroups = config.showEmptyGroups
    ? groups
    : groups.filter(g => (groupedIssues[g.id]?.length ?? 0) > 0)
  const groupIds = new Set(groups.map(group => group.id))
  const issueGroupIds = new Map<string, string>()
  for (const [groupId, groupIssues] of Object.entries(groupedIssues)) {
    for (const issue of groupIssues) {
      issueGroupIds.set(issue.id, groupId)
    }
  }

  return (
    <DragDropProvider
      sensors={defaults => [
        ...defaults.filter(sensor => sensor !== PointerSensor),
        PointerSensor.configure({
          activationConstraints: () => [new PointerActivationConstraints.Distance({ value: 5 })],
        }),
      ]}
      onDragEnd={handleDragEnd}
    >
      <div className="flex-1 flex gap-3 overflow-x-auto px-4 py-2" data-testid="kanban-board">
        {visibleGroups.map(group => (
          <KanbanColumn
            key={group.id}
            workspaceId={workspaceId}
            groupId={group.id}
            groupName={group.name}
            category={group.category}
            issues={groupedIssues[group.id] ?? []}
            statuses={statuses}
            milestones={milestones}
            parentIssueRefs={parentIssueRefs}
            displayProperties={config.displayProperties}
            onIssueClick={onIssueClick}
            onIssueSelectionGesture={onIssueSelectionGesture}
            onIssueHover={onIssueHover}
            onCreateIssue={onCreateIssue}
            highlightedIssueId={highlightedIssueId}
            selectedIssueIds={selectedIssueIds}
            runtimeData={runtimeData}
          />
        ))}
      </div>

      <DragOverlay>
        {(source) => {
          const issue = source.data?.issue as KanbanBoardIssue | undefined
          if (!issue) { return null }
          return (
            <m.div
              initial={{ scale: 1 }}
              animate={{ scale: 1.02 }}
              transition={{ type: 'spring', stiffness: 500, damping: 35, mass: 0.8 }}
              className="w-72"
              style={{
                boxShadow: 'var(--shadow-md)',
              }}
            >
              <KanbanCardPreview
                issue={issue}
                index={0}
                statuses={statuses}
                milestones={milestones}
                parentIssueRef={parentIssueRefs.get(issue.id) ?? null}
                displayProperties={config.displayProperties}
                onOpenIssue={() => {}}
                selected={selectedIssueIds?.has(issue.id)}
                runtimeData={runtimeData}
              />
            </m.div>
          )
        }}
      </DragOverlay>
    </DragDropProvider>
  )
}
