import { describe, expect, it } from 'vitest'

import type { KanbanIssue, KanbanStatus } from '~/features/kanban/types'

import { calculateMilestoneProgress } from './milestone-progress'

const now = 1_700_000_000

const statuses: KanbanStatus[] = [
  {
    id: 'status-todo',
    workspaceId: 'workspace-1',
    name: 'Todo',
    color: null,
    category: 'unstarted',
    order: 0,
    createdAt: now,
  },
  {
    id: 'status-done',
    workspaceId: 'workspace-1',
    name: 'Done',
    color: null,
    category: 'completed',
    order: 1,
    createdAt: now,
  },
]

function issue(id: string, milestoneId: string | null, statusId: string | null): KanbanIssue {
  return {
    id,
    workspaceId: 'workspace-1',
    number: 1,
    statusId,
    milestoneId,
    parentIssueId: null,
    title: id,
    description: null,
    priority: 'none',
    labels: [],
    assigneeKind: null,
    assigneeId: null,
    dueDate: null,
    createdByKind: 'user',
    createdById: '__self__',
    sourceChatSessionId: null,
    delegateAgentId: null,
    delegateProviderTargetId: null,
    contextRefs: '[]',
    order: 0,
    createdAt: now,
    updatedAt: now,
  }
}

describe('milestone progress', () => {
  it('counts only issues in the selected milestone and completed statuses', () => {
    const progress = calculateMilestoneProgress([
      issue('issue-a', 'milestone-1', 'status-done'),
      issue('issue-b', 'milestone-1', 'status-todo'),
      issue('issue-c', 'milestone-2', 'status-done'),
      issue('issue-d', null, 'status-done'),
    ], statuses, 'milestone-1')

    expect(progress).toEqual({
      completed: 1,
      total: 2,
      percentage: 50,
    })
  })

  it('returns an empty summary when no milestone is selected', () => {
    expect(calculateMilestoneProgress([
      issue('issue-a', 'milestone-1', 'status-done'),
    ], statuses, null)).toEqual({
      completed: 0,
      total: 0,
      percentage: 0,
    })
  })
})
