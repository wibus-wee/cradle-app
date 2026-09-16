import type { ChatGlobalSessionTailEvent } from '@cradle/chat-runtime-contracts'
import type { QueryClient } from '@tanstack/react-query'
import { QueryClient as TanstackQueryClient, QueryObserver } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import type { GetSessionsByIdResponse, GetSessionsResponse } from '~/api-gen/types.gen'
import { runtimeSessionStatusQueryKey } from '~/features/chat/commands/runtime-session-status-command'

import {
  applyConfirmedSession,
  applySessionOptimisticPatch,
  applySessionReadResult,
  applySessionTailEvent,
  isSessionProjectionQueryKey,
  projectCreatedSession,
  projectSessionActivity,
  readUnreadSessionIdsSnapshot,
  recoverProjectionGap,
  refreshSessionProjections,
  rollbackSessionOptimisticPatch,
  SESSION_LIST_PAGE_LIMIT,
  sessionDetailQueryKey,
  sessionListOptions,
  sessionQueueQueryKey,
  sessionsQueryKey,
  updateUnreadSessionIdsSnapshot,
} from './session-projection'

type SessionRow = GetSessionsResponse['items'][number]

function createSessionRow(overrides: Partial<SessionRow> & Pick<SessionRow, 'id'>): SessionRow {
  const now = 1_700_000_000
  const { id, ...rest } = overrides
  return {
    id,
    execution: { kind: 'local' },
    parentSessionId: null,
    sideContextSource: null,
    workspaceId: 'workspace-1',
    title: 'Session',
    origin: 'manual',
    providerTargetId: null,
    agentId: null,
    modelId: null,
    thinkingEffort: null,
    linkedIssueId: null,
    sessionGroupId: null,
    runtimeKind: 'standard',
    status: 'idle',
    pinned: 0,
    archivedAt: null,
    lastReadAt: null,
    createdAt: now,
    updatedAt: now,
    activityAt: now,
    latestUserMessageAt: null,
    latestAssistantMessageAt: null,
    unread: false,
    isIsolated: false,
    worktreeId: null,
    worktreeBranch: null,
    worktreePath: null,
    worktreeHealth: null,
    pendingWorktreeId: null,
    isolationBoundaryRequired: false,
    ...rest,
  }
}

function createSessionDetail(overrides: Partial<GetSessionsByIdResponse> & Pick<GetSessionsByIdResponse, 'id'>): GetSessionsByIdResponse {
  return { ...createSessionRow(overrides) } as unknown as GetSessionsByIdResponse
}

function createQueryClient(): QueryClient {
  return new TanstackQueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
}

interface TrackedQuery {
  queryKey: readonly unknown[]
  fetchCount: () => number
  isInvalidated: () => boolean
  dispose: () => void
}

/**
 * Seed a query and subscribe an observer so invalidations produce real
 * refetches. `staleTime: Infinity` keeps the subscribe itself fetch-free; the
 * optional `queryFn` override enables deferred (gap-window) fetches.
 */
