import type { SyncClientFrame, SyncServerFrame } from '@cradle/chat-runtime-contracts'
import type { ElysiaWS } from 'elysia/ws'

import { createBoundedSender } from './buffer'
import {
  attachSyncSubscription,
  readChunkBufferLimits,
  readTailBufferLimits,
} from './channels'
import { isSyncClientSubFrame } from './protocol'

export type SyncLiveSocket = ElysiaWS<any, any>

interface ActiveSubscription {
  unsubscribe: () => void
}

export class SyncConnection {
  private readonly subscriptions = new Map<string, ActiveSubscription>()

  constructor(private readonly ws: SyncLiveSocket) {}

  handleMessage(message: SyncClientFrame): void {
    const frame = message

    if (frame.op === 'ping') {
      this.send({ op: 'pong', ts: frame.ts })
      return
    }

    if (frame.op === 'unsub') {
      this.detach(frame.subId)
      return
    }

    if (!isSyncClientSubFrame(frame)) {
      return
    }

    this.detach(frame.subId)
    const chunkLimits = readChunkBufferLimits()
    const tailLimits = readTailBufferLimits()
    const limits = frame.channel === 'run-chunks' ? chunkLimits : tailLimits

    const sender = createBoundedSender({
      subId: frame.subId,
      sendFrame: dataFrame => this.send(dataFrame),
      onBackpressure: () => {
        this.detach(frame.subId)
        this.send({
          subId: frame.subId,
          kind: 'end',
          reason: 'backpressure',
        })
      },
      maxFrames: limits.maxFrames,
      maxBytes: frame.channel === 'run-chunks' ? chunkLimits.maxBytes : tailLimits.maxFrames * 4096,
    })

    const unsubscribe = attachSyncSubscription(frame, sender)
    this.subscriptions.set(frame.subId, { unsubscribe })
  }

  close(): void {
    for (const subId of [...this.subscriptions.keys()]) {
      this.detach(subId)
    }
  }

  getActiveSubscriptionCount(): number {
    return this.subscriptions.size
  }

  private detach(subId: string): void {
    const active = this.subscriptions.get(subId)
    if (!active) {
      return
    }
    this.subscriptions.delete(subId)
    active.unsubscribe()
  }

  private send(frame: SyncServerFrame): void {
    this.ws.send(frame)
  }
}

const connections = new WeakMap<SyncLiveSocket, SyncConnection>()

export function openSyncSocket(ws: SyncLiveSocket): void {
  connections.set(ws, new SyncConnection(ws))
}

export function handleSyncSocketMessage(ws: SyncLiveSocket, message: SyncClientFrame): void {
  let connection = connections.get(ws)
  if (!connection) {
    connection = new SyncConnection(ws)
    connections.set(ws, connection)
  }
  connection.handleMessage(message)
}

export function closeSyncSocket(ws: SyncLiveSocket): void {
  const connection = connections.get(ws)
  if (!connection) {
    return
  }
  connection.close()
  connections.delete(ws)
}

export function readSyncConnectionStats(): {
  activeConnections: number
  activeSubscriptions: number
} {
  return {
    activeConnections: 0,
    activeSubscriptions: 0,
  }
}
