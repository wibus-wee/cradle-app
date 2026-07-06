import { describe, expect, it, vi } from 'vitest'

import {
  ChatStreamBroker,
  DESKTOP_CHAT_REPLAY_MAX_CHUNKS,
  DESKTOP_CHAT_STREAM_CHUNK_CHANNEL,
  DESKTOP_CHAT_STREAM_CLOSED_CHANNEL,
  DESKTOP_CHAT_STREAM_ERROR_CHANNEL,
} from './chat-stream-broker'

type Listener = () => void

class FakeWebContents {
  readonly send = vi.fn()
  private readonly listeners = new Map<string, Listener[]>()
  private destroyed = false

  isDestroyed(): boolean {
    return this.destroyed
  }

  once(eventName: string, listener: Listener): void {
    const listeners = this.listeners.get(eventName) ?? []
    listeners.push(listener)
    this.listeners.set(eventName, listeners)
  }

  removeListener(eventName: string, listener: Listener): void {
    const listeners = this.listeners.get(eventName) ?? []
    this.listeners.set(eventName, listeners.filter(candidate => candidate !== listener))
  }

  listenerCount(eventName: string): number {
    return this.listeners.get(eventName)?.length ?? 0
  }

  destroy(): void {
    this.destroyed = true
    for (const listener of this.listeners.get('destroyed') ?? []) {
      listener()
    }
  }
}

interface ControlledSseResponse {
  controller: ReadableStreamDefaultController<Uint8Array>
  response: Response
}

function createControlledSseResponse(headers: Record<string, string> = {}): ControlledSseResponse {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  const stream = new ReadableStream<Uint8Array>({
    start(nextController) {
      controller = nextController
    },
  })
  return {
    controller: controller!,
    response: new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        ...headers,
      },
    }),
  }
}

function createImmediateSseResponse(frames: unknown[], headers: Record<string, string> = {}): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encodeSse(frame))
      }
    },
  }), {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      ...headers,
    },
  })
}

function encodeSse(value: unknown): Uint8Array {
  const text = value === '[DONE]'
    ? 'data: [DONE]\n\n'
    : `data: ${JSON.stringify(value)}\n\n`
  return new TextEncoder().encode(text)
}

function readChannelPayloads(webContents: FakeWebContents, channel: string): unknown[] {
  return webContents.send.mock.calls
    .filter(call => call[0] === channel)
    .map(call => call[1])
}