function trackQuery(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  data: unknown,
  queryFn?: () => Promise<unknown>,
): TrackedQuery {
  const fetchSpy = vi.fn(queryFn ?? (() => Promise.resolve(data)))
  queryClient.setQueryData(queryKey, data)
  const observer = new QueryObserver(queryClient, {
    queryKey,
    queryFn: fetchSpy as unknown as () => Promise<never>,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const unsubscribe = observer.subscribe(() => {})
  return {
    queryKey,
    fetchCount: () => fetchSpy.mock.calls.length,
    isInvalidated: () => queryClient.getQueryState(queryKey)?.isInvalidated === true,
    dispose: unsubscribe,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

function tailEvent(
  type: ChatGlobalSessionTailEvent['type'],
  sessionId = 'session-1',
  sequenceId = 1,
): ChatGlobalSessionTailEvent {
  return {
    scope: 'sessions',
    sessionId,
    sequenceId,
    version: sequenceId,
    type,
    occurredAt: 100 + sequenceId,
    payload: { title: 'Next', titleSource: 'provider' },
  }
}

const RUNTIME_STATUS_KEY = runtimeSessionStatusQueryKey('session-1')
const RUNTIME_STATUS_KEY_S2 = runtimeSessionStatusQueryKey('session-2')
const ISOLATION_KEY = [{ _id: 'getSessionsByIdIsolation', path: { id: 'session-1' } }] as const

describe('session projection gateway — optimistic transitions', () => {
  it('projectCreatedSession promotes a new row into matching lists only', () => {
    const queryClient = createQueryClient()
    const workspaceKey = sessionsQueryKey('workspace-1')
    const otherWorkspaceKey = sessionsQueryKey('workspace-2')
    const globalKey = sessionsQueryKey()
    const archivedKey = sessionsQueryKey(undefined, true)

    queryClient.setQueryData<GetSessionsResponse>(workspaceKey, { items: [createSessionRow({ id: 'old' })], nextCursor: null })
    queryClient.setQueryData<GetSessionsResponse>(otherWorkspaceKey, { items: [createSessionRow({ id: 'other', workspaceId: 'workspace-2' })], nextCursor: null })
    queryClient.setQueryData<GetSessionsResponse>(globalKey, { items: [createSessionRow({ id: 'old' })], nextCursor: null })
    queryClient.setQueryData<GetSessionsResponse>(archivedKey, { items: [createSessionRow({ id: 'archived', archivedAt: 1 })], nextCursor: null })

    projectCreatedSession(queryClient, {
      id: 'new-session',
      workspaceId: 'workspace-1',
      title: 'Created',
    })

    expect(queryClient.getQueryData<GetSessionsResponse>(workspaceKey)?.items[0]).toMatchObject({
      id: 'new-session',
      title: 'Created',
      status: 'streaming',
    })
    expect(queryClient.getQueryData<GetSessionsResponse>(globalKey)?.items[0]?.id).toBe('new-session')
    expect(queryClient.getQueryData<GetSessionsResponse>(otherWorkspaceKey)?.items.map(s => s.id)).toEqual(['other'])
    expect(queryClient.getQueryData<GetSessionsResponse>(archivedKey)?.items.map(s => s.id)).toEqual(['archived'])
  })

  it('keeps optimistic list pages bounded', () => {
    const queryClient = createQueryClient()
    const queryKey = sessionsQueryKey('workspace-1')
    queryClient.setQueryData<GetSessionsResponse>(queryKey, {
      items: Array.from({ length: SESSION_LIST_PAGE_LIMIT }, (_, index) => createSessionRow({ id: `session-${index}` })),
      nextCursor: 'next-page',
    })

    projectCreatedSession(queryClient, { id: 'new-session', workspaceId: 'workspace-1', title: 'New' })

    const page = queryClient.getQueryData<GetSessionsResponse>(queryKey)
    expect(page?.items).toHaveLength(SESSION_LIST_PAGE_LIMIT)
    expect(page?.items[0]?.id).toBe('new-session')
    expect(page?.items.some(session => session.id === `session-${SESSION_LIST_PAGE_LIMIT - 1}`)).toBe(false)
  })

  it('projectSessionActivity promotes an existing row without inserting unknown sessions', () => {
    const queryClient = createQueryClient()
    const queryKey = sessionsQueryKey('workspace-1')
    queryClient.setQueryData<GetSessionsResponse>(queryKey, {
      items: [createSessionRow({ id: 'a' }), createSessionRow({ id: 'b' })],
      nextCursor: null,
    })

    projectSessionActivity(queryClient, 'b')
    expect(queryClient.getQueryData<GetSessionsResponse>(queryKey)?.items[0]?.id).toBe('b')

    projectSessionActivity(queryClient, 'unknown')
    expect(queryClient.getQueryData<GetSessionsResponse>(queryKey)?.items.map(s => s.id)).not.toContain('unknown')
  })

  it('applySessionOptimisticPatch inserts a workspace-scoped row as idle', () => {
    const queryClient = createQueryClient()
    const queryKey = sessionsQueryKey('workspace-1')
    queryClient.setQueryData<GetSessionsResponse>(queryKey, { items: [], nextCursor: null })

    applySessionOptimisticPatch(queryClient, {
      id: 'session-2',
      workspaceId: 'workspace-1',
      title: 'External session',
    })

    expect(queryClient.getQueryData<GetSessionsResponse>(queryKey)?.items[0]).toMatchObject({
      id: 'session-2',
      status: 'idle',
    })
  })

  it('applySessionOptimisticPatch patches detail and list rows, preserving existing status', () => {
    const queryClient = createQueryClient()
    const listKey = sessionsQueryKey('workspace-1')
    const detailKey = sessionDetailQueryKey('session-1')
    queryClient.setQueryData<GetSessionsResponse>(listKey, { items: [createSessionRow({ id: 'session-1', status: 'idle' })], nextCursor: null })
    queryClient.setQueryData(detailKey, createSessionDetail({ id: 'session-1', title: 'Old', modelId: 'm1' }))

    applySessionOptimisticPatch(queryClient, { id: 'session-1', modelId: 'm2' }, { updateDetail: true })

    expect(queryClient.getQueryData<GetSessionsResponse>(listKey)?.items[0]).toMatchObject({ modelId: 'm2', status: 'idle' })
    expect(queryClient.getQueryData(detailKey)).toMatchObject({ modelId: 'm2', title: 'Old' })
  })

  it('rollbackSessionOptimisticPatch restores the previous detail and refreshes lists', async () => {
    const queryClient = createQueryClient()
    const detailKey = sessionDetailQueryKey('session-1')
    const previous = createSessionDetail({ id: 'session-1', modelId: 'm1' })
    const list = trackQuery(queryClient, sessionsQueryKey('workspace-1'), { items: [createSessionRow({ id: 'session-1' })], nextCursor: null })
    queryClient.setQueryData(detailKey, createSessionDetail({ id: 'session-1', modelId: 'optimistic' }))

    rollbackSessionOptimisticPatch(queryClient, { sessionId: 'session-1', previousSession: previous })
    await flush()

    expect(queryClient.getQueryData(detailKey)).toEqual(previous)
    expect(list.fetchCount()).toBe(1)
    list.dispose()
  })

  it('applyConfirmedSession writes detail and reconciles list rows', () => {
    const queryClient = createQueryClient()
    const listKey = sessionsQueryKey('workspace-1')
    const detailKey = sessionDetailQueryKey('session-1')
    queryClient.setQueryData<GetSessionsResponse>(listKey, { items: [createSessionRow({ id: 'session-1', title: 'Old' })], nextCursor: null })

    applyConfirmedSession(queryClient, createSessionDetail({ id: 'session-1', title: 'Confirmed' }))

    expect(queryClient.getQueryData(detailKey)).toMatchObject({ title: 'Confirmed' })
    expect(queryClient.getQueryData<GetSessionsResponse>(listKey)?.items[0]?.title).toBe('Confirmed')
  })

  it('applySessionReadResult maintains the unread snapshot', () => {
    const queryClient = createQueryClient()
    updateUnreadSessionIdsSnapshot([{ id: 'a', unread: true }, { id: 'b', unread: false }])
    expect(readUnreadSessionIdsSnapshot()).toEqual(['a'])

    applySessionReadResult(queryClient, createSessionDetail({ id: 'b', unread: true }))
    expect(readUnreadSessionIdsSnapshot()).toEqual(['a', 'b'])

    applySessionReadResult(queryClient, createSessionDetail({ id: 'a', unread: false }))
    expect(readUnreadSessionIdsSnapshot()).toEqual(['b'])
  })
})

describe('session projection gateway — event transitions', () => {
  it('applySessionTailEvent refreshes detail+lists and runtime/queue per event family', async () => {
    const queryClient = createQueryClient()
    const detail = trackQuery(queryClient, sessionDetailQueryKey('session-1'), createSessionDetail({ id: 'session-1' }))
    const list = trackQuery(queryClient, sessionsQueryKey('workspace-1'), { items: [], nextCursor: null })
    const runtime = trackQuery(queryClient, RUNTIME_STATUS_KEY, { status: 'idle' })
    const queue = trackQuery(queryClient, sessionQueueQueryKey('session-1'), { items: [] })

    await applySessionTailEvent(queryClient, tailEvent('RunStarted'))
    expect(detail.fetchCount()).toBe(1)
    expect(list.fetchCount()).toBe(1)
    expect(runtime.fetchCount()).toBe(1)
    expect(queue.fetchCount()).toBe(0)

    await applySessionTailEvent(queryClient, tailEvent('QueueItemEnqueued', 'session-1', 2))
    expect(queue.fetchCount()).toBe(1)
    expect(runtime.fetchCount()).toBe(1)

    detail.dispose(); list.dispose(); runtime.dispose(); queue.dispose()
  })

  it('tray and tail facts converge to the same session projections', async () => {
    const makeCache = () => {
      const queryClient = createQueryClient()
      const tracked = {
        detail: trackQuery(queryClient, sessionDetailQueryKey('session-1'), createSessionDetail({ id: 'session-1', title: 'Fresh' })),
        list: trackQuery(queryClient, sessionsQueryKey('workspace-1'), { items: [createSessionRow({ id: 'session-1', title: 'Fresh' })], nextCursor: null }),
        runtime: trackQuery(queryClient, RUNTIME_STATUS_KEY, { status: 'streaming' }),
        queue: trackQuery(queryClient, sessionQueueQueryKey('session-1'), { items: ['q'] }),
      }
      return { queryClient, tracked }
    }

    const tail = makeCache()
    await applySessionTailEvent(tail.queryClient, tailEvent('RunStarted'))

    const tray = makeCache()
    await refreshSessionProjections(tray.queryClient, 'session-1')

    for (const family of ['detail', 'list', 'runtime'] as const) {
      const key = tail.tracked[family].queryKey
      expect(tail.queryClient.getQueryData(key)).toEqual(tray.queryClient.getQueryData(key))
      expect(tail.tracked[family].fetchCount()).toBe(1)
      expect(tray.tracked[family].fetchCount()).toBe(1)
    }
    // Tray facts are coarser ("session changed") and also cover the queue.
    expect(tail.tracked.queue.fetchCount()).toBe(0)
    expect(tray.tracked.queue.fetchCount()).toBe(1)
  })
})

describe('session projection gateway — gap recovery', () => {
  it('targeted recovery converges list, detail, runtime and queue for one session', async () => {
    const queryClient = createQueryClient()
    const detail = trackQuery(queryClient, sessionDetailQueryKey('session-1'), createSessionDetail({ id: 'session-1' }))
    const otherDetail = trackQuery(queryClient, sessionDetailQueryKey('session-2'), createSessionDetail({ id: 'session-2' }))
    const list = trackQuery(queryClient, sessionsQueryKey('workspace-1'), { items: [], nextCursor: null })
    const runtime = trackQuery(queryClient, RUNTIME_STATUS_KEY, { status: 'idle' })
    const otherRuntime = trackQuery(queryClient, RUNTIME_STATUS_KEY_S2, { status: 'idle' })
    const queue = trackQuery(queryClient, sessionQueueQueryKey('session-1'), { items: [] })

    await recoverProjectionGap(queryClient, 'session-1')

    for (const tracked of [detail, list, runtime, queue]) {
      expect(tracked.fetchCount()).toBe(1)
    }
    expect(otherDetail.fetchCount()).toBe(0)
    expect(otherDetail.isInvalidated()).toBe(false)
    expect(otherRuntime.fetchCount()).toBe(0)

    detail.dispose(); otherDetail.dispose(); list.dispose(); runtime.dispose(); otherRuntime.dispose(); queue.dispose()
  })

  it('identity-less recovery runs one global wave across existing session projections', async () => {
    const queryClient = createQueryClient()
    const detail1 = trackQuery(queryClient, sessionDetailQueryKey('session-1'), createSessionDetail({ id: 'session-1' }))
    const detail2 = trackQuery(queryClient, sessionDetailQueryKey('session-2'), createSessionDetail({ id: 'session-2' }))
    const list = trackQuery(queryClient, sessionsQueryKey(), { items: [], nextCursor: null })
    const runtime = trackQuery(queryClient, RUNTIME_STATUS_KEY, { status: 'idle' })
    const queue = trackQuery(queryClient, sessionQueueQueryKey('session-2'), { items: [] })
    const isolation = trackQuery(queryClient, ISOLATION_KEY, { isolated: false })
    const foreign = trackQuery(queryClient, ['workspaces'], { items: [] })

    await recoverProjectionGap(queryClient, null)

    for (const tracked of [detail1, detail2, list, runtime, queue, isolation]) {
      expect(tracked.fetchCount()).toBe(1)
    }
    expect(foreign.fetchCount()).toBe(0)
    expect(foreign.isInvalidated()).toBe(false)

    detail1.dispose(); detail2.dispose(); list.dispose(); runtime.dispose(); queue.dispose(); isolation.dispose(); foreign.dispose()
  })

  it('coalesces a burst of targeted gaps into one wave plus a single queued re-run', async () => {
    const queryClient = createQueryClient()
    const gate = deferred<unknown>()
    const detail = trackQuery(
      queryClient,
      sessionDetailQueryKey('session-1'),
      createSessionDetail({ id: 'session-1' }),
      () => gate.promise,
    )

    const first = recoverProjectionGap(queryClient, 'session-1')
    const second = recoverProjectionGap(queryClient, 'session-1')
    const third = recoverProjectionGap(queryClient, 'session-1')

    // Joined the in-flight wave: no extra invalidations yet.
    await flush()
    expect(detail.fetchCount()).toBe(1)

    gate.resolve(createSessionDetail({ id: 'session-1' }))
    await Promise.all([first, second, third])

    // The burst queued exactly one follow-up wave.
    expect(detail.fetchCount()).toBe(2)

    // After settling, a new gap starts a fresh wave.
    await recoverProjectionGap(queryClient, 'session-1')
    expect(detail.fetchCount()).toBe(3)
    detail.dispose()
  })

  it('coalesces global recovery waves the same way', async () => {
    const queryClient = createQueryClient()
    const gate = deferred<unknown>()
    const list = trackQuery(queryClient, sessionsQueryKey(), { items: [], nextCursor: null }, () => gate.promise)

    const first = recoverProjectionGap(queryClient, null)
    recoverProjectionGap(queryClient, null)
    recoverProjectionGap(queryClient, null)
    await flush()
    expect(list.fetchCount()).toBe(1)

    gate.resolve({ items: [], nextCursor: null })
    await first
    expect(list.fetchCount()).toBe(2)
    list.dispose()
  })

  it('leaves stale data invalidated when a recovery fetch fails', async () => {
    const queryClient = createQueryClient()
    const detail = trackQuery(
      queryClient,
      sessionDetailQueryKey('session-1'),
      createSessionDetail({ id: 'session-1' }),
      () => Promise.reject(new Error('offline')),
    )

    await recoverProjectionGap(queryClient, 'session-1')
    expect(detail.isInvalidated()).toBe(true)
    detail.dispose()
  })
})

describe('session projection gateway — ownership predicates', () => {
  it('isSessionProjectionQueryKey matches every owned family and rejects foreign keys', () => {
    expect(isSessionProjectionQueryKey(sessionsQueryKey('w'))).toBe(true)
    expect(isSessionProjectionQueryKey(sessionDetailQueryKey('s'))).toBe(true)
    expect(isSessionProjectionQueryKey(sessionQueueQueryKey('s'))).toBe(true)
    expect(isSessionProjectionQueryKey(RUNTIME_STATUS_KEY)).toBe(true)
    expect(isSessionProjectionQueryKey(ISOLATION_KEY)).toBe(true)
    expect(isSessionProjectionQueryKey([{ _id: 'getChatSessionsBySessionIdMessages' }])).toBe(false)
    expect(isSessionProjectionQueryKey([{ _id: 'getWorksById' }])).toBe(false)
    expect(isSessionProjectionQueryKey(['session', 's', 'pull-request'])).toBe(false)
  })

  it('sessionListOptions always carries the shared page limit', () => {
    expect(sessionListOptions().query).toEqual({ limit: SESSION_LIST_PAGE_LIMIT })
    expect(sessionListOptions('w1', true).query).toEqual({ limit: SESSION_LIST_PAGE_LIMIT, workspaceId: 'w1', archived: true })
  })
})
