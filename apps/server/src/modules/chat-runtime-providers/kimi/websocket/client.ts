import { randomUUID } from 'node:crypto'

import WebSocket from 'ws'

export interface KimiSessionEvent {
  type: string
  seq: number
  timestamp: string
  session_id?: string
  volatile?: boolean
  payload: KimiSessionEventPayload
}

export interface KimiResyncRequiredEvent {
  type: 'resync_required'
  timestamp: string
  payload: { session_id: string, reason: 'buffer_overflow' | 'session_recreated' | 'epoch_changed', current_seq: number, epoch?: string }
}

export interface KimiWebSocketDisconnectedEvent {
  type: 'disconnected'
  error: string
}

export type KimiWebSocketEvent = KimiSessionEvent | KimiResyncRequiredEvent | KimiWebSocketDisconnectedEvent

export type KimiSessionEventPayload
  = | { type: 'assistant.delta', turnId: number, delta: string }
    | { type: 'thinking.delta', turnId: number, delta: string }
    | { type: 'tool.call.delta', turnId: number, toolCallId: string, name?: string, argumentsPart?: string }
    | { type: 'tool.call.started', turnId: number, toolCallId: string, name: string, args: unknown, description?: string }
    | { type: 'tool.result', turnId: number, toolCallId: string, output: unknown, isError?: boolean }
    | { type: 'tool.progress', turnId: number, toolCallId: string, update: { kind: 'stdout' | 'stderr' | 'progress' | 'status' | 'custom', text?: string, percent?: number } }
    | { type: 'turn.ended', turnId: number, reason: 'completed' | 'cancelled' | 'failed' | 'blocked' }
    | {
    type: 'agent.status.updated'
    model?: string
    contextTokens?: number
    maxContextTokens?: number
    planMode?: boolean
    swarmMode?: boolean
    thinkingEffort?: string
    phase?: { kind: 'awaiting_approval' | 'awaiting_question', turnId: number, since: number } | { kind: string }
  }
  | {
    type: 'event.session.status_changed'
    status: 'idle' | 'running' | 'awaiting_approval' | 'awaiting_question' | 'aborted'
    previous_status: 'idle' | 'running' | 'awaiting_approval' | 'awaiting_question' | 'aborted'
    current_prompt_id?: string
  }
  | { type: 'goal.updated', goal?: { objective: string, status: 'active' | 'paused' | 'blocked' | 'complete', tokensUsed: number, budget: { tokenBudget: number | null } } | null }

export interface KimiWebSocketClient {
  subscribe: (sessionId: string, listener: (event: KimiWebSocketEvent) => void) => () => void
  close: () => Promise<void>
}

export async function createKimiWebSocketClient(input: {
  baseUrl: string
  bearerToken: string
}): Promise<KimiWebSocketClient> {
  const MAX_RECONNECT_ATTEMPTS = 3
  const url = new URL('/api/v1/ws', input.baseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const listeners = new Map<string, Set<(event: KimiWebSocketEvent) => void>>()
  let socket: WebSocket | null = null
  let closed = false
  let reconnecting: Promise<void> | null = null

  const send = (frame: object) => {
    if (socket?.readyState === WebSocket.OPEN) { socket.send(JSON.stringify(frame)) }
  }
  const dispatch = (sessionId: string, event: KimiWebSocketEvent) => {
    for (const listener of listeners.get(sessionId) ?? []) { listener(event) }
  }
  const connect = async (): Promise<void> => {
    const nextSocket = new WebSocket(url, { headers: { authorization: `Bearer ${input.bearerToken}` } })
    await new Promise<void>((resolve, reject) => {
      nextSocket.once('open', resolve)
      nextSocket.once('error', reject)
    })
    socket = nextSocket
    send({ type: 'client_hello', id: randomUUID(), payload: { client_id: 'cradle', subscriptions: [...listeners.keys()] } })
    nextSocket.on('message', (raw) => {
    const frame = JSON.parse(raw.toString()) as KimiWireFrame
    if (isKimiPing(frame)) {
      send({ type: 'pong', payload: { nonce: frame.payload.nonce } })
      return
    }
      if (isKimiResyncRequired(frame)) {
        dispatch(frame.payload.session_id, frame)
        return
      }
      if (isKimiSessionEvent(frame)) { dispatch(frame.session_id ?? '', frame) }
    })
    nextSocket.on('close', () => {
      if (!closed && socket === nextSocket) { void reconnect() }
    })
  }
  const reconnect = async (): Promise<void> => {
    if (reconnecting) { return await reconnecting }
    reconnecting = (async () => {
      for (let attempt = 1; attempt <= MAX_RECONNECT_ATTEMPTS; attempt += 1) {
        if (closed) { break }
        try { await connect(); return }
        catch {
          if (attempt < MAX_RECONNECT_ATTEMPTS) { await new Promise(resolve => setTimeout(resolve, 250)) }
        }
      }
      if (!closed) {
        for (const sessionId of listeners.keys()) {
          dispatch(sessionId, { type: 'disconnected', error: 'Kimi WebSocket reconnect failed after 3 attempts.' })
        }
      }
    })().finally(() => { reconnecting = null })
    return await reconnecting
  }
  await connect()

  return {
    subscribe(sessionId, listener) {
      const sessionListeners = listeners.get(sessionId) ?? new Set()
      const firstListener = sessionListeners.size === 0
      sessionListeners.add(listener)
      listeners.set(sessionId, sessionListeners)
      if (firstListener) {
        send({ type: 'subscribe', id: randomUUID(), payload: { session_ids: [sessionId] } })
      }
      return () => {
        sessionListeners.delete(listener)
        if (sessionListeners.size !== 0) { return }
        listeners.delete(sessionId)
        send({ type: 'unsubscribe', id: randomUUID(), payload: { session_ids: [sessionId] } })
      }
    },
    async close() {
      closed = true
      if (!socket || socket.readyState === WebSocket.CLOSED) { return }
      await new Promise<void>((resolve) => {
        socket.once('close', () => resolve())
        socket.close()
      })
    },
  }
}

interface KimiSessionWireFrame {
  type: string
  session_id?: string
  seq?: number
  timestamp?: string
  volatile?: boolean
  payload: KimiSessionEventPayload
}

interface KimiPingWireFrame {
  type: 'ping'
  payload: { nonce: string }
}

interface KimiResyncWireFrame {
  type: 'resync_required'
  timestamp: string
  payload: KimiResyncRequiredEvent['payload']
}

type KimiWireFrame = KimiSessionWireFrame | KimiPingWireFrame | KimiResyncWireFrame

function isKimiResyncRequired(frame: KimiWireFrame): frame is KimiResyncRequiredEvent {
  return frame.type === 'resync_required' && typeof frame.timestamp === 'string'
}

function isKimiSessionEvent(frame: KimiWireFrame): frame is KimiSessionEvent {
  if (!isKimiSessionWireFrame(frame)) { return false }
  return frame.type !== 'ack'
    && frame.type !== 'error'
    && frame.type !== 'server_hello'
    && frame.type !== 'resync_required'
    && typeof frame.seq === 'number'
    && typeof frame.timestamp === 'string'
    && typeof frame.payload === 'object'
    && frame.payload !== null
    && 'type' in frame.payload
}

function isKimiPing(frame: KimiWireFrame): frame is KimiPingWireFrame {
  return frame.type === 'ping' && 'nonce' in frame.payload
}

function isKimiSessionWireFrame(frame: KimiWireFrame): frame is KimiSessionWireFrame {
  return 'seq' in frame && 'timestamp' in frame
}
