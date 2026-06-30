import net from 'node:net'

import {
  createRemoteAgentError,
  encodeRemoteAgentFrame,
  parseRemoteAgentFrame,
  REMOTE_AGENT_PROTOCOL_VERSION,
  type HostHelloParams,
  type HostHelloResult,
  type RemoteAgentFrame,
  type RemoteAgentParams,
  type RemoteAgentProtocolError,
  type RemoteAgentResult,
  type RemoteAgentStreamMethod,
  type RemoteAgentStreamValue,
  type RemoteAgentUnaryMethod,
} from '@cradle/remote-agent-protocol'
import WebSocket from 'ws'
import type { RawData } from 'ws'

export type RemoteHostConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'offline'

export interface RemoteAgentDaemonClientOptions {
  socketPath: string
  heartbeatIntervalMs?: number
  heartbeatTimeoutMs?: number
  onTransportClose?: (error: RemoteAgentTransportError) => void
}

export interface RemoteAgentDaemonClient {
  readonly state: RemoteHostConnectionState
  readonly socketPath: string
  readonly hello: HostHelloResult | null
  connect(params?: HostHelloParams): Promise<HostHelloResult>
  call<M extends RemoteAgentUnaryMethod>(
    method: M,
    params: RemoteAgentParams<M>,
  ): Promise<RemoteAgentResult<M>>
  openStream<M extends RemoteAgentStreamMethod>(
    method: M,
    params: RemoteAgentParams<M>,
  ): AsyncGenerator<RemoteAgentStreamValue<M>, void, void>
  close(): Promise<void>
}

export class RemoteAgentRpcError extends Error {
  readonly code: string
  readonly details?: unknown

  constructor(error: RemoteAgentProtocolError) {
    super(error.message)
    this.name = 'RemoteAgentRpcError'
    this.code = error.code
    this.details = error.details
  }
}

export class RemoteAgentTransportError extends Error {
  readonly code = 'remote_connection_lost'

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'RemoteAgentTransportError'
  }
}

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

interface ActiveStream {
  queue: AsyncValueQueue<unknown>
}

export function createRemoteAgentDaemonClient(
  options: RemoteAgentDaemonClientOptions,
): RemoteAgentDaemonClient {
  return new WsRemoteAgentDaemonClient(options)
}

class WsRemoteAgentDaemonClient implements RemoteAgentDaemonClient {
  private ws: WebSocket | null = null
  private nextRequestId = 1
  private nextStreamId = 1
  private pendingCalls = new Map<string, PendingCall>()
  private activeStreams = new Map<string, ActiveStream>()
  private connectPromise: Promise<HostHelloResult> | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private lastPongAt = 0
  private _state: RemoteHostConnectionState = 'idle'
  private _hello: HostHelloResult | null = null

  constructor(private readonly options: RemoteAgentDaemonClientOptions) {}

  get state(): RemoteHostConnectionState {
    return this._state
  }

  get socketPath(): string {
    return this.options.socketPath
  }

  get hello(): HostHelloResult | null {
    return this._hello
  }

  async connect(params: HostHelloParams = { clientName: 'cradle-server', clientVersion: '0.0.1' }): Promise<HostHelloResult> {
    if (this._state === 'connected' && this._hello) {
      return this._hello
    }
    if (this.connectPromise) {
      return this.connectPromise
    }

    this._state = 'connecting'
    this.connectPromise = this.openSocket()
      .then(async () => {
        this._state = 'connected'
        const hello = await this.call('host/hello', params)
        if (hello.protocolVersion !== REMOTE_AGENT_PROTOCOL_VERSION) {
          throw new RemoteAgentTransportError(`Unsupported daemon protocol version: ${hello.protocolVersion}`)
        }
        this._hello = hello
        return hello
      })
      .catch(async (error) => {
        const transportError = toTransportError(error)
        await this.close()
        this._state = 'offline'
        throw transportError
      })
      .finally(() => {
        this.connectPromise = null
      })
    return this.connectPromise
  }

  async call<M extends RemoteAgentUnaryMethod>(
    method: M,
    params: RemoteAgentParams<M>,
  ): Promise<RemoteAgentResult<M>> {
    this.assertConnected()
    const id = this.allocateRequestId()
    const result = await new Promise<unknown>((resolve, reject) => {
      this.pendingCalls.set(id, { resolve, reject })
      this.sendFrame({
        protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
        kind: 'rpc.request',
        id,
        method,
        params,
      })
    })
    return result as RemoteAgentResult<M>
  }

  async* openStream<M extends RemoteAgentStreamMethod>(
    method: M,
    params: RemoteAgentParams<M>,
  ): AsyncGenerator<RemoteAgentStreamValue<M>, void, void> {
    this.assertConnected()
    const streamId = this.allocateStreamId()
    const queue = new AsyncValueQueue<unknown>()
    this.activeStreams.set(streamId, { queue })
    this.sendFrame({
      protocolVersion: REMOTE_AGENT_PROTOCOL_VERSION,
      kind: 'stream.open',
      streamId,
      method,
      params,
    })

    try {
      while (true) {
        const next = await queue.next()
        if (next.done) {
          return
        }
        yield next.value as RemoteAgentStreamValue<M>
      }
    }
    finally {
      this.activeStreams.delete(streamId)
    }
  }

