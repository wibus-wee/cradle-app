import {
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
import {
  encodeRelayEnvelope,
  parseRelayEnvelope,
  type RelayEnvelope,
} from '@cradle/remote-relay-protocol'
import WebSocket from 'ws'
import type { RawData } from 'ws'

import {
  RemoteAgentRpcError,
  RemoteAgentTransportError,
  type RemoteAgentDaemonClient,
  type RemoteHostConnectionState,
} from './daemon-client'

export interface RelayRemoteAgentDaemonClientOptions {
  relayUrl: string
  roomId: string
  controllerToken: string
  heartbeatIntervalMs?: number
  heartbeatTimeoutMs?: number
  onTransportClose?: (error: RemoteAgentTransportError) => void
}

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

interface ActiveStream {
  queue: AsyncValueQueue<unknown>
}

export function createRelayRemoteAgentDaemonClient(
  options: RelayRemoteAgentDaemonClientOptions,
): RemoteAgentDaemonClient {
  return new RelayRemoteAgentDaemonClient(options)
}

class RelayRemoteAgentDaemonClient implements RemoteAgentDaemonClient {
  private ws: WebSocket | null = null
  private nextRequestId = 1
  private nextStreamId = 1
  private nextRelaySeq = 1
  private pendingCalls = new Map<string, PendingCall>()
  private activeStreams = new Map<string, ActiveStream>()
  private connectPromise: Promise<HostHelloResult> | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private lastPongAt = 0
  private _state: RemoteHostConnectionState = 'idle'
  private _hello: HostHelloResult | null = null

  constructor(private readonly options: RelayRemoteAgentDaemonClientOptions) {}

  get state(): RemoteHostConnectionState {
    return this._state
  }

  get socketPath(): string {
    return ''
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
    this.rejectAll(new RemoteAgentTransportError('Remote relay connection closed.'))
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
      const ws = new WebSocket(joinWebSocketURL(this.options.relayUrl, '/ws/controller'), {
        headers: {
          Authorization: `Bearer ${this.options.controllerToken}`,
        },
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
          this.handleTransportFailure(new RemoteAgentTransportError('Remote relay WebSocket closed.'))
        }
      })
    })
  }

  private handleMessage(data: RawData): void {
    let envelope: RelayEnvelope
    try {
      envelope = parseRelayEnvelope(data.toString())
    }
    catch (error) {
      this.handleTransportFailure(new RemoteAgentTransportError('Remote relay sent a malformed envelope.', { cause: error }))
      return
    }
    if (envelope.kind !== 'remote_agent_frame') {
      this.handleTransportFailure(new RemoteAgentTransportError(`Remote relay sent ${envelope.kind}.`))
      return
    }

    let frame: RemoteAgentFrame
    try {
      frame = parseRemoteAgentFrame(envelope.payload)
    }
    catch (error) {
      this.handleTransportFailure(new RemoteAgentTransportError('Remote relay sent a malformed daemon frame.', { cause: error }))
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
      throw new RemoteAgentTransportError('Remote relay WebSocket is not open.')
    }
    const streamId = streamIdForFrame(frame)
    const envelope: RelayEnvelope = {
      version: 1,
      roomId: this.options.roomId,
      seq: this.nextRelaySeq++,
      kind: 'remote_agent_frame',
      ...(streamId ? { streamId } : {}),
      payload: JSON.parse(encodeRemoteAgentFrame(frame)),
    }
    ws.send(encodeRelayEnvelope(envelope))
  }

  private assertConnected(): void {
    if (this._state !== 'connected' || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new RemoteAgentTransportError(`Remote relay is not connected; state=${this._state}.`)
    }
  }

  private allocateRequestId(): string {
    return `relay-rpc-${this.nextRequestId++}`
  }

  private allocateStreamId(): string {
    return `relay-stream-${this.nextStreamId++}`
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
        this.handleTransportFailure(new RemoteAgentTransportError('Remote relay heartbeat timed out.'))
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

function streamIdForFrame(frame: RemoteAgentFrame): string | null {
  switch (frame.kind) {
    case 'stream.open':
    case 'stream.next':
    case 'stream.error':
    case 'stream.close':
      return frame.streamId
    default:
      return null
  }
}

function joinWebSocketURL(base: string, path: string): string {
  const url = new URL(path, ensureTrailingSlash(base))
  if (url.protocol === 'http:') {
    url.protocol = 'ws:'
  }
  else if (url.protocol === 'https:') {
    url.protocol = 'wss:'
  }
  return url.toString()
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
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
