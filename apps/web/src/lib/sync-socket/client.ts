import type {
  SyncClientSubFrame,
  SyncEndReason,
  SyncServerFrame,
} from '@cradle/chat-runtime-contracts'

export type SyncSubscriptionHandler = (frame: SyncServerFrame) => void

interface ActiveSyncSubscription {
  frame: SyncClientSubFrame
  handler: SyncSubscriptionHandler
  cursor: number
  ended: boolean
}

const PING_INTERVAL_MS = 25_000
const IDLE_CLOSE_MS = 30_000
const RECONNECT_BASE_MS = 500
const RECONNECT_MAX_MS = 30_000

let socket: WebSocket | null = null
let connectPromise: Promise<void> | null = null
let pingTimer: ReturnType<typeof setInterval> | null = null
let idleCloseTimer: ReturnType<typeof setTimeout> | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectAttempt = 0
let intentionalClose = false
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
  const active: ActiveSyncSubscription = {
    frame,
    handler,
    cursor: readInitialCursor(frame),
    ended: false,
  }
  subscriptions.set(frame.subId, active)
  clearIdleCloseTimer()
  void ensureConnected().then(() => {
    if (subscriptions.get(frame.subId) === active && !active.ended) {
      sendClientFrame(buildResubFrame(active))
    }
  })
  return () => {
    unsubscribeSyncChannel(frame.subId)
  }
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
  intentionalClose = true
  clearPingTimer()
  clearIdleCloseTimer()
  clearReconnectTimer()
  subscriptions.clear()
  if (socket) {
    socket.close()
    socket = null
  }
  connectPromise = null
  reconnectAttempt = 0
  intentionalClose = false
}

function readInitialCursor(frame: SyncClientSubFrame): number {
  switch (frame.channel) {
    case 'sessions-tail':
      return frame.afterSequenceId
    case 'session-tail':
      return frame.afterVersion
    case 'run-chunks':
      return frame.afterChunkSeq ?? -1
    case 'workspace-files':
      return 0
    default:
      return 0
  }
}

function buildResubFrame(active: ActiveSyncSubscription): SyncClientSubFrame {
  const { frame, cursor } = active
  switch (frame.channel) {
    case 'sessions-tail':
      return { ...frame, afterSequenceId: cursor }
    case 'session-tail':
      return { ...frame, afterVersion: cursor }
    case 'run-chunks':
      return { ...frame, afterChunkSeq: cursor }
    case 'workspace-files':
      return frame
    default:
      return frame
  }
}

async function ensureConnected(): Promise<void> {
  if (socket?.readyState === WebSocket.OPEN) {
    return
  }
  if (connectPromise) {
    return connectPromise
  }
  connectPromise = openSocket().finally(() => {
    connectPromise = null
  })
  return connectPromise
}

async function openSocket(): Promise<void> {
  const { getAuthenticatedServerWebSocketUrl } = await import('~/lib/electron')
  const url = await getAuthenticatedServerWebSocketUrl('/sync')
  intentionalClose = false
  socket = new WebSocket(url)

  await new Promise<void>((resolve, reject) => {
    if (!socket) {
      reject(new Error('Sync socket failed to initialize'))
      return
    }
    const currentSocket = socket
    currentSocket.addEventListener('open', () => {
      reconnectAttempt = 0
      startPingTimer()
      resubscribeAll()
      resolve()
    }, { once: true })
    currentSocket.addEventListener('error', () => {
      reject(new Error('Sync socket connection failed'))
    }, { once: true })
    currentSocket.addEventListener('message', handleSocketMessage)
    currentSocket.addEventListener('close', handleSocketClose)
  })
}

function resubscribeAll(): void {
  for (const active of subscriptions.values()) {
    if (active.ended) {
      continue
    }
    sendClientFrame(buildResubFrame(active))
  }
}

function handleSocketMessage(event: MessageEvent<string>): void {
  let frame: SyncServerFrame
  try {
    frame = JSON.parse(event.data) as SyncServerFrame
  }
  catch {
    return
  }

  if ('op' in frame) {
    return
  }

  if (!('subId' in frame)) {
    return
  }

  const active = subscriptions.get(frame.subId)
  if (!active || active.ended) {
    return
  }

  if (frame.kind === 'sub-ack') {
    active.cursor = frame.cursor
  }

  if (frame.kind === 'end') {
    active.ended = true
  }

  active.handler(frame)
}

function handleSocketClose(): void {
  clearPingTimer()
  socket = null
  if (intentionalClose) {
    return
  }
  scheduleReconnect()
}

function scheduleReconnect(): void {
  if (subscriptions.size === 0) {
    return
  }
  clearReconnectTimer()
  const delay = Math.min(
    RECONNECT_MAX_MS,
    RECONNECT_BASE_MS * 2 ** reconnectAttempt + Math.random() * 200,
  )
  reconnectAttempt += 1
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    void ensureConnected().catch(() => {
      scheduleReconnect()
    })
  }, delay)
}

function sendClientFrame(frame: Parameters<typeof JSON.stringify>[0]): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return
  }
  socket.send(JSON.stringify(frame))
}

function startPingTimer(): void {
  clearPingTimer()
  pingTimer = setInterval(() => {
    sendClientFrame({ op: 'ping', ts: Date.now() })
  }, PING_INTERVAL_MS)
}

function clearPingTimer(): void {
  if (!pingTimer) {
    return
  }
  clearInterval(pingTimer)
  pingTimer = null
}

function scheduleIdleClose(): void {
  clearIdleCloseTimer()
  if (subscriptions.size > 0) {
    return
  }
  idleCloseTimer = setTimeout(() => {
    idleCloseTimer = null
    if (subscriptions.size > 0) {
      return
    }
    intentionalClose = true
    socket?.close()
    socket = null
    clearPingTimer()
    intentionalClose = false
  }, IDLE_CLOSE_MS)
}

function clearIdleCloseTimer(): void {
  if (!idleCloseTimer) {
    return
  }
  clearTimeout(idleCloseTimer)
  idleCloseTimer = null
}

function clearReconnectTimer(): void {
  if (!reconnectTimer) {
    return
  }
  clearTimeout(reconnectTimer)
  reconnectTimer = null
}

export function updateSyncSubscriptionCursor(subId: string, cursor: number): void {
  const active = subscriptions.get(subId)
  if (!active) {
    return
  }
  active.cursor = cursor
}

export function readSyncEndReason(frame: SyncServerFrame): SyncEndReason | null {
  if (!('kind' in frame) || frame.kind !== 'end') {
    return null
  }
  return frame.reason
}
