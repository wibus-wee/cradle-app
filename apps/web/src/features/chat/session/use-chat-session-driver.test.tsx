// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useChatSessionDriver } from './use-chat-session-driver'

interface FakeSyncEngine {
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  reconcileRuntimeState: ReturnType<typeof vi.fn>
  updatePassiveStream: ReturnType<typeof vi.fn>
}

const mocks = vi.hoisted(() => {
  const engineInstances: FakeSyncEngine[] = []
  const store = {
    messagesMap: new Map<string, []>(),
    streamLeaseMap: new Map(),
    setMessages: vi.fn(),
    setSessionHydrated: vi.fn(),
    clearSessionErrors: vi.fn(),
    setPassiveRunState: vi.fn(),
    failGeneration: vi.fn(),
    releaseStreamLease: vi.fn(),
  }

  return {
    engineInstances,
    snapshotQuery: {
      data: undefined as { pages: Array<{ revision: number, rows: [], nextCursor: null }> } | undefined,
      dataUpdatedAt: 0,
      isError: false,
      isFetching: false,
    },
    runtimeStatusQuery: {
      data: {
        status: 'streaming',
        activeRun: { runId: 'run-1', messageId: 'assistant-1' },
      },
      dataUpdatedAt: Number.MAX_SAFE_INTEGER,
      isFetchedAfterMount: true,
    },
    controls: {
      scheduleSnapshotRefresh: vi.fn(),
      refreshQueue: vi.fn(),
      queryClient: { invalidateQueries: vi.fn() },
      refreshRuntimeUiSlotStates: vi.fn(),
      refreshSessionLists: vi.fn(),
    },
    store,
  }
})

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    useInfiniteQuery: () => mocks.snapshotQuery,
  }
})

vi.mock('~/lib/electron', () => ({ getServerUrl: () => 'http://127.0.0.1:21423' }))
vi.mock('../api/messages', () => ({ chatMessageHistoryInfiniteOptions: () => ({}) }))
vi.mock('../runtime/use-runtime-session-status', () => ({
  useRuntimeSessionStatus: () => mocks.runtimeStatusQuery,
}))
vi.mock('./use-chat-session-runtime-controls', () => ({
  useChatSessionRuntimeControls: () => mocks.controls,
}))
vi.mock('./stable-message-cache', () => ({
  readStableMessageRows: vi.fn().mockResolvedValue(null),
  writeStableMessageRows: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('./use-chat-session-types', () => ({
  QUEUE_DRAIN_SYNC_DELAY_MS: 0,
  readStableSnapshotRows: () => null,
  releaseSessionStreamingStateForTerminalRun: () => false,
}))
vi.mock('./session-snapshot-projection', () => ({
  deriveSessionPassiveStreamProjection: () => ({ locallyDriven: false }),
  deriveSessionSnapshotProjection: () => null,
  deriveStableSessionSnapshotProjection: () => null,
}))
vi.mock('./session-passive-stream', () => ({ openPassiveSessionStream: vi.fn() }))
vi.mock('../transport/chat-event-tail-transport', () => ({ createChatSessionEventSource: vi.fn() }))
vi.mock('../commands/runtime-session-status-command', () => ({
  runtimeSessionStatusQueryKey: (sessionId: string) => ['runtime-session-status', sessionId],
}))
vi.mock('~/store/chat', () => ({
  chatSelectors: { sessionRunState: () => () => null },
  useChatStore: { getState: () => mocks.store },
}))
vi.mock('./session-sync-engine', () => ({
  SessionSyncEngine: class {
    constructor() {
      const engine: FakeSyncEngine = {
        start: vi.fn(),
        stop: vi.fn(),
        reconcileRuntimeState: vi.fn(),
        updatePassiveStream: vi.fn(),
      }
      mocks.engineInstances.push(engine)
      return engine
    }
  },
}))

describe('useChatSessionDriver', () => {
  beforeEach(() => {
    mocks.engineInstances.length = 0
    mocks.snapshotQuery = {
      data: undefined,
      dataUpdatedAt: 0,
      isError: false,
      isFetching: false,
    }
    mocks.runtimeStatusQuery = {
      data: {
        status: 'streaming',
        activeRun: { runId: 'run-1', messageId: 'assistant-1' },
      },
      dataUpdatedAt: Number.MAX_SAFE_INTEGER,
      isFetchedAfterMount: true,
    }
    vi.clearAllMocks()
  })

  afterEach(() => cleanup())

  it('attaches the passive stream when the active run arrives before the first snapshot', () => {
    const driver = renderHook(() => useChatSessionDriver('new-session'))

    expect(mocks.engineInstances).toHaveLength(0)

    act(() => {
      mocks.snapshotQuery = {
        data: { pages: [{ revision: 1, rows: [], nextCursor: null }] },
        dataUpdatedAt: 1,
        isError: false,
        isFetching: false,
      }
      driver.rerender()
    })

    expect(mocks.engineInstances).toHaveLength(1)
    expect(mocks.engineInstances[0]?.updatePassiveStream).toHaveBeenCalledWith({
      enabled: true,
      sessionId: 'new-session',
      locallyDriven: false,
      runtimeActiveRunMessageId: 'assistant-1',
    })
  })
})
