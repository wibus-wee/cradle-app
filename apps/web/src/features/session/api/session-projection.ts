import type {
  ChatGlobalSessionTailEvent,
  ChatSessionTailEventType,
} from '@cradle/chat-runtime-contracts'
import type { QueryClient } from '@tanstack/react-query'

import {
  getSessionsByIdOptions,
  getSessionsByIdQueryKey,
  getSessionsOptions,
  getSessionsQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import type {
  GetSessionsByIdResponse,
  GetSessionsData,
  GetSessionsResponse,
} from '~/api-gen/types.gen'
import { runtimeSessionStatusQueryKey } from '~/features/chat/commands/runtime-session-status-command'

/**
 * Session projection gateway — the sole owner of Session cache topology.
 *
 * Every Session business projection lives in React Query under one of the
 * families owned here:
 *
 * - `list`    — `GET /sessions/` filtered variants (workspace / archived / limit)
 * - `detail`  — `GET /sessions/:id`
 * - `runtime` — `GET /chat/sessions/:id/runtime-status`
 * - `queue`   — `['chat', 'session-queue', sessionId]`
 *
 * External adapters (event tails, desktop tray, pages, chat runtime) submit
 * semantic facts — created, activity, changed, read result, archived, gap —
 * and never compose raw query keys or choose which projections to touch.
 */

export const SESSION_LIST_PAGE_LIMIT = 200
export const SESSION_LIST_REFRESH_INTERVAL_MS = 5_000

const SESSION_PROJECTION_QUERY_IDS = new Set([
  'getSessions',
  'getSessionsById',
  'getSessionsByIdIsolation',
  'getChatSessionsBySessionIdRuntimeStatus',
])

const RUNTIME_EVENT_TYPES = new Set<ChatSessionTailEventType>([
  'RunStarted',
  'InteractionRequested',
  'InteractionResolved',
  'RunCompleted',
  'RunFailed',
  'RunAborted',
])

const QUEUE_EVENT_TYPES = new Set<ChatSessionTailEventType>([
  'QueueItemEnqueued',
  'QueueItemClaimed',
  'QueueItemReleased',
  'QueueItemFailed',
  'QueueItemReordered',
  'QueueItemUpdated',
  'QueueItemProviderTargetCleared',
  'QueueItemCancelled',
])

/* ─── Query-key ownership ────────────────────────────────────────────── */

export function sessionListOptions(
  workspaceId?: string | null,
  archived?: boolean,
  limit: number = SESSION_LIST_PAGE_LIMIT,
): GetSessionsData {
  const query: NonNullable<GetSessionsData['query']> = { limit }

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

/** List query options for read consumers — key composition stays here. */
export function sessionListQueryOptions(
  workspaceId?: string | null,
  archived?: boolean,
  limit?: number,
) {
  return getSessionsOptions(sessionListOptions(workspaceId, archived, limit))
}

export function isSessionsQueryKey(queryKey: readonly unknown[]): boolean {
  const head = queryKey[0]
  return head !== null
    && typeof head === 'object'
    && (head as { _id?: unknown })._id === 'getSessions'
}

export function sessionDetailQueryKey(sessionId: string) {
  return getSessionsByIdQueryKey({ path: { id: sessionId } })
}

/** Detail query options for read consumers — key composition stays here. */
export function sessionDetailOptions(sessionId: string) {
  return getSessionsByIdOptions({ path: { id: sessionId } })
}

/** Current cached detail snapshot (e.g. to checkpoint before an optimistic patch). */
export function readSessionDetailSnapshot(
  queryClient: QueryClient,
  sessionId: string,
): GetSessionsByIdResponse | undefined {
  return queryClient.getQueryData<GetSessionsByIdResponse>(sessionDetailQueryKey(sessionId))
}

export function sessionQueueQueryKey(sessionId: string) {
  return ['chat', 'session-queue', sessionId] as const
}

/**
 * Whether a cached query belongs to a Session projection family. Used to
 * schedule a global recovery wave without knowing which sessions exist.
 */
export function isSessionProjectionQueryKey(queryKey: readonly unknown[]): boolean {
  const head = queryKey[0]
  if (head === 'chat' && queryKey[1] === 'session-queue') {
    return true
  }
  return head !== null
    && typeof head === 'object'
    && SESSION_PROJECTION_QUERY_IDS.has((head as { _id?: unknown })._id as string)
}

/* ─── Unread snapshot (non-React readers) ────────────────────────────── */

let unreadSessionIdsSnapshot: string[] = []

export function readUnreadSessionIdsSnapshot(): string[] {
  return unreadSessionIdsSnapshot
}

export function updateUnreadSessionIdsSnapshot(
  sessions: ReadonlyArray<{ id: string, unread: boolean }>,
): void {
  unreadSessionIdsSnapshot = sessions.filter(session => session.unread).map(session => session.id)
}

/* ─── List write engine (private) ────────────────────────────────────── */

type SessionListResponseRow = GetSessionsResponse['items'][number] & {
  latestUserMessageAt?: unknown
}

type SessionListPatch = Partial<SessionListResponseRow> & {
  id: string
}

interface SessionListWriteOptions {
  promote?: boolean
  updatedAt?: number
  latestUserMessageAt?: number
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
  patch: SessionListPatch,
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
    activityAt: updatedAt,
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

/**
 * Upsert a row patch into every cached `getSessions` page whose filters admit
 * it. A patch without `workspaceId` updates existing rows only; `promote`
 * moves the row to the front with fresh activity timestamps, bounded to the
 * shared page limit.
 */
function writeSessionIntoSessionLists(
  queryClient: QueryClient,
  patch: SessionListPatch,
  options: SessionListWriteOptions = {},
): void {
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

/* ─── Semantic transitions: optimistic writes & confirmations ────────── */

/** Optimistic row fields a caller may assert for a freshly created session. */
export interface CreatedSessionProjection {
  id: string
  workspaceId: string | null
  title: string | null
  agentId?: string | null
  providerTargetId?: string | null
  modelId?: string | null
  runtimeKind?: string
  sessionGroupId?: string | null
}

/** A session was created and accepted by the server: promote its row to the top of every matching list. */
export function projectCreatedSession(
  queryClient: QueryClient,
  session: CreatedSessionProjection,
): void {
  writeSessionIntoSessionLists(queryClient, { ...session }, { promote: true })
}

/** A user-visible turn was submitted on an existing session: bump its row. */
export function projectSessionActivity(queryClient: QueryClient, sessionId: string): void {
  writeSessionIntoSessionLists(queryClient, { id: sessionId }, { promote: true })
}

export interface SessionOptimisticPatch {
  id: string
  providerTargetId?: string | null
  modelId?: string | null
  thinkingEffort?: SessionListResponseRow['thinkingEffort']
  title?: string | null
  sessionGroupId?: string | null
  pinned?: number
  archivedAt?: number | null
  workspaceId?: string | null
}

/** Optimistically patch session fields into list rows, and optionally the detail cache. */
export function applySessionOptimisticPatch(
  queryClient: QueryClient,
  patch: SessionOptimisticPatch,
  options: { updateDetail?: boolean } = {},
): void {
  if (options.updateDetail) {
    queryClient.setQueryData(sessionDetailQueryKey(patch.id), current =>
      current && typeof current === 'object'
        ? { ...current, ...patch }
        : current)
  }
  writeSessionIntoSessionLists(queryClient, patch)
}

/** The server confirmed a session snapshot: write detail and reconcile list rows. */
export function applyConfirmedSession(
  queryClient: QueryClient,
  session: GetSessionsByIdResponse,
): void {
  queryClient.setQueryData(sessionDetailQueryKey(session.id), session)
  writeSessionIntoSessionLists(queryClient, session)
}

/** A read/unread mutation returned the authoritative session: apply it and sync the unread snapshot. */
export function applySessionReadResult(
  queryClient: QueryClient,
  session: GetSessionsByIdResponse,
): void {
  applyConfirmedSession(queryClient, session)
  unreadSessionIdsSnapshot = session.unread
    ? [...new Set([...unreadSessionIdsSnapshot, session.id])]
    : unreadSessionIdsSnapshot.filter(sessionId => sessionId !== session.id)
}

/** An optimistic patch failed: restore the previous detail snapshot and re-sync lists. */
export function rollbackSessionOptimisticPatch(
  queryClient: QueryClient,
  input: { sessionId: string, previousSession: unknown },
): void {
  queryClient.setQueryData(sessionDetailQueryKey(input.sessionId), input.previousSession)
  void queryClient.invalidateQueries({ queryKey: sessionDetailQueryKey(input.sessionId) })
  void refreshSessionLists(queryClient)
}

/* ─── Semantic transitions: refresh waves ────────────────────────────── */

/** Refresh every cached session-list variant (unfiltered, workspace, archived). */
export function refreshSessionLists(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: query => isSessionsQueryKey(query.queryKey),
  }).then(() => {})
}

/**
 * Refresh every Session projection for one session: list membership, detail,
 * runtime status and queue. Used after server-side mutations (archive,
 * restore, rename, pin, isolation), run settle, and tray-reported changes.
 */
export function refreshSessionProjections(
  queryClient: QueryClient,
  sessionId: string,
): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: sessionDetailQueryKey(sessionId) }),
    queryClient.invalidateQueries({ predicate: query => isSessionsQueryKey(query.queryKey) }),
    queryClient.invalidateQueries({ queryKey: runtimeSessionStatusQueryKey(sessionId) }),
    queryClient.invalidateQueries({ queryKey: sessionQueueQueryKey(sessionId) }),
  ]).then(() => {})
}

