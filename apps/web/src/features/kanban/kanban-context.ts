import type { ContextItem, ContextReference } from '~/features/context/context-items'
import { estimateContextTokens } from '~/features/context/context-items'
import type { ContextProvider } from '~/features/context/context-registry'

export interface KanbanContextIssue {
  id: string
  label: string
  title: string
}

export interface KanbanAttentionSnapshot {
  boardId: string
  workspaceId: string
  layout: 'board' | 'list'
  visibleIssueCount: number
  selectedIssueIds: string[]
  selectedIssues: KanbanContextIssue[]
  openIssue: KanbanContextIssue | null
  peekIssue: KanbanContextIssue | null
  focusedIssue: KanbanContextIssue | null
  hoveredIssue: KanbanContextIssue | null
  searchQuery: string
  filterSummary: string | null
  updatedAt: number
}

const snapshotsByBoardId = new Map<string, KanbanAttentionSnapshot>()

function issueRef(issue: KanbanContextIssue): ContextReference {
  return {
    kind: 'issue',
    id: issue.id,
    label: `${issue.label} ${issue.title}`,
  }
}

function listIssueLabels(issues: KanbanContextIssue[]): string {
  return issues.map(issue => `${issue.label} ${issue.title}`).join(', ')
}

function createKanbanAttentionItem(snapshot: KanbanAttentionSnapshot, now: number): ContextItem {
  const activeParts: string[] = []
  if (snapshot.openIssue) {
    activeParts.push(`open issue: ${snapshot.openIssue.label} ${snapshot.openIssue.title}`)
  }
  if (snapshot.peekIssue) {
    activeParts.push(`peek issue: ${snapshot.peekIssue.label} ${snapshot.peekIssue.title}`)
  }
  if (snapshot.focusedIssue) {
    activeParts.push(`focused issue: ${snapshot.focusedIssue.label} ${snapshot.focusedIssue.title}`)
  }
  if (snapshot.hoveredIssue) {
    activeParts.push(`hovered issue: ${snapshot.hoveredIssue.label} ${snapshot.hoveredIssue.title}`)
  }
  if (snapshot.selectedIssues.length > 0) {
    activeParts.push(`selected issues: ${listIssueLabels(snapshot.selectedIssues)}`)
  }

  const summary = activeParts.length > 0
    ? activeParts.join('; ')
    : `Kanban ${snapshot.layout} view has no active issue attention.`
  const filterParts = [
    snapshot.searchQuery ? `search: ${snapshot.searchQuery}` : null,
    snapshot.filterSummary,
  ].filter((part): part is string => Boolean(part))
  const content = [
    `visible issues: ${snapshot.visibleIssueCount}`,
    `layout: ${snapshot.layout}`,
    ...filterParts,
  ].join('; ')

  const references = [
    snapshot.openIssue,
    snapshot.peekIssue,
    snapshot.focusedIssue,
    snapshot.hoveredIssue,
    ...snapshot.selectedIssues,
  ]
    .filter((issue): issue is KanbanContextIssue => Boolean(issue))
    .filter((issue, index, issues) => issues.findIndex(candidate => candidate.id === issue.id) === index)
    .map(issueRef)

  return {
    id: `kanban:attention:${snapshot.boardId}`,
    kind: 'attention',
    owner: 'kanban',
    title: 'Kanban attention',
    summary,
    content,
    references,
    priority: references.length > 0 ? 92 : 55,
    freshness: now - snapshot.updatedAt <= 5_000 ? 'live' : 'recent',
    sensitivity: 'workspace',
    tokenEstimate: estimateContextTokens(`${summary}\n${content}`),
    createdAt: now,
  }
}

export function updateKanbanAttentionSnapshot(snapshot: KanbanAttentionSnapshot): void {
  snapshotsByBoardId.set(snapshot.boardId, snapshot)
}

export function clearKanbanAttentionSnapshot(boardId: string | null | undefined): void {
  if (!boardId) {
    return
  }
  snapshotsByBoardId.delete(boardId)
}

export function createKanbanContextProvider(): ContextProvider {
  return {
    owner: 'kanban',
    readContext(input) {
      if (input.activeSurfaceType !== 'kanban-board') {
        return []
      }

      const boardId = input.activeSurfaceParams.boardId
      if (!boardId) {
        return []
      }

      const snapshot = snapshotsByBoardId.get(boardId)
      if (!snapshot) {
        return []
      }

      return [createKanbanAttentionItem(snapshot, input.now)]
    },
  }
}
