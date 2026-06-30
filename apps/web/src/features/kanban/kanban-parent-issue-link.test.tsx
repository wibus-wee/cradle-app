import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { KanbanIssue } from '~/features/kanban/types'

import { KanbanCard } from './kanban-card'
import { KanbanListRow } from './kanban-list-row'
import type { ParentIssueRef } from './shared/parent-issue-ref'
import type { ViewConfig } from './use-view-config'

vi.mock('@dnd-kit/react/sortable', () => ({
  useSortable: () => ({
    ref: vi.fn(),
    isDragging: false,
  }),
}))

vi.mock('~/features/workspace/use-workspace', () => ({
  useWorkspaces: () => ({
    workspaces: [{ id: 'workspace-1', identifier: 'CRA' }],
  }),
}))

vi.mock('~/features/agent-runtime/use-agents', () => ({
  useAgents: () => ({
    agents: [],
  }),
}))

vi.mock('./issue-context-menu', () => ({
  IssueContextMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

afterEach(() => {
  cleanup()
})

const now = 1_700_000_000

const displayProperties: ViewConfig['displayProperties'] = {
  id: true,
  status: true,
  priority: true,
  labels: true,
  assignee: true,
  subIssueProgress: true,
  agentIndicator: true,
  milestone: true,
  dueDate: true,
  createdAt: true,
}

const childIssue: KanbanIssue = {
  id: 'child-issue',
  workspaceId: 'workspace-1',
  number: 12,
  statusId: 'status-todo',
  milestoneId: null,
  parentIssueId: 'parent-issue',
  title: 'Child issue',
  description: null,
  priority: 'medium',
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

const parentIssueRef: ParentIssueRef = {
  id: 'parent-issue',
  key: 'CRA-7',
}

const statuses = [
  {
    id: 'status-todo',
    workspaceId: 'workspace-1',
    name: 'Todo',
    color: null,
    category: 'unstarted' as const,
    order: 0,
    createdAt: now,
  },
]

describe('kanban parent issue indicators', () => {
  it('opens the parent issue from the card indicator without opening the child issue', () => {
    const onOpenIssue = vi.fn()

    render(
      <KanbanCard
        issue={childIssue}
        index={0}
        statuses={statuses}
        milestones={[]}
        parentIssueRef={parentIssueRef}
        displayProperties={displayProperties}
        onOpenIssue={onOpenIssue}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open parent issue CRA-7' }))

    expect(screen.getByText('CRA-7')).toBeTruthy()
    expect(onOpenIssue).toHaveBeenCalledTimes(1)
    expect(onOpenIssue).toHaveBeenCalledWith('parent-issue')
  })

  it('keeps the list row body click wired to the child issue', () => {
    const onOpenIssue = vi.fn()

    render(
      <KanbanListRow
        issue={childIssue}
        statuses={statuses}
        milestones={[]}
        parentIssueRef={parentIssueRef}
        displayProperties={displayProperties}
        onOpenIssue={onOpenIssue}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open issue Child issue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open parent issue CRA-7' }))

    expect(screen.getByText('CRA-7')).toBeTruthy()
    expect(onOpenIssue).toHaveBeenNthCalledWith(1, 'child-issue')
    expect(onOpenIssue).toHaveBeenNthCalledWith(2, 'parent-issue')
  })
})