/** Refresh only the detail projection for one session (e.g. debounced snapshot sync). */
export function refreshSessionDetail(
  queryClient: QueryClient,
  sessionId: string,
): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: sessionDetailQueryKey(sessionId) }).then(() => {})
}

/** Refresh only the runtime-status projection for one session. */
export function refreshSessionRuntimeStatus(
  queryClient: QueryClient,
  sessionId: string,
): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: runtimeSessionStatusQueryKey(sessionId) }).then(() => {})
}

/** Refresh only the queue projection for one session. */
export function refreshSessionQueue(
  queryClient: QueryClient,
  sessionId: string,
): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: sessionQueueQueryKey(sessionId) }).then(() => {})
}

/** A deleted session's projections are dropped rather than refreshed. */
export function dropSessionProjection(queryClient: QueryClient, sessionId: string): void {
  queryClient.removeQueries({ queryKey: sessionDetailQueryKey(sessionId) })
  void refreshSessionLists(queryClient)
}

/* ─── Semantic transitions: event tail facts ─────────────────────────── */

/** A global session tail event changed one session's projections. */
export function applySessionTailEvent(
  queryClient: QueryClient,
  event: ChatGlobalSessionTailEvent,
): Promise<void> {
  const refreshes = [
    queryClient.invalidateQueries({ queryKey: sessionDetailQueryKey(event.sessionId) }),
    refreshSessionLists(queryClient),
  ]
  if (RUNTIME_EVENT_TYPES.has(event.type)) {
    refreshes.push(queryClient.invalidateQueries({ queryKey: runtimeSessionStatusQueryKey(event.sessionId) }).then(() => {}))
  }
  if (QUEUE_EVENT_TYPES.has(event.type)) {
    refreshes.push(queryClient.invalidateQueries({ queryKey: sessionQueueQueryKey(event.sessionId) }).then(() => {}))
  }
  return Promise.all(refreshes).then(() => {})
}

