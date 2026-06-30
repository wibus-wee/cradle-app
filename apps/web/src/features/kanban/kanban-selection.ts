import type { KanbanBoardIssue, KanbanMilestone, KanbanStatus } from '~/features/kanban/types'

import type { ViewConfig } from './use-view-config'

export type IssueSelectionMode = 'toggle' | 'range'

interface IssueGroupDef {
  id: string
}

export function orderedIssuesForKanbanView(
  issues: KanbanBoardIssue[],
  statuses: KanbanStatus[],
  milestones: KanbanMilestone[],
  config: Pick<ViewConfig, 'groupBy' | 'showEmptyGroups'>,
): KanbanBoardIssue[] {
  const groups: IssueGroupDef[] = (() => {
    if (config.groupBy === 'status') {
      return statuses.map(status => ({ id: status.id }))
    }
    if (config.groupBy === 'priority') {
      return [{ id: 'urgent' }, { id: 'high' }, { id: 'medium' }, { id: 'low' }, { id: 'none' }]
    }
    if (config.groupBy === 'milestone') {
      return [...milestones.map(milestone => ({ id: milestone.id })), { id: '__none__' }]
    }
    return statuses.map(status => ({ id: status.id }))
  })()

  const groupedIssues = new Map<string, KanbanBoardIssue[]>()
  for (const group of groups) {
    groupedIssues.set(group.id, [])
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

    const groupIssues = groupedIssues.get(groupId)
    if (groupIssues) {
      groupIssues.push(issue)
    }
 else {
      groupedIssues.set(groupId, [issue])
    }
  }

  const visibleGroups = config.showEmptyGroups
    ? groups
    : groups.filter(group => (groupedIssues.get(group.id)?.length ?? 0) > 0)

  const orderedIssues: KanbanBoardIssue[] = []
  for (const group of visibleGroups) {
    orderedIssues.push(...(groupedIssues.get(group.id) ?? []))
  }

  for (const [groupId, groupIssues] of groupedIssues) {
    if (!groups.some(group => group.id === groupId)) {
      orderedIssues.push(...groupIssues)
    }
  }

  return orderedIssues
}

export function issueRangeIds(
  issueIds: string[],
  anchorId: string | null,
  targetId: string,
): string[] {
  const targetIndex = issueIds.indexOf(targetId)
  if (targetIndex < 0) {
    return []
  }

  const anchorIndex = anchorId ? issueIds.indexOf(anchorId) : -1
  if (anchorIndex < 0) {
    return [targetId]
  }

  const start = Math.min(anchorIndex, targetIndex)
  const end = Math.max(anchorIndex, targetIndex)
  return issueIds.slice(start, end + 1)
}

export function toggleIssueSelection(selectedIds: Set<string>, issueId: string): Set<string> {
  const next = new Set(selectedIds)
  if (next.has(issueId)) {
    next.delete(issueId)
  }
 else {
    next.add(issueId)
  }
  return next
}

export function addIssueSelectionRange(
  selectedIds: Set<string>,
  issueIds: string[],
  anchorId: string | null,
  targetId: string,
): Set<string> {
  const next = new Set(selectedIds)
  for (const issueId of issueRangeIds(issueIds, anchorId, targetId)) {
    next.add(issueId)
  }
  return next
}
