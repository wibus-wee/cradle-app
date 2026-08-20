import type { QueryClient } from '@tanstack/react-query'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'

import {
  getSessionsByIdQueryKey,
  getSessionsOptions,
  getSessionsQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import { postSessionsNodeProjectionsReconcile } from '~/api-gen/sdk.gen'
import type { GetSessionsByIdResponse, GetSessionsData, GetSessionsResponse } from '~/api-gen/types.gen'
import type { RuntimeKind } from '~/features/agent-runtime/types'
import type { SessionExecution } from '~/features/chat/session/session-execution'
import { readSessionExecution } from '~/features/chat/session/session-execution'
import type { Workspace } from '~/features/workspace/types'
import { queryRefreshPolicy } from '~/lib/query-refresh-policy'

let unreadSessionIdsSnapshot: string[] = []

export const SESSION_LIST_REFRESH_INTERVAL_MS = 5_000
const NODE_SESSION_RECONCILE_INTERVAL_MS = 15_000
const SESSION_LIST_PAGE_LIMIT = 200

export function readUnreadSessionIdsSnapshot(): string[] {
  return unreadSessionIdsSnapshot
}

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
  latestUserMessageAt: number | null
  latestAssistantMessageAt: number | null
  unread: boolean
  listActivityAt: number
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

/**
 * A session is "manual" when the user started it themselves. Everything else
 * (automation runs, issue-agent spawns, diff-review, conversation-bridge, …)
 * is system-generated and gets visually de-emphasized in the sidebar.
 */
export function isManualSession(session: { origin?: string | null }): boolean {
  const origin = session?.origin
  return !origin || origin === 'manual'
}

function sessionListOptions(workspaceId?: string | null, archived?: boolean): GetSessionsData {
  const query: NonNullable<GetSessionsData['query']> = { limit: SESSION_LIST_PAGE_LIMIT }

  if (workspaceId) {
    query.workspaceId = workspaceId
  }
  if (archived !== undefined) {
    query.archived = archived
  }

  return { url: '/sessions/', query }
}

export const sessionsQueryKey = (workspaceId?: string | null, archived?: boolean) =>
  getSessionsQueryKey(sessionListOptions(workspaceId, archived))

export function isSessionsQueryKey(queryKey: readonly unknown[]): boolean {
  const head = queryKey[0]
  return head !== null
    && typeof head === 'object'
    && (head as { _id?: unknown })._id === 'getSessions'
}

type SessionListResponseRow = GetSessionsResponse['items'][number] & {
  latestUserMessageAt?: unknown
}

type SessionListOptimisticPatch = Partial<SessionListResponseRow> & {
  id: string
}

interface SessionListOptimisticOptions {
  promote?: boolean
  updatedAt?: number
  latestUserMessageAt?: number
}

export function updateSessionReadState(queryClient: QueryClient, session: GetSessionsByIdResponse) {
  queryClient.setQueryData(
    getSessionsByIdQueryKey({ path: { id: session.id } }),
    session,
  )
  updateSessionInSessionLists(queryClient, session)
  unreadSessionIdsSnapshot = session.unread
    ? [...new Set([...unreadSessionIdsSnapshot, session.id])]
    : unreadSessionIdsSnapshot.filter(sessionId => sessionId !== session.id)
}

function queryKeyMatchesWorkspace(queryKey: readonly unknown[], workspaceId: string | null | undefined): boolean {
  if (workspaceId === undefined) {
    return true
  }
  const query = queryKey[0] && typeof queryKey[0] === 'object' && 'query' in queryKey[0]
    ? (queryKey[0].query as { workspaceId?: unknown } | undefined)
    : undefined
  return query?.workspaceId === undefined || query.workspaceId === workspaceId
}

function queryKeyMatchesArchiveState(queryKey: readonly unknown[], archivedAt: number | null | undefined): boolean {
  if (archivedAt === undefined) {
    return true
  }
  const query = queryKey[0] && typeof queryKey[0] === 'object' && 'query' in queryKey[0]
    ? (queryKey[0].query as { archived?: unknown } | undefined)
    : undefined
  return archivedAt === null
    ? query?.archived !== true
    : query?.archived === true
}

function readOptimisticWorkspaceId(value: unknown): string | null | undefined {
  return typeof value === 'string' || value === null ? value : undefined
}

function readOptimisticArchivedAt(value: unknown): number | null | undefined {
  return typeof value === 'number' || value === null ? value : undefined
}

function sessionListRowsEqual(
  left: SessionListResponseRow,
  right: SessionListResponseRow,
): boolean {
  if (left === right) {
    return true
  }

  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) {
    if (!Object.is(
      left[key as keyof SessionListResponseRow],
      right[key as keyof SessionListResponseRow],
    )) {
      return false
    }
  }
  return true
}

function createSessionListRow(
  existing: SessionListResponseRow | null,
  patch: SessionListOptimisticPatch,
  updatedAt: number,
  latestUserMessageAt: number | null,
  fallbackStatus: SessionListResponseRow['status'],
): GetSessionsResponse['items'][number] {
  return {
    workspaceId: null,
    title: null,
    providerTargetId: null,
    agentId: null,
    modelId: null,
    linkedIssueId: null,
    sessionGroupId: null,
    runtimeKind: 'standard',
    pinned: 0,
    archivedAt: null,
    lastReadAt: null,
    createdAt: updatedAt,
    latestAssistantMessageAt: null,
    unread: false,
    ...existing,
    ...patch,
    id: patch.id,
    updatedAt,
    latestUserMessageAt,
    status: patch.status ?? existing?.status ?? fallbackStatus,
  } as GetSessionsResponse['items'][number]
}

