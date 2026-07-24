import type { KanbanCardRuntimeData } from '../kanban-card-view'
import type { KanbanBoardIssue, KanbanStatus } from '../types'
import type { ViewConfig } from '../use-view-config'

export const kanbanStatuses: KanbanStatus[] = [
  { id: 'triage', workspaceId: 'cradle', name: 'Triage', color: '#a1a1aa', category: 'triage', order: 0, createdAt: 1 },
  { id: 'backlog', workspaceId: 'cradle', name: 'Backlog', color: '#71717a', category: 'backlog', order: 1, createdAt: 1 },
  { id: 'todo', workspaceId: 'cradle', name: 'Todo', color: '#3b82f6', category: 'unstarted', order: 2, createdAt: 1 },
  { id: 'progress', workspaceId: 'cradle', name: 'In progress', color: '#f59e0b', category: 'started', order: 3, createdAt: 1 },
  { id: 'done', workspaceId: 'cradle', name: 'Done', color: '#10b981', category: 'completed', order: 4, createdAt: 1 },
  { id: 'canceled', workspaceId: 'cradle', name: 'Canceled', color: '#ef4444', category: 'canceled', order: 5, createdAt: 1 },
]

export const kanbanDisplayProperties: ViewConfig['displayProperties'] = {
  id: true,
  priority: true,
  status: true,
  labels: true,
  assignee: true,
  subIssueProgress: false,
  agentIndicator: true,
  milestone: false,
  dueDate: false,
  createdAt: false,
}

export const kanbanRuntimeData: KanbanCardRuntimeData = {
  workspaces: [{
    id: 'cradle',
    name: 'Cradle',
    locator: { hostId: 'local', path: '/workspace/cradle' },
    gitIdentity: { originUrl: 'https://github.com/wibus-wee/cradle-app', branch: 'main' },
    identifier: 'CRA',
    availability: 'available',
    pinned: 1,
    createdAt: 1,
    updatedAt: 1,
  }],
  agents: [],
}

function issue(
  id: string,
  number: number,
  title: string,
  statusId: string,
  priority: KanbanBoardIssue['priority'],
  labels: string[],
  overrides: Partial<KanbanBoardIssue> = {},
): KanbanBoardIssue {
  return {
    id,
    workspaceId: 'cradle',
    number,
    statusId,
    milestoneId: null,
    parentIssueId: null,
    title,
    description: null,
    priority,
    labels,
    assigneeKind: null,
    assigneeId: null,
    dueDate: null,
    createdByKind: 'user',
    createdById: 'owner',
    sourceChatSessionId: null,
    delegateAgentId: null,
    delegateProviderTargetId: null,
    contextRefs: '[]',
    order: number,
    createdAt: Date.now() - number * 86_400_000,
    updatedAt: Date.now() - number * 3_600_000,
    ...overrides,
  }
}

export const kanbanCardFixtures: KanbanBoardIssue[] = [
  issue(
    'issue-71',
    71,
    'Expand the fixture-driven Storybook component catalog',
    'progress',
    'urgent',
    ['frontend', 'architecture', 'storybook'],
    { assigneeKind: 'user', assigneeId: 'Wibus' },
  ),
  issue(
    'issue-68',
    68,
    'Separate download transport state from visible task rows',
    'todo',
    'high',
    ['frontend', 'desktop'],
  ),
  issue(
    'issue-52',
    52,
    'Polish the usage analytics dashboard',
    'done',
    'medium',
    ['analytics', 'design'],
  ),
]
