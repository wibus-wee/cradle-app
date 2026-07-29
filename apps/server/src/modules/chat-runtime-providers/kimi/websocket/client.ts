import { randomUUID } from 'node:crypto'

import WebSocket from 'ws'

import type { GetApiV1SessionsBySessionIdTranscriptOpsResponses } from '../protocol/rest/types.gen'

type KimiTranscriptOpsData = Extract<
  GetApiV1SessionsBySessionIdTranscriptOpsResponses[200],
  { code: 0 }
>['data']
export type KimiTranscriptOperation = KimiTranscriptOpsData['batches'][number]['ops'][number]
export type KimiTranscriptSnapshot = Extract<KimiTranscriptOperation, { op: 'reset' }>['snapshot']

export interface KimiSessionEvent {
  type: string
  seq: number
  timestamp: string
  session_id?: string
  agent_id?: string
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

export interface KimiTranscriptOpsEvent {
  type: 'transcript.ops'
  timestamp?: string
  payload: {
    agent_id: string
    ops: KimiTranscriptOperation[]
    seq: number
  }
}

export interface KimiTranscriptResetEvent {
  type: 'transcript.reset'
  timestamp?: string
  payload: {
    agent_id: string
    snapshot: KimiTranscriptSnapshot
    has_more_older: boolean
    seq: number
  }
}

export interface KimiTranscriptSubscriptionReadyEvent {
  type: 'transcript.subscription.ready'
  payload: {
    session_id: string
    cursors: Record<string, { seq: number, epoch?: string }>
    resync_required: string[]
  }
}

export type KimiWebSocketEvent
  = | KimiSessionEvent
    | KimiResyncRequiredEvent
    | KimiWebSocketDisconnectedEvent
    | KimiTranscriptOpsEvent
    | KimiTranscriptResetEvent
    | KimiTranscriptSubscriptionReadyEvent

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
    phase?: {
      kind: string
      turnId?: number
      step?: number
      stepId?: string
      delayMs?: number
      errorName?: string
      failedAttempt?: number
      maxAttempts?: number
      nextAttempt?: number
      statusCode?: number
      since?: number
    }
    usage?: {
      currentTurn?: KimiNativeUsage
      total?: KimiNativeUsage
      byModel?: Record<string, KimiNativeUsage>
    }
  }
  | {
    type: 'event.session.status_changed'
    status: 'idle' | 'running' | 'awaiting_approval' | 'awaiting_question' | 'aborted'
    previous_status: 'idle' | 'running' | 'awaiting_approval' | 'awaiting_question' | 'aborted'
    current_prompt_id?: string
  }
  | { type: 'goal.updated', goal?: { objective: string, status: 'active' | 'paused' | 'blocked' | 'complete', tokensUsed: number, budget: { tokenBudget: number | null } } | null }

