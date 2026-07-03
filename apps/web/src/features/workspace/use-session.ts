import type { QueryClient } from '@tanstack/react-query'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'

import {
  getSessionsByIdQueryKey,
  getSessionsOptions,
  getSessionsQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import type { GetSessionsByIdResponse, GetSessionsData, GetSessionsResponse } from '~/api-gen/types.gen'
import type { RuntimeKind } from '~/features/agent-runtime/types'
import { queryRefreshPolicy } from '~/lib/query-refresh-policy'

let unreadSessionIdsSnapshot: string[] = []

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

function sessionListOptions(workspaceId?: string | null, archived?: boolean): GetSessionsData | undefined {
  const query: NonNullable<GetSessionsData['query']> = {}

  if (workspaceId) {
    query.workspaceId = workspaceId
  }
  if (archived !== undefined) {
    query.archived = archived
  }

  return Object.keys(query).length > 0
    ? { url: '/sessions/', query }
    : undefined
}

export const sessionsQueryKey = (workspaceId?: string | null, archived?: boolean) =>
  getSessionsQueryKey(sessionListOptions(workspaceId, archived))

export function isSessionsQueryKey(queryKey: readonly unknown[]): boolean {
  const head = queryKey[0]
  return head !== null
    && typeof head === 'object'
    && (head as { _id?: unknown })._id === 'getSessions'
}

type SessionListResponseRow = GetSessionsResponse[number] & {
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
): GetSessionsResponse[number] {
  return {
    workspaceId: null,
    title: null,
    providerTargetId: null,
    agentId: null,
    modelId: null,
    linkedIssueId: null,
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
  } as GetSessionsResponse[number]
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
    (sessions) => {
      if (!sessions) {
        return sessions
      }
      const index = sessions.findIndex(session => session.id === patch.id)
      const existing = index >= 0 ? sessions[index] as SessionListResponseRow : null
      if (!existing && patch.workspaceId === undefined) {
        return sessions
      }
      const updatedAt = patch.updatedAt ?? optimisticUpdatedAt ?? existing?.updatedAt ?? now
      const latestUserMessageAt
        = patch.latestUserMessageAt ?? optimisticLatestUserMessageAt ?? (existing as SessionListResponseRow | null)?.latestUserMessageAt ?? null
      const fallbackStatus = options.promote ? 'streaming' : 'idle'
      const row = createSessionListRow(existing, patch, updatedAt, latestUserMessageAt, fallbackStatus)

      if (existing && !options.promote) {
        if (sessionListRowsEqual(existing, row as SessionListResponseRow)) {
          return sessions
        }

        const next = sessions.slice()
        next[index] = row
        return next
      }

      if (existing && index === 0 && sessionListRowsEqual(existing, row as SessionListResponseRow)) {
        return sessions
      }

      const next = existing
        ? sessions.filter(session => session.id !== patch.id)
        : sessions.slice()
      next.unshift(row)
      return next
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

function asWorkspaceSession(session: GetSessionsResponse[number]): WorkspaceSession {
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
  }
}

function asWorkspaceSessions(sessions: GetSessionsResponse): WorkspaceSession[] {
  return sessions.map(asWorkspaceSession)
}

function updateUnreadSessionIdsSnapshot(sessions: WorkspaceSession[]) {
  unreadSessionIdsSnapshot = sessions.filter(session => session.unread).map(session => session.id)
}

function selectUnreadSessionIds(sessions: GetSessionsResponse): string[] {
  return sessions.filter(session => session.unread === true).map(session => session.id)
}

function selectRunningSessionIds(sessions: GetSessionsResponse): string[] {
  return sessions.filter(session => session.status === 'streaming').map(session => session.id)
}

export function useUnreadSessionIds(): Set<string> {
  const queryOptions = sessionListOptions()
  const { data: unreadSessionIds = [] } = useQuery({
    ...getSessionsOptions(queryOptions),
    ...queryRefreshPolicy('active', { refetchInterval: false }),
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
    ...queryRefreshPolicy('active', { refetchInterval: false }),
    select: selectRunningSessionIds,
  })

  return useMemo(() => new Set(runningSessionIds), [runningSessionIds])
}

export function useAllSessions(archived?: boolean) {
  const queryOptions = sessionListOptions(null, archived)
  const { data: sessions = [], isPending: loading } = useQuery({
    ...getSessionsOptions(queryOptions),
    ...queryRefreshPolicy('active', { refetchInterval: false }),
    select: asWorkspaceSessions,
  })

  useEffect(() => {
    if (archived !== true) {
      updateUnreadSessionIdsSnapshot(sessions)
    }
  }, [archived, sessions])

  return { sessions, loading }
}

export function useWorkspaceSessions(workspaceId: string | null, archived?: boolean) {
  const queryOptions = sessionListOptions(workspaceId, archived)
  const { data: rawSessions = [], isPending: loading } = useQuery({
    ...getSessionsOptions(queryOptions),
    ...queryRefreshPolicy('active', { refetchInterval: false }),
    enabled: Boolean(workspaceId),
  })
  const sessions = useMemo(() => rawSessions.map(asWorkspaceSession), [rawSessions])

  return { sessions, loading }
}
