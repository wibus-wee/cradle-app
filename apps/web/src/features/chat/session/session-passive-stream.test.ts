import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SyncRunStreamError } from '~/lib/sync-socket'

import { openPassiveSessionStream } from './session-passive-stream'

const mocks = vi.hoisted(() => ({
  consume: vi.fn(),
  dispose: vi.fn(),
  fail: vi.fn(),
  finish: vi.fn(),
  start: vi.fn(),
  subscribe: vi.fn(),
}))

vi.mock('../transport/chat-stream-transport', () => ({
  subscribeChatSessionStreamForSession: mocks.subscribe,
}))

vi.mock('../transport/chat-streaming-handler', () => ({
  ChatStreamingHandler: class {
    consume = mocks.consume
    dispose = mocks.dispose
    fail = mocks.fail
    finish = mocks.finish
    start = mocks.start
  },
}))

vi.mock('~/store/chat', () => ({
  useChatStore: { getState: () => ({ setRunDisplayId: vi.fn() }) },
}))

describe('openPassiveSessionStream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.subscribe.mockResolvedValue({
      runId: null,
      stream: new ReadableStream(),
    })
  })

  it('hands recoverable stream misses back to the authoritative snapshot', async () => {
    mocks.consume.mockRejectedValue(new SyncRunStreamError('not-found', 'run settled'))
    const onSettled = vi.fn()
    const releaseStreamLeaseAfterSnapshot = vi.fn()
    const scheduleSnapshotRefresh = vi.fn()

    openPassiveSessionStream({
      request: {
        sessionId: 'session-1',
        runId: 'run-1',
        messageId: 'assistant-1',
        onSettled,
      },
      scheduleSnapshotRefresh,
      refreshQueue: vi.fn(),
      releaseStreamLeaseAfterSnapshot,
    })

    await vi.waitFor(() => expect(onSettled).toHaveBeenCalledOnce())
    expect(mocks.fail).not.toHaveBeenCalled()
    expect(releaseStreamLeaseAfterSnapshot).toHaveBeenCalledWith('assistant-1')
    expect(scheduleSnapshotRefresh).toHaveBeenCalledWith(0)
  })
})
