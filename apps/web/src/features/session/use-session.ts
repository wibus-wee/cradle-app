import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'

import { postSessionsNodeProjectionsReconcile } from '~/api-gen/sdk.gen'
import type { GetSessionsResponse } from '~/api-gen/types.gen'
import type { RuntimeKind } from '~/features/agent-runtime/types'
import type { SessionExecution } from '~/features/chat/session/session-execution'
import { readSessionExecution } from '~/features/chat/session/session-execution'
import type { Workspace } from '~/features/workspace/types'
import { queryRefreshPolicy } from '~/lib/query-refresh-policy'

import {
  refreshSessionLists,
  sessionListQueryOptions,
  updateUnreadSessionIdsSnapshot,
} from './api/session-projection'

const NODE_SESSION_RECONCILE_INTERVAL_MS = 15_000

export interface WorkspaceSession {
  id: string
  workspaceId: string | null
  title: string | null
  providerTargetId: string | null
  agentId: string | null
  modelId: string | null
  linkedIssueId: string | null
  sessionGroupId: string | null
  runtimeKind: RuntimeKind
  status: 'idle' | 'streaming' | 'error'
  pinned: number
  archivedAt: number | null
  lastReadAt: number | null
  createdAt: number
  updatedAt: number
  activityAt: number
  latestUserMessageAt: number | null
  latestAssistantMessageAt: number | null
  unread: boolean
  /**
   * How the session was created. `'manual'` (or empty) means the user started
   * it themselves; any other value (`'automation'`, `'cradle-review'`,
   * `'cradle-issue'`, `'conversation-bridge'`, …) means it was spawned by the
   * system. Used to de-emphasize system-generated sessions in the sidebar so
   * they don't compete with the user's own conversations.
   */
  origin: string
  /**
   * Whether this session runs in an isolated git worktree (i.e. it has a
   * worktree checkout attached). Surfaced in the sidebar as a fork indicator
   * on the row so isolated sessions are recognizable at a glance.
   */
  isIsolated: boolean
  worktreeId: string | null
  worktreeBranch: string | null
  /** Local vs Fabric Node execution affinity from session projection. */
  execution: SessionExecution
}

export function getSessionActivityAt(
  session: Pick<WorkspaceSession, 'activityAt'>,
): number {
  return session.activityAt
}

/**
 * A session is "manual" when the user started it themselves. Everything else
 * (automation runs, issue-agent spawns, diff-review, conversation-bridge, …)
 * is system-generated and gets visually de-emphasized in the sidebar.
 */
