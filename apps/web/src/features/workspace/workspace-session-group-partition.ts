import type { WorkspaceSession } from './use-session'
import type { WorkspaceSessionGroup } from './use-session-group'

export interface PartitionedWorkspaceSessions {
  grouped: Array<{
    group: WorkspaceSessionGroup
    sessions: WorkspaceSession[]
  }>
  ungrouped: WorkspaceSession[]
}

export function partitionWorkspaceSessions(
  sessions: readonly WorkspaceSession[],
  groups: readonly WorkspaceSessionGroup[],
): PartitionedWorkspaceSessions {
  const sessionsByGroupId = new Map<string, WorkspaceSession[]>()
  const ungrouped: WorkspaceSession[] = []

  for (const session of sessions) {
    if (session.sessionGroupId) {
      const groupSessions = sessionsByGroupId.get(session.sessionGroupId)
      if (groupSessions) {
        groupSessions.push(session)
      }
      else {
        sessionsByGroupId.set(session.sessionGroupId, [session])
      }
    }
    else {
      ungrouped.push(session)
    }
  }

  const grouped = groups
    .map(group => ({
      group,
      sessions: sessionsByGroupId.get(group.id) ?? [],
    }))
    .filter(entry =>
      entry.sessions.length > 0 || entry.group.status === 'active')

  return { grouped, ungrouped }
}
