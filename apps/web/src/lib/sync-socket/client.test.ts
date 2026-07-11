// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/lib/electron', () => ({
  getAuthenticatedServerWebSocketUrl: async () => 'ws://127.0.0.1:4100/sync?ticket=test-ticket',
}))

type WebSocketListener = (event: Event | MessageEvent<string>) => void

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []

  readyState = FakeWebSocket.CONNECTING
  readonly sent: string[] = []
  private readonly listeners = new Map<string, WebSocketListener[]>()

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: WebSocketListener): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED
    this.dispatch('close', new Event('close'))
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN
    this.dispatch('open', new Event('open'))
  }

  emitMessage(data: string): void {
    this.dispatch('message', new MessageEvent('message', { data }))
  }

  private dispatch(type: string, event: Event | MessageEvent<string>): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event)
    }
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

async function waitForSocket(index = 0): Promise<FakeWebSocket> {
  await vi.waitFor(() => {
    expect(FakeWebSocket.instances[index]).toBeDefined()
  })
  return FakeWebSocket.instances[index]!
}

describe('sync socket client', () => {
  let client: typeof import('./client')

  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    Object.defineProperty(globalThis, 'WebSocket', {
      value: FakeWebSocket,
      configurable: true,
      writable: true,
    })
    client = await import('./client')
  })

  afterEach(() => {
    client?.disposeSyncSocketClient()
    FakeWebSocket.instances = []
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('queues subscription sends until the socket opens and drops malformed frames', async () => {
    const handler = vi.fn()

    client.subscribeSyncChannel({
      op: 'sub',
      subId: 'sub-1',
      channel: 'session-tail',
      sessionId: 'session-1',
      afterVersion: 4,
    }, handler)

    const socket = await waitForSocket()
    expect(socket?.url).toBe('ws://127.0.0.1:4100/sync?ticket=test-ticket')
    expect(socket.sent).toEqual([])

    socket.open()
    await flushMicrotasks()
    socket.emitMessage('not-json')

    expect(handler).not.toHaveBeenCalled()
    expect(socket.sent.map(frame => JSON.parse(frame))).toContainEqual({
      op: 'sub',
      subId: 'sub-1',
      channel: 'session-tail',
      sessionId: 'session-1',
      afterVersion: 4,
    })
  })

  it('resubscribes with the latest cursor after reconnect', async () => {
    const handler = vi.fn()

    client.subscribeSyncChannel({
      op: 'sub',
      subId: 'sub-1',
      channel: 'session-tail',
      sessionId: 'session-1',
      afterVersion: 4,
    }, handler)
    const firstSocket = await waitForSocket()
    firstSocket.open()
    await flushMicrotasks()

    firstSocket.emitMessage(JSON.stringify({
      subId: 'sub-1',
      kind: 'sub-ack',
      cursor: 7,
    }))
    firstSocket.close()

    await vi.advanceTimersByTimeAsync(500)
    await flushMicrotasks()
    const secondSocket = await waitForSocket(1)
    secondSocket.open()
    await flushMicrotasks()

    expect(secondSocket.sent.map(frame => JSON.parse(frame))).toContainEqual({
      op: 'sub',
      subId: 'sub-1',
      channel: 'session-tail',
      sessionId: 'session-1',
      afterVersion: 7,
    })
    expect(client.getActiveSyncSubscriptionCount()).toBe(1)
  })
})