export function isManualSession(session: { origin?: string | null }): boolean {
  const origin = session?.origin
  return !origin || origin === 'manual'
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readSessionStatus(value: unknown): WorkspaceSession['status'] {
  if (value === 'streaming' || value === 'error') {
    return value
  }
  return 'idle'
}

function asWorkspaceSession(session: GetSessionsResponse['items'][number]): WorkspaceSession {
  const archivedAt = (session as { archivedAt?: unknown }).archivedAt
  const lastReadAt = (session as { lastReadAt?: unknown }).lastReadAt
  const latestUserMessageAt = (session as { latestUserMessageAt?: unknown }).latestUserMessageAt
  const latestAssistantMessageAt = (session as { latestAssistantMessageAt?: unknown }).latestAssistantMessageAt
  const status = (session as { status?: unknown }).status
  const normalizedLatestUserMessageAt = typeof latestUserMessageAt === 'number' ? latestUserMessageAt : null
  const normalizedLatestAssistantMessageAt = typeof latestAssistantMessageAt === 'number' ? latestAssistantMessageAt : null
  return {
    id: session.id,
    workspaceId: nullableString(session.workspaceId),
    title: nullableString(session.title),
    providerTargetId: nullableString(session.providerTargetId),
    agentId: nullableString(session.agentId),
    modelId: nullableString(session.modelId),
    linkedIssueId: nullableString(session.linkedIssueId),
    sessionGroupId: nullableString((session as { sessionGroupId?: unknown }).sessionGroupId),
    runtimeKind: session.runtimeKind,
    status: readSessionStatus(status),
    pinned: session.pinned,
    archivedAt: typeof archivedAt === 'number' ? archivedAt : null,
    lastReadAt: typeof lastReadAt === 'number' ? lastReadAt : null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    activityAt: session.activityAt,
    latestUserMessageAt: normalizedLatestUserMessageAt,
    latestAssistantMessageAt: normalizedLatestAssistantMessageAt,
    unread: session.unread === true,
    origin: typeof session.origin === 'string' && session.origin ? session.origin : 'manual',
    isIsolated: session.isIsolated === true,
    worktreeId: nullableString(session.worktreeId),
    worktreeBranch: nullableString(session.worktreeBranch),
    execution: readSessionExecution(session),
  }
}

function asWorkspaceSessions(page: GetSessionsResponse): WorkspaceSession[] {
  return page.items.map(asWorkspaceSession)
}

function selectUnreadSessionIds(page: GetSessionsResponse): string[] {
  return page.items.filter(session => session.unread === true).map(session => session.id)
}

function selectRunningSessionIds(page: GetSessionsResponse): string[] {
  return page.items.filter(session => session.status === 'streaming').map(session => session.id)
}

export function useUnreadSessionIds(): Set<string> {
  const { data: unreadSessionIds = [] } = useQuery({
    ...sessionListQueryOptions(),
    ...queryRefreshPolicy('interactive', { refetchInterval: false }),
    select: selectUnreadSessionIds,
  })

  useEffect(() => {
    updateUnreadSessionIdsSnapshot(unreadSessionIds.map(id => ({ id, unread: true })))
  }, [unreadSessionIds])

  return useMemo(() => new Set(unreadSessionIds), [unreadSessionIds])
}

export function useRunningSessionIds(): Set<string> {
  const { data: runningSessionIds = [] } = useQuery({
    ...sessionListQueryOptions(),
    ...queryRefreshPolicy('interactive', { refetchInterval: false }),
    select: selectRunningSessionIds,
  })

  return useMemo(() => new Set(runningSessionIds), [runningSessionIds])
}

export function useAllSessions(archived?: boolean) {
  const { data: sessions = [], isPending: loading } = useQuery({
    ...sessionListQueryOptions(null, archived),
    ...queryRefreshPolicy('interactive', { refetchInterval: false }),
    select: asWorkspaceSessions,
  })

  useEffect(() => {
    if (archived !== true) {
      updateUnreadSessionIdsSnapshot(sessions)
    }
  }, [archived, sessions])

  return { sessions, loading }
}

/** Keep mounted Node workspaces aware of sessions created by another controller. */
export function useNodeSessionReconciliation(workspaces: readonly Workspace[]): void {
  const queryClient = useQueryClient()
  const remoteWorkspaceIds = useMemo(
    () => workspaces
      .filter(workspace => workspace.locator.nodeId !== 'local')
      .map(workspace => workspace.id)
      .sort(),
    [workspaces],
  )
  const remoteWorkspaceKey = remoteWorkspaceIds.join('\0')

  useEffect(() => {
    if (!remoteWorkspaceKey) {
      return
    }
    let disposed = false
    let running = false
    const reconcile = async () => {
      if (running || disposed) {
        return
      }
      running = true
      try {
        const results = await Promise.allSettled(remoteWorkspaceIds.map(async (workspaceId) => {
          const { data } = await postSessionsNodeProjectionsReconcile({
            body: { workspaceId },
            throwOnError: true,
          })
          return data
        }))
        if (!disposed && results.some(result =>
          result.status === 'fulfilled'
          && (result.value.discovered > 0 || result.value.updated > 0 || result.value.removed > 0))) {
          await refreshSessionLists(queryClient)
        }
      }
      finally {
        running = false
      }
    }

    void reconcile()
    const timer = window.setInterval(() => void reconcile(), NODE_SESSION_RECONCILE_INTERVAL_MS)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [queryClient, remoteWorkspaceIds, remoteWorkspaceKey])
}

export function useWorkspaceSessions(workspaceId: string | null, archived?: boolean) {
  const { data: page, isPending: loading } = useQuery({
    ...sessionListQueryOptions(workspaceId, archived),
    ...queryRefreshPolicy('interactive', { refetchInterval: false }),
    enabled: Boolean(workspaceId),
  })
  const sessions = useMemo(() => page?.items.map(asWorkspaceSession) ?? [], [page])

  return { sessions, loading }
}
