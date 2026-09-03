// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { openPassiveSessionStream } from './session-passive-stream'
import { useChatSessionDriver } from './use-chat-session-driver'

interface FakeSyncEngine {
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  reconcileRuntimeState: ReturnType<typeof vi.fn>
  updatePassiveStream: ReturnType<typeof vi.fn>
  passiveStreamFactory: ((request: {
    sessionId: string
    runId: string
    messageId: string
    onSettled: () => void
  }) => unknown) | null
}

interface FakeRuntimeStatusQuery {
  data: {
    status: 'idle' | 'streaming'
    activeRun: { runId: string, messageId: string } | null
  }
  dataUpdatedAt: number
  isFetchedAfterMount: boolean
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

  const runtimeStatusQuery: FakeRuntimeStatusQuery = {
    data: {
      status: 'streaming',
      activeRun: { runId: 'run-1', messageId: 'assistant-1' },
    },
    dataUpdatedAt: Number.MAX_SAFE_INTEGER,
    isFetchedAfterMount: true,
  }

  return {
    engineInstances,
    snapshotQuery: {
      data: undefined as { pages: Array<{ revision: number, rows: [], nextCursor: null }> } | undefined,
      dataUpdatedAt: 0,
      isError: false,
      isFetching: false,
    },
    runtimeStatusQuery,
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
  readStableMessageRows: async () => null,
  writeStableMessageRows: async () => undefined,
}))
vi.mock('./use-chat-session-types', () => ({
  QUEUE_DRAIN_SYNC_DELAY_MS: 0,
  readStableSnapshotRows: () => null,
  releaseSessionStreamingStateForTerminalRun: () => false,
}))
vi.mock('./session-snapshot-projection', () => ({
  deriveSessionPassiveStreamProjection: () => ({ locallyDriven: false }),
  deriveSessionSnapshotProjection: () => ({
    messages: [],
    passiveRunState: { messageIds: [], status: 'idle' },
    failedMessage: null,
    requestSnapshotRefresh: false,
  }),
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
    constructor(options: { passiveStreamFactory: FakeSyncEngine['passiveStreamFactory'] }) {
      const engine: FakeSyncEngine = {
        start: vi.fn(),
        stop: vi.fn(),
        reconcileRuntimeState: vi.fn(),
        updatePassiveStream: vi.fn(),
        passiveStreamFactory: options.passiveStreamFactory,
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
    mocks.store.streamLeaseMap.clear()
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
      runtimeActiveRunId: 'run-1',
      runtimeActiveRunMessageId: 'assistant-1',
    })
  })

  it('releases a settled passive lease when its terminal snapshot arrived first', () => {
    const driver = renderHook(() => useChatSessionDriver('new-session'))

    act(() => {
      mocks.snapshotQuery = {
        data: { pages: [{ revision: 1, rows: [], nextCursor: null }] },
        dataUpdatedAt: 10,
        isError: false,
        isFetching: false,
      }
      driver.rerender()
    })

    const factory = mocks.engineInstances[0]?.passiveStreamFactory
    expect(factory).not.toBeNull()
    factory?.({
      sessionId: 'new-session',
      runId: 'run-1',
      messageId: 'assistant-1',
      onSettled: vi.fn(),
    })
    const passiveStreamInput = vi.mocked(openPassiveSessionStream).mock.calls[0]?.[0]
    expect(passiveStreamInput).toBeDefined()
    mocks.store.setMessages.mockClear()
    mocks.store.releaseStreamLease.mockClear()

    act(() => {
      mocks.store.streamLeaseMap.set('assistant-1', { sessionId: 'new-session' })
      passiveStreamInput?.releaseStreamLeaseAfterSnapshot('assistant-1')
      mocks.runtimeStatusQuery = {
        data: { status: 'idle', activeRun: null },
        dataUpdatedAt: 10,
        isFetchedAfterMount: true,
      }
      driver.rerender()
    })

    expect(mocks.store.releaseStreamLease).toHaveBeenCalledWith('assistant-1')
    expect(mocks.store.releaseStreamLease.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.store.setMessages.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    )
  })
})
