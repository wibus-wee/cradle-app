import type { WorkspaceSession } from './use-session'

export function isWorkspaceSessionRunning(
  session: WorkspaceSession,
  locallyStreamingSessionIds: ReadonlySet<string>,
): boolean {
  return session.status === 'streaming'
    || locallyStreamingSessionIds.has(session.id)
}
