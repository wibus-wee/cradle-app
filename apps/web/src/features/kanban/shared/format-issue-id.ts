import type { KanbanIssue } from '~/features/kanban/types'
import type { Workspace } from '~/features/workspace/types'

/**
 * Format a human-readable issue identifier like "CRA-12".
 * Falls back to UUID slice for old issues without a number.
 */
export function formatIssueId(issue: KanbanIssue, workspaces: Workspace[]): string {
  if (issue.number && issue.number > 0) {
    const ws = workspaces.find(w => w.id === issue.workspaceId)
    const prefix = ws?.identifier || issue.id.slice(0, 3).toUpperCase()
    return `${prefix}-${issue.number}`
  }
  return issue.id.slice(0, 6).toUpperCase()
}