/* ─── Gap recovery (SnapshotRequired / transport errors) ─────────────── */

interface RecoveryWaveState {
  inFlight: Promise<void> | null
  queued: boolean
}

const targetedRecoveryStates = new WeakMap<QueryClient, Map<string, RecoveryWaveState>>()
const globalRecoveryStates = new WeakMap<QueryClient, RecoveryWaveState>()

/**
 * Run one refresh wave under in-flight ownership: calls arriving while a wave
 * is running join it and schedule at most one follow-up wave, so a burst of
 * gaps cannot storm the server. Uses promise state only — no debounce timing.
 */
function runCoalescedWave(state: RecoveryWaveState, wave: () => Promise<void>): Promise<void> {
  if (state.inFlight) {
    state.queued = true
    return state.inFlight
  }
  const task = (async () => {
    try {
      do {
        state.queued = false
        await wave()
      } while (state.queued)
    }
    finally {
      state.inFlight = null
      state.queued = false
    }
  })()
  state.inFlight = task
  return task
}

function readTargetedRecoveryState(queryClient: QueryClient, sessionId: string): RecoveryWaveState {
  let states = targetedRecoveryStates.get(queryClient)
  if (!states) {
    states = new Map()
    targetedRecoveryStates.set(queryClient, states)
  }
  let state = states.get(sessionId)
  if (!state) {
    state = { inFlight: null, queued: false }
    states.set(sessionId, state)
  }
  return state
}

function readGlobalRecoveryState(queryClient: QueryClient): RecoveryWaveState {
  let state = globalRecoveryStates.get(queryClient)
  if (!state) {
    state = { inFlight: null, queued: false }
    globalRecoveryStates.set(queryClient, state)
  }
  return state
}

/**
 * Recover from a lost or gapped session event stream.
 *
 * With a session identity (`SnapshotRequired` events carry `sessionId`), run a
 * targeted wave refreshing that session's list membership, detail, runtime and
 * queue projections. Without one (transport-level error), invalidate every
 * existing Session projection query in a single deduplicated global wave.
 *
 * The returned promise settles when the wave finishes; failed refetches leave
 * queries invalidated (stale) rather than marking them fresh, so the next gap
 * signal retries coherently.
 */
export function recoverProjectionGap(
  queryClient: QueryClient,
  sessionId: string | null,
): Promise<void> {
  if (sessionId) {
    const state = readTargetedRecoveryState(queryClient, sessionId)
    return runCoalescedWave(state, () => refreshSessionProjections(queryClient, sessionId))
  }
  const state = readGlobalRecoveryState(queryClient)
  return runCoalescedWave(state, () =>
    queryClient.invalidateQueries({
      predicate: query => isSessionProjectionQueryKey(query.queryKey),
    }).then(() => {}))
}
