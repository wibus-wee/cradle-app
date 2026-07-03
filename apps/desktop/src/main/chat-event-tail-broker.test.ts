import { describe, expect, it, vi } from 'vitest'

import {
  ChatEventTailBroker,
  DESKTOP_CHAT_EVENT_TAIL_CLOSED_CHANNEL,
  DESKTOP_CHAT_EVENT_TAIL_EVENT_CHANNEL,
} from './chat-event-tail-broker'

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

function createControlledSseResponse(): ControlledSseResponse {
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
      },
    }),
  }
}

function encodeSessionEvent(event: unknown, id = 1): Uint8Array {
  return new TextEncoder().encode([
    `id: ${id}`,
    'event: session',
    `data: ${JSON.stringify(event)}`,
    '',
    '',
  ].join('\n'))
}

function encodeGlobalSessionEvent(event: unknown, id = 1): Uint8Array {
  return new TextEncoder().encode([
    `id: ${id}`,
    'event: sessions',
    `data: ${JSON.stringify(event)}`,
    '',
    '',
  ].join('\n'))
}

function readChannelPayloads(webContents: FakeWebContents, channel: string): unknown[] {
  return webContents.send.mock.calls
    .filter(call => call[0] === channel)
    .map(call => call[1])
}

describe('chat event tail broker', () => {
  it('shares one upstream global sessions event tail across renderer subscribers', async () => {
    const controlled = createControlledSseResponse()
    const fetchFn = vi.fn(async () => controlled.response)
    const broker = new ChatEventTailBroker({
      serverUrl: 'http://127.0.0.1:21423',
      fetchFn: fetchFn as typeof fetch,
    })
    const first = new FakeWebContents()
    const second = new FakeWebContents()

    const firstHandle = broker.subscribeGlobalSessionEvents(first as never, {
      afterSequenceId: 9,
      workspaceId: 'workspace-1',
    })
    const secondHandle = broker.subscribeGlobalSessionEvents(second as never, {
      afterSequenceId: 9,
      workspaceId: 'workspace-1',
    })

    await vi.waitFor(() => {
      expect(fetchFn).toHaveBeenCalledTimes(1)
    })
    expect(fetchFn).toHaveBeenCalledWith(
      new URL('http://127.0.0.1:21423/events?scope=sessions&afterSequenceId=9&workspaceId=workspace-1'),
      expect.objectContaining({ method: 'GET' }),
    )
    expect(firstHandle).toMatchObject({ scope: 'sessions', sessionId: null })
    expect(secondHandle).toMatchObject({ scope: 'sessions', sessionId: null })

    controlled.controller.enqueue(encodeGlobalSessionEvent({
      scope: 'sessions',
      sessionId: 'session-1',
      sequenceId: 10,
      version: 5,
      type: 'TitleChanged',
      occurredAt: 100,
      payload: { title: 'Next', titleSource: 'provider' },
    }, 10))

    await vi.waitFor(() => {
      expect(readChannelPayloads(first, DESKTOP_CHAT_EVENT_TAIL_EVENT_CHANNEL)).toHaveLength(1)
      expect(readChannelPayloads(second, DESKTOP_CHAT_EVENT_TAIL_EVENT_CHANNEL)).toHaveLength(1)
    })
    expect(broker.diagnostics().tails).toMatchObject([
      {
        scope: 'sessions',
        sessionId: null,
        workspaceId: 'workspace-1',
        afterSequenceId: 9,
        subscriberCount: 2,
        replayEventCount: 1,
      },
    ])
  })

  it('shares one upstream session event tail across multiple renderer subscribers', async () => {
    const controlled = createControlledSseResponse()
    const fetchFn = vi.fn(async () => controlled.response)
    const broker = new ChatEventTailBroker({
      serverUrl: 'http://127.0.0.1:21423',
      fetchFn: fetchFn as typeof fetch,
    })
    const first = new FakeWebContents()
    const second = new FakeWebContents()

    const firstHandle = broker.subscribeSessionEvents(first as never, {
      sessionId: 'session-1',
      afterVersion: 4,
    })
    const secondHandle = broker.subscribeSessionEvents(second as never, {
      sessionId: 'session-1',
      afterVersion: 4,
    })

    await vi.waitFor(() => {
      expect(fetchFn).toHaveBeenCalledTimes(1)
    })
    expect(fetchFn).toHaveBeenCalledWith(
      new URL('http://127.0.0.1:21423/chat/sessions/session-1/events?afterVersion=4'),
      expect.objectContaining({ method: 'GET' }),
    )
    expect(firstHandle.sessionId).toBe('session-1')
    expect(secondHandle.sessionId).toBe('session-1')

    controlled.controller.enqueue(encodeSessionEvent({
      scope: 'session',
      sessionId: 'session-1',
      sequenceId: 10,
      version: 5,
      type: 'RunStarted',
      occurredAt: 100,
      payload: { runId: 'run-1' },
    }))

    await vi.waitFor(() => {
      expect(readChannelPayloads(first, DESKTOP_CHAT_EVENT_TAIL_EVENT_CHANNEL)).toHaveLength(1)
      expect(readChannelPayloads(second, DESKTOP_CHAT_EVENT_TAIL_EVENT_CHANNEL)).toHaveLength(1)
    })
    expect(broker.diagnostics().tails).toMatchObject([
      {
        sessionId: 'session-1',
        afterVersion: 4,
        subscriberCount: 2,
        replayEventCount: 1,
      },
    ])
  })

  it('replays buffered events newer than the subscriber version', async () => {
    const controlled = createControlledSseResponse()
    const fetchFn = vi.fn(async () => controlled.response)
    const broker = new ChatEventTailBroker({
      serverUrl: 'http://127.0.0.1:21423',
      fetchFn: fetchFn as typeof fetch,
    })
    const first = new FakeWebContents()
    const late = new FakeWebContents()

    broker.subscribeSessionEvents(first as never, {
      sessionId: 'session-replay',
      afterVersion: 0,
    })

    controlled.controller.enqueue(encodeSessionEvent({
      scope: 'session',
      sessionId: 'session-replay',
      sequenceId: 1,
      version: 1,
      type: 'RunStarted',
      occurredAt: 100,
      payload: { runId: 'run-1' },
    }, 1))
    controlled.controller.enqueue(encodeSessionEvent({
      scope: 'session',
      sessionId: 'session-replay',
      sequenceId: 2,
      version: 2,
      type: 'RunCompleted',
      occurredAt: 101,
      payload: { runId: 'run-1' },
    }, 2))

    await vi.waitFor(() => {
      expect(readChannelPayloads(first, DESKTOP_CHAT_EVENT_TAIL_EVENT_CHANNEL)).toHaveLength(2)
    })

    broker.subscribeSessionEvents(late as never, {
      sessionId: 'session-replay',
      afterVersion: 1,
    })

    expect(readChannelPayloads(late, DESKTOP_CHAT_EVENT_TAIL_EVENT_CHANNEL)).toMatchObject([
      {
        sessionId: 'session-replay',
        event: {
          version: 2,
          type: 'RunCompleted',
        },
      },
    ])
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('aborts the upstream after the final renderer unsubscribes', async () => {
    const controlled = createControlledSseResponse()
    let upstreamSignal: AbortSignal | null = null
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      upstreamSignal = init?.signal ?? null
      return controlled.response
    })
    const broker = new ChatEventTailBroker({
      serverUrl: 'http://127.0.0.1:21423',
      fetchFn: fetchFn as typeof fetch,
    })
    const first = new FakeWebContents()
    const second = new FakeWebContents()

    const firstHandle = broker.subscribeSessionEvents(first as never, { sessionId: 'session-abort' })
    const secondHandle = broker.subscribeSessionEvents(second as never, { sessionId: 'session-abort' })

    await vi.waitFor(() => {
      expect(upstreamSignal).not.toBeNull()
    })

    broker.abortTail(first as never, { tailId: firstHandle.tailId })
    expect((upstreamSignal as AbortSignal | null)?.aborted).toBe(false)

    broker.abortTail(second as never, { tailId: secondHandle.tailId })

    expect((upstreamSignal as AbortSignal | null)?.aborted).toBe(true)
    expect(readChannelPayloads(first, DESKTOP_CHAT_EVENT_TAIL_CLOSED_CHANNEL)).toHaveLength(1)
    expect(readChannelPayloads(second, DESKTOP_CHAT_EVENT_TAIL_CLOSED_CHANNEL)).toHaveLength(1)
    expect(broker.diagnostics().tails).toHaveLength(0)
  })

  it('uses one destroyed listener per renderer webContents across repeated subscriptions', () => {
    const controlled = createControlledSseResponse()
    const fetchFn = vi.fn(async () => controlled.response)
    const broker = new ChatEventTailBroker({
      serverUrl: 'http://127.0.0.1:21423',
      fetchFn: fetchFn as typeof fetch,
    })
    const webContents = new FakeWebContents()
    const handles = []

    for (let index = 0; index < 12; index += 1) {
      handles.push(broker.subscribeSessionEvents(webContents as never, { sessionId: 'session-listeners' }))
    }

    expect(webContents.listenerCount('destroyed')).toBe(1)

    for (const handle of handles) {
      broker.abortTail(webContents as never, { tailId: handle.tailId })
    }

    expect(webContents.listenerCount('destroyed')).toBe(0)
    expect(broker.diagnostics().tails).toHaveLength(0)
  })
})