  async close(): Promise<void> {
    this.stopHeartbeat()
    const ws = this.ws
    this.ws = null
    this._hello = null
    if (this._state !== 'offline') {
      this._state = 'disconnected'
    }
    this.rejectAll(new RemoteAgentTransportError('Remote daemon connection closed.'))
    if (!ws || ws.readyState === WebSocket.CLOSED) {
      return
    }
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 1_000)
      timeout.unref()
      ws.once('close', () => {
        clearTimeout(timeout)
        resolve()
      })
      ws.close()
    })
  }

  private openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket('ws://cradle-agentd.local/', {
        createConnection: () => net.createConnection(this.options.socketPath),
      })
      this.ws = ws

      ws.once('open', () => {
        this.lastPongAt = Date.now()
        this.startHeartbeat()
        resolve()
      })
      ws.once('error', reject)
      ws.on('message', (data: RawData) => this.handleMessage(data))
      ws.on('pong', () => {
        this.lastPongAt = Date.now()
      })
      ws.on('close', () => {
        if (this.ws === ws) {
          this.handleTransportFailure(new RemoteAgentTransportError('Remote daemon WebSocket closed.'))
        }
      })
    })
  }

  private handleMessage(data: RawData): void {
    let frame: RemoteAgentFrame
    try {
      frame = parseRemoteAgentFrame(data.toString())
    }
    catch (error) {
      this.handleTransportFailure(new RemoteAgentTransportError('Remote daemon sent a malformed frame.', { cause: error }))
      return
    }

    switch (frame.kind) {
      case 'rpc.response': {
        const pending = this.pendingCalls.get(frame.id)
        this.pendingCalls.delete(frame.id)
        pending?.resolve(frame.result)
        return
      }
      case 'rpc.error': {
        const pending = this.pendingCalls.get(frame.id)
        this.pendingCalls.delete(frame.id)
        pending?.reject(new RemoteAgentRpcError(frame.error))
        return
      }
      case 'stream.next':
        this.activeStreams.get(frame.streamId)?.queue.push(frame.value)
        return
      case 'stream.error':
        this.activeStreams.get(frame.streamId)?.queue.fail(new RemoteAgentRpcError(frame.error))
        this.activeStreams.delete(frame.streamId)
        return
      case 'stream.close':
        this.activeStreams.get(frame.streamId)?.queue.close()
        this.activeStreams.delete(frame.streamId)
        return
      case 'notification':
        return
      case 'rpc.request':
      case 'stream.open':
        this.handleTransportFailure(new RemoteAgentTransportError(`Unexpected daemon frame kind: ${frame.kind}`))
    }
  }

  private sendFrame(frame: RemoteAgentFrame): void {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new RemoteAgentTransportError('Remote daemon WebSocket is not open.')
    }
    ws.send(encodeRemoteAgentFrame(frame))
  }

  private assertConnected(): void {
    if (this._state !== 'connected' || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new RemoteAgentTransportError(`Remote daemon is not connected; state=${this._state}.`)
    }
  }

  private allocateRequestId(): string {
    return `rpc-${this.nextRequestId++}`
  }

  private allocateStreamId(): string {
    return `stream-${this.nextStreamId++}`
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    const intervalMs = this.options.heartbeatIntervalMs ?? 30_000
    const timeoutMs = this.options.heartbeatTimeoutMs ?? 60_000
    this.heartbeatTimer = setInterval(() => {
      const ws = this.ws
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        return
      }
      if (Date.now() - this.lastPongAt > timeoutMs) {
        this.handleTransportFailure(new RemoteAgentTransportError('Remote daemon heartbeat timed out.'))
        return
      }
      ws.ping()
    }, intervalMs)
    this.heartbeatTimer.unref()
  }

  private stopHeartbeat(): void {
    if (!this.heartbeatTimer) {
      return
    }
    clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }

  private handleTransportFailure(error: RemoteAgentTransportError): void {
    if (this._state === 'offline') {
      return
    }
    this.stopHeartbeat()
    this._state = 'disconnected'
    this._hello = null
    this.rejectAll(error)
    const ws = this.ws
    this.ws = null
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      ws.close()
    }
    this.options.onTransportClose?.(error)
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pendingCalls.values()) {
      pending.reject(error)
    }
    this.pendingCalls.clear()
    for (const stream of this.activeStreams.values()) {
      stream.queue.fail(error)
    }
    this.activeStreams.clear()
  }
}

class AsyncValueQueue<T> {
  private readonly values: T[] = []
  private readonly waiters: Array<{
    resolve: (value: IteratorResult<T, void>) => void
    reject: (error: Error) => void
  }> = []
  private closed = false
  private error: Error | null = null

  next(): Promise<IteratorResult<T, void>> {
    if (this.values.length > 0) {
      return Promise.resolve({ value: this.values.shift() as T, done: false })
    }
    if (this.error) {
      return Promise.reject(this.error)
    }
    if (this.closed) {
      return Promise.resolve({ value: undefined, done: true })
    }
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject })
    })
  }

  push(value: T): void {
    if (this.closed || this.error) {
      return
    }
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter.resolve({ value, done: false })
      return
    }
    this.values.push(value)
  }

  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve({ value: undefined, done: true })
    }
  }

  fail(error: Error): void {
    if (this.error) {
      return
    }
    this.error = error
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(error)
    }
  }
}

function toTransportError(error: unknown): RemoteAgentTransportError {
  if (error instanceof RemoteAgentTransportError) {
    return error
  }
  if (error instanceof Error) {
    return new RemoteAgentTransportError(error.message, { cause: error })
  }
  return new RemoteAgentTransportError(String(error))
}

export function createRemoteAgentProtocolError(code: string, message: string): RemoteAgentRpcError {
  return new RemoteAgentRpcError(createRemoteAgentError(code, message))
}
