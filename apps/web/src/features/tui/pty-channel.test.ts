import { afterEach, describe, expect, it, vi } from 'vitest'

import { createPtyChannel } from './pty-channel'
import type { PtyErrorEvent, PtySnapshotEvent } from './pty-protocol'

vi.mock('~/lib/electron', () => ({
  getServerWebSocketUrl: (_socketPath: string, query?: { fromSeq?: number }) => {
    const url = new URL('ws://127.0.0.1/pty')
    if (typeof query?.fromSeq === 'number') {
      url.searchParams.set('fromSeq', String(query.fromSeq))
    }
    return url.toString()
  },
}))

vi.mock('~/i18n/instance', () => ({
  getI18n: () => ({
    t: (key: string) => key,
  }),
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

describe('createPtyChannel', () => {
  const originalWebSocket = globalThis.WebSocket

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket
    FakeWebSocket.instances = []
    vi.useRealTimers()
  })

  it('drops malformed server frames without breaking later valid frames', () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const snapshots: PtySnapshotEvent[] = []
    const errors: PtyErrorEvent[] = []
    const channel = createPtyChannel({
      socketPath: '/pty/session-1',
      onSnapshot: event => snapshots.push(event),
      onOutput: vi.fn(),
      onExit: vi.fn(),
      onError: event => errors.push(event),
    })

    channel.connect()
    const socket = FakeWebSocket.instances[0]
    expect(socket?.url).toBe('ws://127.0.0.1/pty')

    socket.open()
    expect(() => socket.emitMessage('not json')).not.toThrow()
    expect(() => socket.emitMessage(JSON.stringify({ type: 'snapshot', seq: 1, buffer: 'ready', running: true }))).not.toThrow()

    expect(errors).toEqual([
      {
        type: 'error',
        code: 'INVALID_SERVER_EVENT',
        message: 'Received malformed terminal event.',
      },
    ])
    expect(snapshots).toEqual([
      {
        type: 'snapshot',
        seq: 1,
        buffer: 'ready',
        running: true,
      },
    ])
    expect(channel.getLastSeq()).toBe(1)

    channel.close()
  })

  it('flushes queued client messages when the socket opens', () => {
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const channel = createPtyChannel({
      socketPath: '/pty/session-1',
      onSnapshot: vi.fn(),
      onOutput: vi.fn(),
      onExit: vi.fn(),
    })

    channel.connect()
    const socket = FakeWebSocket.instances[0]
    channel.sendInput('hello')
    channel.sendResize(120, 40)

    expect(socket.sent).toEqual([])

    socket.open()

    expect(socket.sent.map(frame => JSON.parse(frame))).toEqual([
      { type: 'input', data: 'hello' },
      { type: 'resize', cols: 120, rows: 40 },
    ])

    channel.close()
  })

  it('reconnects from the latest server sequence', () => {
    vi.useFakeTimers()
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const channel = createPtyChannel({
      socketPath: '/pty/session-1',
      reconnectDelayMs: 250,
      onSnapshot: vi.fn(),
      onOutput: vi.fn(),
      onExit: vi.fn(),
    })

    channel.connect()
    const firstSocket = FakeWebSocket.instances[0]
    firstSocket.open()
    firstSocket.emitMessage(JSON.stringify({
      type: 'output',
      seq: 5,
      data: 'chunk',
    }))
    firstSocket.close()

    vi.advanceTimersByTime(250)

    expect(FakeWebSocket.instances[1]?.url).toBe('ws://127.0.0.1/pty?fromSeq=5')

    channel.close()
  })
})
