import type {
  RunChunkResumeToken,
  SyncClientSubFrame,
  SyncEndReason,
  SyncServerFrame,
} from '@cradle/chat-runtime-contracts'

export type SyncSubscriptionHandler = (frame: SyncServerFrame) => void

interface ActiveSyncSubscriptionBase {
  handler: SyncSubscriptionHandler
  lastSentGeneration: number
}

type ActiveSyncSubscription
  = | ActiveSyncSubscriptionBase & {
    channel: 'sessions-tail'
    frame: Extract<SyncClientSubFrame, { channel: 'sessions-tail' }>
    cursor: number
  }
  | ActiveSyncSubscriptionBase & {
    channel: 'session-tail'
    frame: Extract<SyncClientSubFrame, { channel: 'session-tail' }>
    cursor: number
  }
  | ActiveSyncSubscriptionBase & {
    channel: 'run-chunks'
    frame: Extract<SyncClientSubFrame, { channel: 'run-chunks' }>
    resume: RunChunkResumeToken | undefined
  }
  | ActiveSyncSubscriptionBase & {
    channel: 'workspace-files'
    frame: Extract<SyncClientSubFrame, { channel: 'workspace-files' }>
  }

const PING_INTERVAL_MS = 25_000
const PONG_TIMEOUT_MS = 10_000
const IDLE_CLOSE_MS = 30_000
const RECONNECT_BASE_MS = 500
const RECONNECT_MAX_MS = 30_000

let socket: WebSocket | null = null
let socketGeneration = 0
let connectPromise: Promise<void> | null = null
let pingTimer: ReturnType<typeof setInterval> | null = null
let pongDeadlineTimer: ReturnType<typeof setTimeout> | null = null
let pendingPingTs: number | null = null
let idleCloseTimer: ReturnType<typeof setTimeout> | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectAttempt = 0
const subscriptions = new Map<string, ActiveSyncSubscription>()

export function isSyncSocketSupported(): boolean {
  return typeof WebSocket !== 'undefined'
}

export function getActiveSyncSubscriptionCount(): number {
  return subscriptions.size
}

export function subscribeSyncChannel(
  frame: SyncClientSubFrame,
  handler: SyncSubscriptionHandler,
): () => void {
  const active = createActiveSubscription(frame, handler)
  subscriptions.set(frame.subId, active)
  clearIdleCloseTimer()
  void ensureConnected()
    .then(() => sendSubscriptionForCurrentGeneration(active))
    .catch(() => scheduleReconnect())
  return () => unsubscribeSyncChannel(frame.subId)
}

export function unsubscribeSyncChannel(subId: string): void {
  const active = subscriptions.get(subId)
  if (!active) {
    return
  }
  subscriptions.delete(subId)
  sendClientFrame({ op: 'unsub', subId })
  scheduleIdleClose()
}

export function disposeSyncSocketClient(): void {
  clearHeartbeat()
  clearIdleCloseTimer()
  clearReconnectTimer()
  subscriptions.clear()
  invalidateCurrentSocket()
  connectPromise = null
  reconnectAttempt = 0
}

function createActiveSubscription(
  frame: SyncClientSubFrame,
  handler: SyncSubscriptionHandler,
): ActiveSyncSubscription {
  const base = { handler, lastSentGeneration: -1 }
  switch (frame.channel) {
    case 'sessions-tail':
      return { ...base, channel: frame.channel, frame, cursor: frame.afterSequenceId }
    case 'session-tail':
      return { ...base, channel: frame.channel, frame, cursor: frame.afterVersion }
    case 'run-chunks':
      return { ...base, channel: frame.channel, frame, resume: frame.after }
    case 'workspace-files':
      return { ...base, channel: frame.channel, frame }
  }
}

function buildResubFrame(active: ActiveSyncSubscription): SyncClientSubFrame {
  switch (active.channel) {
    case 'sessions-tail':
      return { ...active.frame, afterSequenceId: active.cursor }
    case 'session-tail':
      return { ...active.frame, afterVersion: active.cursor }
    case 'run-chunks':
      return { ...active.frame, after: active.resume }
    case 'workspace-files':
      return active.frame
  }
}

async function ensureConnected(): Promise<void> {
  if (socket?.readyState === WebSocket.OPEN) {
    return
  }
  if (connectPromise) {
    return connectPromise
  }
  const pending = openSocket()
  connectPromise = pending
  try {
    await pending
  }
  finally {
    if (connectPromise === pending) {
      connectPromise = null
    }
  }
}

async function openSocket(): Promise<void> {
  const { getAuthenticatedServerWebSocketUrl } = await import('~/lib/authenticated-server-url')
  const url = await getAuthenticatedServerWebSocketUrl('/sync')
  const generation = ++socketGeneration
  const currentSocket = new WebSocket(url)
  socket = currentSocket

  await new Promise<void>((resolve, reject) => {
    let opened = false
    currentSocket.addEventListener('open', () => {
      if (!isCurrentSocket(currentSocket, generation)) {
        reject(new Error('Sync socket connection was superseded'))
        return
      }
      opened = true
      reconnectAttempt = 0
      startHeartbeat(currentSocket, generation)
      resubscribeAll(generation)
      resolve()
    }, { once: true })
    currentSocket.addEventListener('error', () => {
      if (!opened) {
        reject(new Error('Sync socket connection failed'))
      }
    }, { once: true })
    currentSocket.addEventListener('message', event => handleSocketMessage(currentSocket, generation, event))
    currentSocket.addEventListener('close', () => {
      if (!opened) {
        reject(new Error('Sync socket closed before opening'))
      }
      handleSocketClose(currentSocket, generation)
    })
  })
}

function resubscribeAll(generation: number): void {
  for (const active of subscriptions.values()) {
    sendSubscription(active, generation)
  }
}