describe('chat stream broker', () => {
  it('shares one upstream response stream across multiple renderer subscribers', async () => {
    const controlled = createControlledSseResponse({
      'x-cradle-run-id': 'run-1',
      'x-cradle-assistant-message-id': 'assistant-1',
      'x-cradle-user-message-id': 'user-1',
    })
    const fetchFn = vi.fn(async () => controlled.response)
    const broker = new ChatStreamBroker({
      serverUrl: 'http://127.0.0.1:21423',
      fetchFn: fetchFn as typeof fetch,
    })
    const first = new FakeWebContents()
    const second = new FakeWebContents()

    const firstHandle = await broker.startResponse(first as never, {
      sessionId: 'session-1',
      body: { text: 'hello' },
    })
    const secondHandle = await broker.subscribeSession(second as never, {
      sessionId: 'session-1',
    })

    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(firstHandle.runId).toBe('run-1')
    expect(secondHandle.runId).toBe('run-1')
    expect(broker.diagnostics().streams).toMatchObject([
      {
        sessionId: 'session-1',
        mode: 'response',
        runId: 'run-1',
        subscriberCount: 2,
      },
    ])

    controlled.controller.enqueue(encodeSse({ type: 'start', messageId: 'assistant-1' }))
    controlled.controller.enqueue(encodeSse({ type: 'text-start', id: 'text-1' }))
    controlled.controller.enqueue(encodeSse('[DONE]'))

    await vi.waitFor(() => {
      expect(readChannelPayloads(first, DESKTOP_CHAT_STREAM_CHUNK_CHANNEL)).toHaveLength(2)
      expect(readChannelPayloads(second, DESKTOP_CHAT_STREAM_CHUNK_CHANNEL)).toHaveLength(2)
      expect(readChannelPayloads(first, DESKTOP_CHAT_STREAM_CLOSED_CHANNEL)).toHaveLength(1)
      expect(readChannelPayloads(second, DESKTOP_CHAT_STREAM_CLOSED_CHANNEL)).toHaveLength(1)
      expect(broker.diagnostics().streams).toHaveLength(0)
    })
  })

  it('keeps a passive upstream alive while one subscriber remains and aborts it after the final subscriber leaves', async () => {
    const controlled = createControlledSseResponse({ 'x-cradle-run-id': 'run-2' })
    let upstreamSignal: AbortSignal | null = null
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      upstreamSignal = init?.signal ?? null
      return controlled.response
    })
    const broker = new ChatStreamBroker({
      serverUrl: 'http://127.0.0.1:21423',
      fetchFn: fetchFn as typeof fetch,
    })
    const first = new FakeWebContents()
    const second = new FakeWebContents()

    const firstHandle = await broker.subscribeSession(first as never, { sessionId: 'session-2' })
    const secondHandle = await broker.subscribeSession(second as never, { sessionId: 'session-2' })

    broker.abortStream(first as never, { streamId: firstHandle.streamId })
    controlled.controller.enqueue(encodeSse({ type: 'text-start', id: 'text-2' }))

    await vi.waitFor(() => {
      expect(readChannelPayloads(first, DESKTOP_CHAT_STREAM_CHUNK_CHANNEL)).toHaveLength(0)
      expect(readChannelPayloads(second, DESKTOP_CHAT_STREAM_CHUNK_CHANNEL)).toHaveLength(1)
      expect((upstreamSignal as AbortSignal | null)?.aborted).toBe(false)
    })

    broker.abortStream(second as never, { streamId: secondHandle.streamId })

    expect((upstreamSignal as AbortSignal | null)?.aborted).toBe(true)
    expect(broker.diagnostics().streams).toHaveLength(0)
  })

  it('replays buffered chunks to a late subscriber before forwarding live chunks', async () => {
    const controlled = createControlledSseResponse({ 'x-cradle-run-id': 'run-replay' })
    const fetchFn = vi.fn(async () => controlled.response)
    const broker = new ChatStreamBroker({
      serverUrl: 'http://127.0.0.1:21423',
      fetchFn: fetchFn as typeof fetch,
    })
    const first = new FakeWebContents()
    const late = new FakeWebContents()

    await broker.startResponse(first as never, {
      sessionId: 'session-replay',
      body: { text: 'hello' },
    })
    controlled.controller.enqueue(encodeSse({ type: 'start', messageId: 'assistant-replay' }))
    controlled.controller.enqueue(encodeSse({ type: 'text-start', id: 'text-replay' }))

    await vi.waitFor(() => {
      expect(readChannelPayloads(first, DESKTOP_CHAT_STREAM_CHUNK_CHANNEL)).toHaveLength(2)
    })

    const lateHandle = await broker.subscribeSession(late as never, {
      sessionId: 'session-replay',
    })

    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(lateHandle.runId).toBe('run-replay')
    expect(readChannelPayloads(late, DESKTOP_CHAT_STREAM_CHUNK_CHANNEL)).toMatchObject([
      { replay: true, chunk: { type: 'start', messageId: 'assistant-replay' } },
      { replay: true, chunk: { type: 'text-start', id: 'text-replay' } },
    ])
    expect(broker.diagnostics().streams).toMatchObject([
      {
        sessionId: 'session-replay',
        subscriberCount: 2,
        replayChunkCount: 2,
      },
    ])

    controlled.controller.enqueue(encodeSse({ type: 'text-delta', id: 'text-replay', delta: ' world' }))

    await vi.waitFor(() => {
      expect(readChannelPayloads(first, DESKTOP_CHAT_STREAM_CHUNK_CHANNEL)).toHaveLength(3)
      expect(readChannelPayloads(late, DESKTOP_CHAT_STREAM_CHUNK_CHANNEL)).toHaveLength(3)
    })
    expect(readChannelPayloads(late, DESKTOP_CHAT_STREAM_CHUNK_CHANNEL).at(-1)).toMatchObject({
      replay: false,
      chunk: { type: 'text-delta', id: 'text-replay', delta: ' world' },
    })
  })

  it('keeps only a bounded replay tail for late subscribers', async () => {
    const controlled = createControlledSseResponse({ 'x-cradle-run-id': 'run-bounded-replay' })
    const fetchFn = vi.fn(async () => controlled.response)
    const broker = new ChatStreamBroker({
      serverUrl: 'http://127.0.0.1:21423',
      fetchFn: fetchFn as typeof fetch,
    })
    const first = new FakeWebContents()
    const late = new FakeWebContents()
    const overflowCount = 8
    const totalChunks = DESKTOP_CHAT_REPLAY_MAX_CHUNKS + overflowCount

    await broker.startResponse(first as never, {
      sessionId: 'session-bounded-replay',
      body: { text: 'hello' },
    })
    for (let index = 0; index < totalChunks; index += 1) {
      controlled.controller.enqueue(encodeSse({ type: 'message-metadata', messageMetadata: { index } }))
    }

    await vi.waitFor(() => {
      expect(readChannelPayloads(first, DESKTOP_CHAT_STREAM_CHUNK_CHANNEL)).toHaveLength(totalChunks)
      expect(broker.diagnostics().streams[0]?.replayChunkCount).toBe(DESKTOP_CHAT_REPLAY_MAX_CHUNKS)
    })

    await broker.subscribeSession(late as never, {
      sessionId: 'session-bounded-replay',
    })

    const lateChunks = readChannelPayloads(late, DESKTOP_CHAT_STREAM_CHUNK_CHANNEL)
    expect(lateChunks).toHaveLength(DESKTOP_CHAT_REPLAY_MAX_CHUNKS)
    expect(lateChunks[0]).toMatchObject({ chunk: { messageMetadata: { index: overflowCount } } })
    expect(lateChunks.at(-1)).toMatchObject({ chunk: { messageMetadata: { index: totalChunks - 1 } } })
  })

  it('retains replay anchors needed by later text deltas and tool outputs', async () => {
    const controlled = createControlledSseResponse({ 'x-cradle-run-id': 'run-protocol-replay' })
    const fetchFn = vi.fn(async () => controlled.response)
    const broker = new ChatStreamBroker({
      serverUrl: 'http://127.0.0.1:21423',
      fetchFn: fetchFn as typeof fetch,
    })
    const first = new FakeWebContents()
    const late = new FakeWebContents()

    await broker.startResponse(first as never, {
      sessionId: 'session-protocol-replay',
      body: { text: 'hello' },
    })

    controlled.controller.enqueue(encodeSse({ type: 'text-start', id: 'text-protected' }))
    controlled.controller.enqueue(encodeSse({ type: 'tool-input-start', toolCallId: 'call-protected', toolName: 'shell' }))
    for (let index = 0; index < DESKTOP_CHAT_REPLAY_MAX_CHUNKS + 8; index += 1) {
      controlled.controller.enqueue(encodeSse({ type: 'message-metadata', messageMetadata: { index } }))
    }
    controlled.controller.enqueue(encodeSse({ type: 'text-delta', id: 'text-protected', delta: 'kept' }))
    controlled.controller.enqueue(encodeSse({ type: 'tool-output-available', toolCallId: 'call-protected', output: { ok: true } }))

    await vi.waitFor(() => {
      expect(readChannelPayloads(first, DESKTOP_CHAT_STREAM_CHUNK_CHANNEL).length)
        .toBe(DESKTOP_CHAT_REPLAY_MAX_CHUNKS + 12)
    })

    await broker.subscribeSession(late as never, {
      sessionId: 'session-protocol-replay',
    })

    const lateChunks = readChannelPayloads(late, DESKTOP_CHAT_STREAM_CHUNK_CHANNEL)
      .map(payload => (payload as { chunk: unknown }).chunk)
    const textStartIndex = lateChunks.findIndex(chunk =>
      typeof chunk === 'object'
      && chunk !== null
      && (chunk as { type?: unknown, id?: unknown }).type === 'text-start'
      && (chunk as { id?: unknown }).id === 'text-protected')
    const textDeltaIndex = lateChunks.findIndex(chunk =>
      typeof chunk === 'object'
      && chunk !== null
      && (chunk as { type?: unknown, id?: unknown }).type === 'text-delta'
      && (chunk as { id?: unknown }).id === 'text-protected')
    const toolStartIndex = lateChunks.findIndex(chunk =>
      typeof chunk === 'object'
      && chunk !== null
      && (chunk as { type?: unknown, toolCallId?: unknown }).type === 'tool-input-start'
      && (chunk as { toolCallId?: unknown }).toolCallId === 'call-protected')
    const toolOutputIndex = lateChunks.findIndex(chunk =>
      typeof chunk === 'object'
      && chunk !== null
      && (chunk as { type?: unknown, toolCallId?: unknown }).type === 'tool-output-available'
      && (chunk as { toolCallId?: unknown }).toolCallId === 'call-protected')

    expect(textStartIndex).toBeGreaterThanOrEqual(0)
    expect(textDeltaIndex).toBeGreaterThan(textStartIndex)
    expect(toolStartIndex).toBeGreaterThanOrEqual(0)
    expect(toolOutputIndex).toBeGreaterThan(toolStartIndex)
  })

  it('coalesces replay deltas using the server stream merge rule', async () => {
    const controlled = createControlledSseResponse({ 'x-cradle-run-id': 'run-coalesced-replay' })
    const fetchFn = vi.fn(async () => controlled.response)
    const broker = new ChatStreamBroker({
      serverUrl: 'http://127.0.0.1:21423',
      fetchFn: fetchFn as typeof fetch,
    })
    const first = new FakeWebContents()
    const late = new FakeWebContents()

    await broker.startResponse(first as never, {
      sessionId: 'session-coalesced-replay',
      body: { text: 'hello' },
    })
    controlled.controller.enqueue(encodeSse({ type: 'text-delta', id: 'text-1', delta: 'hello ' }))
    controlled.controller.enqueue(encodeSse({ type: 'text-delta', id: 'text-1', delta: 'world' }))

    await vi.waitFor(() => {
      expect(readChannelPayloads(first, DESKTOP_CHAT_STREAM_CHUNK_CHANNEL)).toHaveLength(2)
      expect(broker.diagnostics().streams[0]?.replayChunkCount).toBe(1)
    })

    await broker.subscribeSession(late as never, {
      sessionId: 'session-coalesced-replay',
    })

    expect(readChannelPayloads(late, DESKTOP_CHAT_STREAM_CHUNK_CHANNEL)).toMatchObject([
      { chunk: { type: 'text-delta', id: 'text-1', delta: 'hello world' } },
    ])
  })

  it('coalesces replay tool output snapshots by keeping the latest output', async () => {
    const controlled = createControlledSseResponse({ 'x-cradle-run-id': 'run-tool-output-replay' })
    const fetchFn = vi.fn(async () => controlled.response)
    const broker = new ChatStreamBroker({
      serverUrl: 'http://127.0.0.1:21423',
      fetchFn: fetchFn as typeof fetch,
    })
    const first = new FakeWebContents()
    const late = new FakeWebContents()

    await broker.startResponse(first as never, {
      sessionId: 'session-tool-output-replay',
      body: { text: 'hello' },
    })
    controlled.controller.enqueue(encodeSse({ type: 'tool-input-start', toolCallId: 'call-subagent', toolName: 'Agent' }))
    controlled.controller.enqueue(encodeSse({
      type: 'tool-output-available',
      toolCallId: 'call-subagent',
      output: { snapshot: 'first' },
      preliminary: true,
    }))
    controlled.controller.enqueue(encodeSse({
      type: 'tool-output-available',
      toolCallId: 'call-subagent',
      output: { snapshot: 'second' },
      preliminary: true,
    }))
    controlled.controller.enqueue(encodeSse({
      type: 'tool-output-available',
      toolCallId: 'call-subagent',
      output: { snapshot: 'final' },
    }))

    await vi.waitFor(() => {
      expect(readChannelPayloads(first, DESKTOP_CHAT_STREAM_CHUNK_CHANNEL)).toHaveLength(4)
      expect(broker.diagnostics().streams[0]?.replayChunkCount).toBe(2)
    })

    await broker.subscribeSession(late as never, {
      sessionId: 'session-tool-output-replay',
    })

    expect(readChannelPayloads(late, DESKTOP_CHAT_STREAM_CHUNK_CHANNEL)).toMatchObject([
      { chunk: { type: 'tool-input-start', toolCallId: 'call-subagent', toolName: 'Agent' } },
      { chunk: { type: 'tool-output-available', toolCallId: 'call-subagent', output: { snapshot: 'final' } } },
    ])
  })

  it('does not replay duplicate chunks to an early subscriber when upstream data arrives before the handle resolves', async () => {
    const fetchFn = vi.fn(async () => createImmediateSseResponse([
      { type: 'start', messageId: 'assistant-fast' },
      { type: 'text-start', id: 'text-fast' },
    ], { 'x-cradle-run-id': 'run-fast' }))
    const broker = new ChatStreamBroker({
      serverUrl: 'http://127.0.0.1:21423',
      fetchFn: fetchFn as typeof fetch,
    })
    const subscriber = new FakeWebContents()

    await broker.startResponse(subscriber as never, {
      sessionId: 'session-fast',
      body: { text: 'hello' },
    })

    await vi.waitFor(() => {
      expect(readChannelPayloads(subscriber, DESKTOP_CHAT_STREAM_CHUNK_CHANNEL)).toHaveLength(2)
    })
    expect(readChannelPayloads(subscriber, DESKTOP_CHAT_STREAM_CHUNK_CHANNEL)).toMatchObject([
      { chunk: { type: 'start', messageId: 'assistant-fast' } },
      { chunk: { type: 'text-start', id: 'text-fast' } },
    ])
  })

  it('retains a response upstream after the sending renderer unsubscribes', async () => {
    const controlled = createControlledSseResponse({ 'x-cradle-run-id': 'run-3' })
    let upstreamSignal: AbortSignal | null = null
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      upstreamSignal = init?.signal ?? null
      return controlled.response
    })
    const broker = new ChatStreamBroker({
      serverUrl: 'http://127.0.0.1:21423',
      fetchFn: fetchFn as typeof fetch,
    })
    const sender = new FakeWebContents()

    const handle = await broker.startResponse(sender as never, {
      sessionId: 'session-3',
      body: { text: 'hello' },
    })

    broker.abortStream(sender as never, { streamId: handle.streamId })

    expect((upstreamSignal as AbortSignal | null)?.aborted).toBe(false)
    expect(broker.diagnostics().streams).toMatchObject([
      {
        sessionId: 'session-3',
        mode: 'response',
        subscriberCount: 0,
        keepAliveWithoutSubscribers: true,
      },
    ])

    controlled.controller.enqueue(encodeSse('[DONE]'))

    await vi.waitFor(() => {
      expect(broker.diagnostics().streams).toHaveLength(0)
    })
  })

  it('uses one destroyed listener per renderer webContents across repeated subscriptions', async () => {
    const controlled = createControlledSseResponse({ 'x-cradle-run-id': 'run-listener-cleanup' })
    const fetchFn = vi.fn(async () => controlled.response)
    const broker = new ChatStreamBroker({
      serverUrl: 'http://127.0.0.1:21423',
      fetchFn: fetchFn as typeof fetch,
    })
    const webContents = new FakeWebContents()
    const handles = []

    for (let index = 0; index < 12; index += 1) {
      handles.push(await broker.subscribeSession(webContents as never, { sessionId: 'session-listener-cleanup' }))
    }

    expect(webContents.listenerCount('destroyed')).toBe(1)
    expect(broker.diagnostics().streams).toMatchObject([
      {
        sessionId: 'session-listener-cleanup',
        subscriberCount: 12,
      },
    ])

    for (const handle of handles) {
      broker.abortStream(webContents as never, { streamId: handle.streamId })
    }

    expect(webContents.listenerCount('destroyed')).toBe(0)
    expect(broker.diagnostics().streams).toHaveLength(0)
  })

  it('does not reuse an idle passive session entry for a response request', async () => {
    const passiveResponse = createControlledSseResponse({ 'x-cradle-run-id': 'run-passive' })
    const responseStream = createControlledSseResponse({ 'x-cradle-run-id': 'run-response' })
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(passiveResponse.response)
      .mockResolvedValueOnce(responseStream.response)
    const broker = new ChatStreamBroker({
      serverUrl: 'http://127.0.0.1:21423',
      fetchFn: fetchFn as typeof fetch,
    })
    const passiveWindow = new FakeWebContents()
    const senderWindow = new FakeWebContents()

    await broker.subscribeSession(passiveWindow as never, { sessionId: 'session-4' })
    const responseHandle = await broker.startResponse(senderWindow as never, {
      sessionId: 'session-4',
      body: { text: 'new turn' },
    })

    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(responseHandle.runId).toBe('run-response')
    expect(readChannelPayloads(passiveWindow, DESKTOP_CHAT_STREAM_CLOSED_CHANNEL)).toMatchObject([
      { reason: 'aborted' },
    ])
    expect(broker.diagnostics().streams).toMatchObject([
      {
        sessionId: 'session-4',
        mode: 'response',
        runId: 'run-response',
        subscriberCount: 1,
      },
    ])

    responseStream.controller.enqueue(encodeSse('[DONE]'))

    await vi.waitFor(() => {
      expect(broker.diagnostics().streams).toHaveLength(0)
    })
  })

  it('times out a response upstream before headers and allows a later response for the same session', async () => {
    const recoveredStream = createControlledSseResponse({ 'x-cradle-run-id': 'run-recovered' })
    const fetchFn = vi
      .fn()
      .mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason ?? new DOMException('This operation was aborted', 'AbortError'))
          }, { once: true })
        })
      })
      .mockResolvedValueOnce(recoveredStream.response)
    const broker = new ChatStreamBroker({
      serverUrl: 'http://127.0.0.1:21423',
      fetchFn: fetchFn as typeof fetch,
      upstreamOpenTimeoutMs: 5,
    })
    const firstSender = new FakeWebContents()
    const secondSender = new FakeWebContents()

    await expect(broker.startResponse(firstSender as never, {
      sessionId: 'session-stuck-before-headers',
      body: { text: 'stuck turn' },
    })).rejects.toThrow('Chat stream upstream did not return response headers within 5ms')

    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(readChannelPayloads(firstSender, DESKTOP_CHAT_STREAM_ERROR_CHANNEL)).toMatchObject([
      {
        sessionId: 'session-stuck-before-headers',
        runId: null,
        message: 'Chat stream upstream did not return response headers within 5ms',
      },
    ])
    expect(broker.diagnostics().streams).toHaveLength(0)

    const handle = await broker.startResponse(secondSender as never, {
      sessionId: 'session-stuck-before-headers',
      body: { text: 'next turn' },
    })

    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(handle.runId).toBe('run-recovered')
    expect(broker.diagnostics().streams).toMatchObject([
      {
        sessionId: 'session-stuck-before-headers',
        mode: 'response',
        runId: 'run-recovered',
        subscriberCount: 1,
      },
    ])

    recoveredStream.controller.enqueue(encodeSse('[DONE]'))

    await vi.waitFor(() => {
      expect(broker.diagnostics().streams).toHaveLength(0)
    })
  })

  it('replaces an in-flight response request when it has not returned headers yet', async () => {
    const recoveredStream = createControlledSseResponse({ 'x-cradle-run-id': 'run-replaced' })
    const fetchFn = vi
      .fn()
      .mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason ?? new DOMException('This operation was aborted', 'AbortError'))
          }, { once: true })
        })
      })
      .mockResolvedValueOnce(recoveredStream.response)
    const broker = new ChatStreamBroker({
      serverUrl: 'http://127.0.0.1:21423',
      fetchFn: fetchFn as typeof fetch,
    })
    const firstSender = new FakeWebContents()
    const secondSender = new FakeWebContents()

    const firstHandlePromise = broker.startResponse(firstSender as never, {
      sessionId: 'session-replace-pending-response',
      body: { text: 'stuck turn' },
    })

    expect(fetchFn).toHaveBeenCalledTimes(1)

    const secondHandle = await broker.startResponse(secondSender as never, {
      sessionId: 'session-replace-pending-response',
      body: { text: 'replacement turn' },
    })
    const firstHandle = await firstHandlePromise

    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(firstHandle).toMatchObject({
      sessionId: 'session-replace-pending-response',
      runId: null,
    })
    expect(secondHandle.runId).toBe('run-replaced')
    expect(readChannelPayloads(firstSender, DESKTOP_CHAT_STREAM_CLOSED_CHANNEL)).toMatchObject([
      { streamId: firstHandle.streamId, reason: 'aborted' },
    ])
    expect(broker.diagnostics().streams).toMatchObject([
      {
        sessionId: 'session-replace-pending-response',
        mode: 'response',
        runId: 'run-replaced',
        subscriberCount: 1,
      },
    ])

    recoveredStream.controller.enqueue(encodeSse('[DONE]'))

    await vi.waitFor(() => {
      expect(broker.diagnostics().streams).toHaveLength(0)
    })
  })

  it('settles an in-flight passive subscription when a response replaces it before headers arrive', async () => {
    const responseStream = createControlledSseResponse({ 'x-cradle-run-id': 'run-response' })
    const fetchFn = vi
      .fn()
      .mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(init.signal?.reason ?? new DOMException('This operation was aborted', 'AbortError'))
          }, { once: true })
        })
      })
      .mockResolvedValueOnce(responseStream.response)
    const broker = new ChatStreamBroker({
      serverUrl: 'http://127.0.0.1:21423',
      fetchFn: fetchFn as typeof fetch,
    })
    const passiveWindow = new FakeWebContents()
    const senderWindow = new FakeWebContents()

    const passiveHandlePromise = broker.subscribeSession(passiveWindow as never, {
      sessionId: 'session-pending-passive',
    })

    expect(fetchFn).toHaveBeenCalledTimes(1)

    const responseHandle = await broker.startResponse(senderWindow as never, {
      sessionId: 'session-pending-passive',
      body: { text: 'new turn' },
    })
    const passiveHandle = await passiveHandlePromise

    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(passiveHandle).toMatchObject({
      sessionId: 'session-pending-passive',
      runId: null,
    })
    expect(responseHandle.runId).toBe('run-response')
    expect(readChannelPayloads(passiveWindow, DESKTOP_CHAT_STREAM_CLOSED_CHANNEL)).toMatchObject([
      { streamId: passiveHandle.streamId, reason: 'aborted' },
    ])
    expect(broker.diagnostics().streams).toMatchObject([
      {
        sessionId: 'session-pending-passive',
        mode: 'response',
        runId: 'run-response',
        subscriberCount: 1,
      },
    ])

    responseStream.controller.enqueue(encodeSse('[DONE]'))

    await vi.waitFor(() => {
      expect(broker.diagnostics().streams).toHaveLength(0)
    })
  })

  it('starts and drains a detached response stream without a renderer subscriber', async () => {
    const controlled = createControlledSseResponse({ 'x-cradle-run-id': 'run-detached' })
    const fetchFn = vi.fn(async () => controlled.response)
    const broker = new ChatStreamBroker({
      serverUrl: 'http://127.0.0.1:21423',
      fetchFn: fetchFn as typeof fetch,
    })

    const handle = await broker.startResponseDetached({
      sessionId: 'session-detached',
      body: { text: 'reply from notification' },
    })

    expect(handle).toMatchObject({
      sessionId: 'session-detached',
      runId: 'run-detached',
    })
    expect(fetchFn).toHaveBeenCalledWith(
      new URL('http://127.0.0.1:21423/chat/sessions/session-detached/response'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: 'reply from notification' }),
      }),
    )
    expect(broker.diagnostics().streams).toMatchObject([
      {
        sessionId: 'session-detached',
        mode: 'response',
        runId: 'run-detached',
        subscriberCount: 1,
        keepAliveWithoutSubscribers: true,
      },
    ])

    controlled.controller.enqueue(encodeSse({ type: 'text-delta', id: 'text-detached', delta: 'ok' }))
    controlled.controller.enqueue(encodeSse('[DONE]'))

    await vi.waitFor(() => {
      expect(broker.diagnostics().streams).toHaveLength(0)
    })
  })
})
