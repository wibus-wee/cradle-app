import { z } from 'zod'

import { getI18n } from '~/i18n/instance'
import { getServerWebSocketUrl } from '~/lib/electron'

import type { PtyClientEvent, PtyErrorEvent, PtyExitEvent, PtyOutputEvent, PtySnapshotEvent } from './pty-protocol'
import { PtyServerEventJsonSchema } from './pty-protocol'

interface PtyChannelOptions {
  socketPath: string
  fromSeq?: number
  reconnect?: boolean
  reconnectDelayMs?: number
  pingIntervalMs?: number
  onSnapshot: (event: PtySnapshotEvent) => void
  onOutput: (event: PtyOutputEvent) => void
  onExit: (event: PtyExitEvent) => void
  onError?: (event: PtyErrorEvent) => void
  onOpen?: () => void
  onClose?: () => void
}

export interface PtyChannel {
  connect: () => void
  sendInput: (data: string) => void
  sendResize: (cols: number, rows: number) => void
  ping: () => void
  close: () => void
  getLastSeq: () => number | null
}

const DEFAULT_RECONNECT_DELAY_MS = 750
const DEFAULT_PING_INTERVAL_MS = 15_000
const PtyChannelOptionsSchema = z.object({
  socketPath: z.string(),
  fromSeq: z.number().nullable().optional().default(null),
  reconnect: z.boolean().default(true),
  reconnectDelayMs: z.number().finite().nonnegative().default(DEFAULT_RECONNECT_DELAY_MS),
  pingIntervalMs: z.number().finite().nonnegative().default(DEFAULT_PING_INTERVAL_MS),
  onSnapshot: z.custom<PtyChannelOptions['onSnapshot']>(),
  onOutput: z.custom<PtyChannelOptions['onOutput']>(),
  onExit: z.custom<PtyChannelOptions['onExit']>(),
  onError: z.custom<PtyChannelOptions['onError']>().optional(),
  onOpen: z.custom<PtyChannelOptions['onOpen']>().optional(),
  onClose: z.custom<PtyChannelOptions['onClose']>().optional(),
})
const WebSocketMessageSchema = z.object({
  data: z.string(),
}).passthrough()

export function createPtyChannel(rawOptions: PtyChannelOptions): PtyChannel {
  const options = PtyChannelOptionsSchema.parse(rawOptions)
  let socket: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let pingTimer: ReturnType<typeof setInterval> | null = null
  let closedManually = false
  let exitSeen = false
  let lastSeq = options.fromSeq
  const pendingMessages: PtyClientEvent[] = []

  function clearReconnectTimer() {
    if (!reconnectTimer) {
      return
    }
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  function stopPingLoop() {
    if (!pingTimer) {
      return
    }
    clearInterval(pingTimer)
    pingTimer = null
  }

  function startPingLoop() {
    stopPingLoop()
    pingTimer = setInterval(() => {
      send({ type: 'ping' }, false)
    }, options.pingIntervalMs)
  }

  function flushPendingMessages() {
    if (!socket || socket.readyState !== WebSocket.OPEN || pendingMessages.length === 0) {
      return
    }

    const queued = pendingMessages.splice(0, pendingMessages.length)
    for (const message of queued) {
      socket.send(JSON.stringify(message))
    }
  }

  function send(message: PtyClientEvent, allowQueue = true) {
    if (socket?.readyState === WebSocket.OPEN) {
      const encoded = JSON.stringify(message)
      // Escape "ping" in serialized payload so @elysiajs/node doesn't
      // falsely match the substring and crash on ws.pong().
      socket.send(message.type === 'ping' ? encoded.replace('"ping"', '"p\\u0069ng"') : encoded)
      return
    }

    if (allowQueue && !closedManually) {
      pendingMessages.push(message)
    }
  }

  function emitError(code: string, message: string) {
    options.onError?.({ type: 'error', code, message })
  }

  function scheduleReconnect() {
    if (!options.reconnect || closedManually || exitSeen || reconnectTimer) {
      return
    }

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, options.reconnectDelayMs)
  }

  function handleMessage(raw: string) {
    const event = (() => {
      try {
        return PtyServerEventJsonSchema.parse(raw)
      }
 catch {
        return null
      }
    })()
    if (!event) {
      emitError('INVALID_SERVER_EVENT', 'Received malformed terminal event.')
      return
    }

    switch (event.type) {
      case 'snapshot':
        lastSeq = event.seq
        options.onSnapshot(event)
        return
      case 'output':
        lastSeq = event.seq
        options.onOutput(event)
        return
      case 'exit':
        exitSeen = true
        lastSeq = event.seq
        options.onExit(event)
        return
      case 'pong':
        return
      case 'error':
        options.onError?.(event)
    }
  }

  function connect() {
    if (closedManually) {
      return
    }

    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return
    }

    const url = getServerWebSocketUrl(options.socketPath, lastSeq === null ? undefined : { fromSeq: lastSeq })
    socket = new WebSocket(url)

    socket.addEventListener('open', () => {
      clearReconnectTimer()
      startPingLoop()
      flushPendingMessages()
      options.onOpen?.()
    })

    socket.addEventListener('message', (event) => {
      const message = WebSocketMessageSchema.safeParse(event)
      if (!message.success) {
        emitError('INVALID_SERVER_EVENT', 'Received malformed terminal socket message.')
        return
      }
      handleMessage(message.data.data)
    })

    socket.addEventListener('error', () => {
      emitError('SOCKET_ERROR', getI18n().t('common:pty.socketConnectionError'))
    })

    socket.addEventListener('close', () => {
      stopPingLoop()
      socket = null
      options.onClose?.()
      scheduleReconnect()
    })
  }

  return {
    connect,
    sendInput(data) {
      send({ type: 'input', data })
    },
    sendResize(cols, rows) {
      send({ type: 'resize', cols, rows })
    },
    ping() {
      send({ type: 'ping' }, false)
    },
    close() {
      closedManually = true
      clearReconnectTimer()
      stopPingLoop()
      pendingMessages.length = 0
      socket?.close()
      socket = null
    },
    getLastSeq() {
      return lastSeq
    },
  }
}