export interface KimiNativeUsage {
  inputOther: number
  output: number
  inputCacheRead: number
  inputCacheCreation: number
}

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
  const transcriptCursors = new Map<string, Map<string, number>>()
  const subscribeV2SessionsByRequestId = new Map<string, string>()
  let socket: WebSocket | null = null
  let closed = false
  let reconnecting: Promise<void> | null = null

  const send = (frame: object) => {
    if (socket?.readyState === WebSocket.OPEN) { socket.send(JSON.stringify(frame)) }
  }
  const dispatch = (sessionId: string, event: KimiWebSocketEvent) => {
    for (const listener of listeners.get(sessionId) ?? []) { listener(event) }
  }
  const sendTranscriptSubscription = (sessionId: string) => {
    const id = randomUUID()
    subscribeV2SessionsByRequestId.set(id, sessionId)
    const cursors = transcriptCursors.get(sessionId)
    send({
      type: 'subscribe_v2',
      id,
      payload: {
        session_id: sessionId,
        transcript: { '*': 'block' },
        ...(cursors && cursors.size > 0
          ? { transcript_since: Object.fromEntries(cursors) }
          : {}),
      },
    })
  }
  const connect = async (): Promise<void> => {
    const nextSocket = new WebSocket(url, { headers: { authorization: `Bearer ${input.bearerToken}` } })
    await new Promise<void>((resolve, reject) => {
      nextSocket.once('open', resolve)
      nextSocket.once('error', reject)
    })
    socket = nextSocket
    subscribeV2SessionsByRequestId.clear()
    send({ type: 'client_hello', id: randomUUID(), payload: { client_id: 'cradle', subscriptions: [...listeners.keys()] } })
    for (const sessionId of listeners.keys()) {
      sendTranscriptSubscription(sessionId)
    }
    nextSocket.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as KimiWireFrame
      if (isKimiPing(frame)) {
        send({ type: 'pong', payload: { nonce: frame.payload.nonce } })
        return
      }
      if (isKimiAck(frame)) {
        const sessionId = subscribeV2SessionsByRequestId.get(frame.id)
        if (!sessionId) { return }
        subscribeV2SessionsByRequestId.delete(frame.id)
        const cursors = transcriptCursors.get(sessionId) ?? new Map()
        for (const [agentId, cursor] of Object.entries(frame.payload.cursors ?? {})) {
          cursors.set(agentId, cursor.seq)
        }
        transcriptCursors.set(sessionId, cursors)
        dispatch(sessionId, {
          type: 'transcript.subscription.ready',
          payload: {
            session_id: sessionId,
            cursors: frame.payload.cursors ?? {},
            resync_required: frame.payload.resync_required ?? [],
          },
        })
        return
      }
      if (isKimiTranscriptOps(frame) || isKimiTranscriptReset(frame)) {
        const sessionId = frame.session_id
        const cursors = transcriptCursors.get(sessionId) ?? new Map()
        cursors.set(frame.payload.agent_id, frame.payload.seq)
        transcriptCursors.set(sessionId, cursors)
        dispatch(sessionId, frame)
        return
      }
      if (isKimiResyncRequired(frame)) {
        dispatch(frame.payload.session_id, frame)
        return
      }
      if (isKimiSessionWireEvent(frame)) { dispatch(frame.session_id ?? '', frame) }
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
        sendTranscriptSubscription(sessionId)
      }
      return () => {
        sessionListeners.delete(listener)
        if (sessionListeners.size !== 0) { return }
        listeners.delete(sessionId)
        send({ type: 'unsubscribe', id: randomUUID(), payload: { session_ids: [sessionId] } })
        send({ type: 'unsubscribe_v2', id: randomUUID(), payload: { session_id: sessionId } })
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
  agent_id?: string
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

interface KimiAckWireFrame {
  type: 'ack'
  id: string
  code: number
  payload: {
    cursors?: Record<string, { seq: number, epoch?: string }>
    resync_required?: string[]
  }
}

interface KimiTranscriptOpsWireFrame extends KimiTranscriptOpsEvent {
  session_id: string
}

interface KimiTranscriptResetWireFrame extends KimiTranscriptResetEvent {
  session_id: string
}

type KimiWireFrame
  = | KimiSessionWireFrame
    | KimiPingWireFrame
    | KimiResyncWireFrame
    | KimiAckWireFrame
    | KimiTranscriptOpsWireFrame
    | KimiTranscriptResetWireFrame

function isKimiResyncRequired(frame: KimiWireFrame): frame is KimiResyncRequiredEvent {
  return frame.type === 'resync_required' && typeof frame.timestamp === 'string'
}

export function isKimiSessionEvent(frame: KimiWebSocketEvent): frame is KimiSessionEvent {
  return 'seq' in frame
    && typeof frame.seq === 'number'
    && typeof frame.timestamp === 'string'
    && typeof frame.payload === 'object'
    && frame.payload !== null
    && 'type' in frame.payload
}

export function requiresKimiTranscriptHydration(
  event: KimiWebSocketEvent,
  promptId: string,
): boolean {
  if (
    event.type === 'transcript.subscription.ready'
    || event.type === 'resync_required'
    || event.type === 'transcript.reset'
  ) {
    return true
  }
  if (event.type !== 'transcript.ops' || !('ops' in event.payload)) {
    return false
  }
  return event.payload.ops.some((operation) => {
    if (operation.op !== 'prompt.upsert' || operation.prompt.promptId !== promptId) {
      return false
    }
    return operation.prompt.status === 'completed'
      || operation.prompt.status === 'failed'
      || operation.prompt.status === 'aborted'
      || operation.prompt.status === 'blocked'
  })
}

function isKimiSessionWireEvent(frame: KimiWireFrame): frame is KimiSessionEvent {
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

function isKimiAck(frame: KimiWireFrame): frame is KimiAckWireFrame {
  return frame.type === 'ack' && 'id' in frame
}

function isKimiTranscriptOps(frame: KimiWireFrame): frame is KimiTranscriptOpsWireFrame {
  return frame.type === 'transcript.ops'
    && 'session_id' in frame
    && 'agent_id' in frame.payload
    && 'ops' in frame.payload
    && 'seq' in frame.payload
}

function isKimiTranscriptReset(frame: KimiWireFrame): frame is KimiTranscriptResetWireFrame {
  return frame.type === 'transcript.reset'
    && 'session_id' in frame
    && 'agent_id' in frame.payload
    && 'snapshot' in frame.payload
    && 'seq' in frame.payload
}

function isKimiSessionWireFrame(frame: KimiWireFrame): frame is KimiSessionWireFrame {
  return 'seq' in frame && 'timestamp' in frame
}