export function updateSessionInSessionLists(
  queryClient: QueryClient,
  patch: SessionListOptimisticPatch,
  options: SessionListOptimisticOptions = {},
) {
  const now = Math.floor(Date.now() / 1000)
  const optimisticUpdatedAt = options.updatedAt ?? (options.promote ? now : undefined)
  const optimisticLatestUserMessageAt = options.latestUserMessageAt ?? (options.promote ? now : undefined)
  const workspaceId = readOptimisticWorkspaceId(patch.workspaceId)
  const archivedAt = readOptimisticArchivedAt(patch.archivedAt)
  queryClient.setQueriesData<GetSessionsResponse>(
    {
      predicate: query =>
        isSessionsQueryKey(query.queryKey)
        && queryKeyMatchesWorkspace(query.queryKey, workspaceId)
        && queryKeyMatchesArchiveState(query.queryKey, archivedAt ?? null),
    },
    (page) => {
      if (!page) {
        return page
      }
      const sessions = page.items
      const index = sessions.findIndex(session => session.id === patch.id)
      const existing = index >= 0 ? sessions[index] as SessionListResponseRow : null
      if (!existing && patch.workspaceId === undefined) {
        return page
      }
      const updatedAt = patch.updatedAt ?? optimisticUpdatedAt ?? existing?.updatedAt ?? now
      const latestUserMessageAt
        = patch.latestUserMessageAt ?? optimisticLatestUserMessageAt ?? (existing as SessionListResponseRow | null)?.latestUserMessageAt ?? null
      const fallbackStatus = options.promote ? 'streaming' : 'idle'
      const row = createSessionListRow(existing, patch, updatedAt, latestUserMessageAt, fallbackStatus)

      if (existing && !options.promote) {
        if (sessionListRowsEqual(existing, row as SessionListResponseRow)) {
          return page
        }

        const next = sessions.slice()
        next[index] = row
        return { ...page, items: next }
      }

      if (existing && index === 0 && sessionListRowsEqual(existing, row as SessionListResponseRow)) {
        return page
      }

      const next = existing
        ? sessions.filter(session => session.id !== patch.id)
        : sessions.slice()
      next.unshift(row)
      next.splice(SESSION_LIST_PAGE_LIMIT)
      return { ...page, items: next }
    },
  )
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
    latestUserMessageAt: normalizedLatestUserMessageAt,
    latestAssistantMessageAt: normalizedLatestAssistantMessageAt,
    unread: session.unread === true,
    listActivityAt: Math.max(
      session.createdAt,
      normalizedLatestUserMessageAt ?? 0,
      normalizedLatestAssistantMessageAt ?? 0,
    ),
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

function updateUnreadSessionIdsSnapshot(sessions: WorkspaceSession[]) {
  unreadSessionIdsSnapshot = sessions.filter(session => session.unread).map(session => session.id)
}

function selectUnreadSessionIds(page: GetSessionsResponse): string[] {
  return page.items.filter(session => session.unread === true).map(session => session.id)
}

function selectRunningSessionIds(page: GetSessionsResponse): string[] {
  return page.items.filter(session => session.status === 'streaming').map(session => session.id)
}

export function useUnreadSessionIds(): Set<string> {
  const queryOptions = sessionListOptions()
  const { data: unreadSessionIds = [] } = useQuery({
    ...getSessionsOptions(queryOptions),
    ...queryRefreshPolicy('interactive', { refetchInterval: false }),
    select: selectUnreadSessionIds,
  })

  useEffect(() => {
    unreadSessionIdsSnapshot = unreadSessionIds
  }, [unreadSessionIds])

  return useMemo(() => new Set(unreadSessionIds), [unreadSessionIds])
}

export function useRunningSessionIds(): Set<string> {
  const queryOptions = sessionListOptions()
  const { data: runningSessionIds = [] } = useQuery({
    ...getSessionsOptions(queryOptions),
    ...queryRefreshPolicy('interactive', { refetchInterval: false }),
    select: selectRunningSessionIds,
  })

  return useMemo(() => new Set(runningSessionIds), [runningSessionIds])
}

export function useAllSessions(archived?: boolean) {
  const queryOptions = sessionListOptions(null, archived)
  const { data: sessions = [], isPending: loading } = useQuery({
    ...getSessionsOptions(queryOptions),
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
          await queryClient.invalidateQueries({
            predicate: query => isSessionsQueryKey(query.queryKey),
          })
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
  const queryOptions = sessionListOptions(workspaceId, archived)
  const { data: page, isPending: loading } = useQuery({
    ...getSessionsOptions(queryOptions),
    ...queryRefreshPolicy('interactive', { refetchInterval: false }),
    enabled: Boolean(workspaceId),
  })
  const sessions = useMemo(() => page?.items.map(asWorkspaceSession) ?? [], [page])

  return { sessions, loading }
}
