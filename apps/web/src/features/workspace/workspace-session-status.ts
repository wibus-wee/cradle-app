import type { WorkspaceSession } from './use-session'

export function isWorkspaceSessionRunning(
  session: WorkspaceSession,
  locallyStreamingSessionIds: ReadonlySet<string>,
): boolean {
  return session.status === 'streaming'
    || locallyStreamingSessionIds.has(session.id)
}

export function hasUnreadWorkspaceSessionError(
  session: WorkspaceSession,
  locallyErroredSessionIds: ReadonlySet<string>,
): boolean {
  return session.unread
    && (
      session.status === 'error'
      || locallyErroredSessionIds.has(session.id)
    )
}