function sendSubscriptionForCurrentGeneration(active: ActiveSyncSubscription): void {
  if (subscriptions.get(active.frame.subId) !== active) {
    return
  }
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return
  }
  sendSubscription(active, socketGeneration)
}

function sendSubscription(active: ActiveSyncSubscription, generation: number): void {
  if (active.lastSentGeneration === generation) {
    return
  }
  if (!sendClientFrame(buildResubFrame(active), generation)) {
    return
  }
  active.lastSentGeneration = generation
}

function handleSocketMessage(
  currentSocket: WebSocket,
  generation: number,
  event: MessageEvent<string>,
): void {
  if (!isCurrentSocket(currentSocket, generation)) {
    return
  }
  let frame: SyncServerFrame
  try {
    frame = JSON.parse(event.data) as SyncServerFrame
  }
  catch {
    return
  }

  if ('op' in frame) {
    if (frame.op === 'pong') {
      acceptPong(frame.ts, currentSocket, generation)
    }
    return
  }
  if (!('subId' in frame)) {
    return
  }

  const active = subscriptions.get(frame.subId)
  if (!active) {
    return
  }
  active.handler(frame)
  if (
    frame.kind === 'end'
    && active.channel === 'run-chunks'
    && (frame.reason === 'backpressure' || frame.reason === 'upstream-closed')
  ) {
    currentSocket.close()
  }
}

function handleSocketClose(currentSocket: WebSocket, generation: number): void {
  if (!isCurrentSocket(currentSocket, generation)) {
    return
  }
  clearHeartbeat()
  socket = null
  scheduleReconnect()
}

function scheduleReconnect(): void {
  if (subscriptions.size === 0 || reconnectTimer) {
    return
  }
  const delay = Math.min(
    RECONNECT_MAX_MS,
    RECONNECT_BASE_MS * 2 ** reconnectAttempt + Math.random() * 200,
  )
  reconnectAttempt += 1
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    void ensureConnected().catch(() => scheduleReconnect())
  }, delay)
}

function sendClientFrame(frame: Parameters<typeof JSON.stringify>[0], generation = socketGeneration): boolean {
  if (!socket || generation !== socketGeneration || socket.readyState !== WebSocket.OPEN) {
    return false
  }
  socket.send(JSON.stringify(frame))
  return true
}

function startHeartbeat(currentSocket: WebSocket, generation: number): void {
  clearHeartbeat()
  sendPing(currentSocket, generation)
  pingTimer = setInterval(sendPing, PING_INTERVAL_MS, currentSocket, generation)
}

function sendPing(currentSocket: WebSocket, generation: number): void {
  if (!isCurrentSocket(currentSocket, generation) || pendingPingTs !== null) {
    return
  }
  const ts = Date.now()
  if (!sendClientFrame({ op: 'ping', ts }, generation)) {
    return
  }
  pendingPingTs = ts
  pongDeadlineTimer = setTimeout(() => {
    if (!isCurrentSocket(currentSocket, generation) || pendingPingTs !== ts) {
      return
    }
    currentSocket.close()
  }, PONG_TIMEOUT_MS)
}

function acceptPong(ts: number, currentSocket: WebSocket, generation: number): void {
  if (!isCurrentSocket(currentSocket, generation) || pendingPingTs !== ts) {
    return
  }
  pendingPingTs = null
  if (pongDeadlineTimer) {
    clearTimeout(pongDeadlineTimer)
    pongDeadlineTimer = null
  }
}

function clearHeartbeat(): void {
  if (pingTimer) {
    clearInterval(pingTimer)
    pingTimer = null
  }
  if (pongDeadlineTimer) {
    clearTimeout(pongDeadlineTimer)
    pongDeadlineTimer = null
  }
  pendingPingTs = null
}

function scheduleIdleClose(): void {
  clearIdleCloseTimer()
  if (subscriptions.size > 0) {
    return
  }
  idleCloseTimer = setTimeout(() => {
    idleCloseTimer = null
    if (subscriptions.size === 0) {
      clearHeartbeat()
      invalidateCurrentSocket()
    }
  }, IDLE_CLOSE_MS)
}

function invalidateCurrentSocket(): void {
  const currentSocket = socket
  socketGeneration += 1
  socket = null
  currentSocket?.close()
}

function isCurrentSocket(currentSocket: WebSocket, generation: number): boolean {
  return socket === currentSocket && socketGeneration === generation
}

function clearIdleCloseTimer(): void {
  if (idleCloseTimer) {
    clearTimeout(idleCloseTimer)
    idleCloseTimer = null
  }
}

function clearReconnectTimer(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

export function updateSyncSubscriptionCursor(subId: string, cursor: number): void {
  const active = subscriptions.get(subId)
  if (!active || active.channel === 'run-chunks' || active.channel === 'workspace-files') {
    return
  }
  active.cursor = Math.max(active.cursor, cursor)
}

export function updateSyncRunSubscriptionCursor(
  subId: string,
  resume: RunChunkResumeToken,
): 'advanced' | 'duplicate' | 'invalid' {
  const active = subscriptions.get(subId)
  if (!active || active.channel !== 'run-chunks') {
    return 'invalid'
  }
  if (!active.resume) {
    active.resume = resume
    return 'advanced'
  }
  if (active.resume.runId !== resume.runId || resume.cursor < active.resume.cursor) {
    return 'invalid'
  }
  if (resume.cursor === active.resume.cursor) {
    return 'duplicate'
  }
  active.resume = resume
  return 'advanced'
}

export function readSyncEndReason(frame: SyncServerFrame): SyncEndReason | null {
  return 'kind' in frame && frame.kind === 'end' ? frame.reason : null
}
