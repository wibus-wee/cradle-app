import type { SyncServerFrame } from '@cradle/chat-runtime-contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { subscribeSyncSessionRunChunks } from './chunk-stream'

const syncClient = vi.hoisted(() => ({
  handler: null as ((frame: SyncServerFrame) => void) | null,
  cursor: null as { runId: string, cursor: number } | null,
  unsubscribe: vi.fn(),
}))

vi.mock('../client', () => ({
  subscribeSyncChannel: vi.fn((_frame, handler: (frame: SyncServerFrame) => void) => {
    syncClient.handler = handler
  }),
  unsubscribeSyncChannel: syncClient.unsubscribe,
  updateSyncRunSubscriptionCursor: vi.fn((_subId, cursor: { runId: string, cursor: number }) => {
    if (!syncClient.cursor) {
      syncClient.cursor = cursor
      return 'advanced'
    }
    if (syncClient.cursor.runId !== cursor.runId || cursor.cursor < syncClient.cursor.cursor) {
      return 'invalid'
    }
    if (syncClient.cursor.cursor === cursor.cursor) {
      return 'duplicate'
    }
    syncClient.cursor = cursor
    return 'advanced'
  }),
}))

describe('sync run chunk adapter', () => {
  beforeEach(() => {
    syncClient.handler = null
    syncClient.cursor = null
    syncClient.unsubscribe.mockClear()
  })

  it('deduplicates cursors and preserves tool output through terminal', async () => {
    const result = await subscribeSyncSessionRunChunks({ sessionId: 'session-1' })
    const reader = result.stream.getReader()
    const input = {
      subId: 'sub-1',
      kind: 'chunk',
      runId: 'run-1',
      cursor: 0,
      chunk: { type: 'tool-input-start', toolCallId: 'tool-1', toolName: 'exec' },
      terminal: false,
      replay: false,
    } satisfies SyncServerFrame
    syncClient.handler?.(input)
    syncClient.handler?.(input)

    expect((await reader.read()).value?.chunk).toEqual(input.chunk)

    const output = {
      subId: 'sub-1',
      kind: 'chunk',
      runId: 'run-1',
      cursor: 1,
      chunk: { type: 'tool-output-available', toolCallId: 'tool-1', output: 'done' },
      terminal: false,
      replay: false,
    } satisfies SyncServerFrame
    syncClient.handler?.(output)
    expect((await reader.read()).value?.chunk).toEqual(output.chunk)

    syncClient.handler?.({
      subId: 'sub-1',
      kind: 'chunk',
      runId: 'run-1',
      cursor: 2,
      chunk: { type: 'finish', finishReason: 'stop' },
      terminal: true,
      replay: false,
    })
    expect((await reader.read()).value?.chunk.type).toBe('finish')
    expect((await reader.read()).done).toBe(true)
  })

  it('keeps retryable ends open', async () => {
    const result = await subscribeSyncSessionRunChunks({ sessionId: 'session-1' })
    const reader = result.stream.getReader()
    syncClient.handler?.({ subId: 'sub-1', kind: 'end', reason: 'backpressure' })
    syncClient.handler?.({
      subId: 'sub-1',
      kind: 'chunk',
      runId: 'run-1',
      cursor: 0,
      chunk: { type: 'start', messageId: 'message-1' },
      terminal: false,
      replay: true,
    })

    expect((await reader.read()).value?.chunk.type).toBe('start')
    await reader.cancel()
  })

  it('surfaces snapshot recovery instead of normal EOF', async () => {
    const result = await subscribeSyncSessionRunChunks({ sessionId: 'session-1' })
    const read = result.stream.getReader().read()
    syncClient.handler?.({ subId: 'sub-1', kind: 'end', reason: 'snapshot-required' })

    await expect(read).rejects.toMatchObject({
      name: 'SyncRunStreamError',
      code: 'snapshot-required',
    })
  })

  it('rejects replay from a different run before exposing its chunks', async () => {
    const result = await subscribeSyncSessionRunChunks({
      sessionId: 'session-1',
      expectedRunId: 'run-current',
    })
    const read = result.stream.getReader().read()
    syncClient.handler?.({
      subId: 'sub-1',
      kind: 'chunk',
      runId: 'run-stale',
      cursor: 0,
      chunk: { type: 'start', messageId: 'message-stale' },
      terminal: false,
      replay: true,
    })

    await expect(read).rejects.toMatchObject({
      name: 'SyncRunStreamError',
      code: 'snapshot-required',
    })
  })

  it('fails visibly when a cursor moves backwards', async () => {
    const result = await subscribeSyncSessionRunChunks({ sessionId: 'session-1' })
    const reader = result.stream.getReader()
    syncClient.handler?.({
      subId: 'sub-1',
      kind: 'chunk',
      runId: 'run-1',
      cursor: 2,
      chunk: { type: 'start', messageId: 'message-1' },
      terminal: false,
      replay: false,
    })
    await reader.read()
    const read = reader.read()
    syncClient.handler?.({
      subId: 'sub-1',
      kind: 'chunk',
      runId: 'run-1',
      cursor: 1,
      chunk: { type: 'text-start', id: 'text-1' },
      terminal: false,
      replay: false,
    })

    await expect(read).rejects.toMatchObject({ code: 'protocol-error' })
  })
})
