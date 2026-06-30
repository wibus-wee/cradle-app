import { describe, expect, it } from 'vitest'

import { createContextRegistry } from '~/features/context/context-registry'

import {
  clearKanbanAttentionSnapshot,
  createKanbanContextProvider,
  updateKanbanAttentionSnapshot,
} from './kanban-context'

describe('kanban attention context', () => {
  it('publishes active issue attention as typed context', () => {
    clearKanbanAttentionSnapshot('board-1')
    updateKanbanAttentionSnapshot({
      boardId: 'board-1',
      workspaceId: 'workspace-1',
      layout: 'board',
      visibleIssueCount: 14,
      selectedIssueIds: ['issue-2'],
      selectedIssues: [{ id: 'issue-2', label: 'CRA-2', title: 'Add context trace' }],
      openIssue: null,
      peekIssue: { id: 'issue-1', label: 'CRA-1', title: 'Design context engine' },
      focusedIssue: { id: 'issue-1', label: 'CRA-1', title: 'Design context engine' },
      hoveredIssue: null,
      searchQuery: 'context',
      filterSummary: 'milestone active',
      updatedAt: 1779782400000,
    })
    const registry = createContextRegistry({
      readActiveSurface: () => ({ id: 'kanban:board-1', type: 'kanban-board', params: { boardId: 'board-1' }, search: {} }),
      readNow: () => 1779782400000,
      createEnvelopeId: now => `ctx-${now}`,
    })
    registry.setProvider(createKanbanContextProvider())

    expect(registry.collectEnvelope().items).toEqual([
      expect.objectContaining({
        id: 'kanban:attention:board-1',
        kind: 'attention',
        owner: 'kanban',
        title: 'Kanban attention',
        summary: 'peek issue: CRA-1 Design context engine; focused issue: CRA-1 Design context engine; selected issues: CRA-2 Add context trace',
        content: 'visible issues: 14; layout: board; search: context; milestone active',
        priority: 92,
        freshness: 'live',
        references: [
          { kind: 'issue', id: 'issue-1', label: 'CRA-1 Design context engine' },
          { kind: 'issue', id: 'issue-2', label: 'CRA-2 Add context trace' },
        ],
      }),
    ])
  })
})
