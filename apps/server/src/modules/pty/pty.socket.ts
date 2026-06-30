import type { ElysiaWS } from 'elysia/ws'

import { AppError } from '../../errors/app-error'
import type { PtyClientEvent, PtyServerEvent } from './protocol'
import type { PtyRuntimeRegistry } from './pty.runtime'
import type { PtyTimelineStore } from './pty.timeline'

export type PtyLiveSocket = ElysiaWS<any, any>

interface OpenSocketOptions {
  channelId: string
  fromSeq?: number
  onClose?: () => void
}

interface SocketAttachment {
  channelId: string
  unsubscribe: () => void
  onClose?: () => void
}

export class PtySocketHub {
  private readonly attachments = new Map<string, SocketAttachment>()

  constructor(
    private readonly runtime: PtyRuntimeRegistry,
    private readonly timeline: PtyTimelineStore,
  ) {}

  open(ws: PtyLiveSocket, options: OpenSocketOptions): void {
    const snapshot = this.timeline.snapshot(options.channelId)
    if (!snapshot) {
      this.sendErrorAndClose(ws, new AppError({
        code: 'terminal_not_found',
        status: 404,
        message: 'Terminal session not found',
        details: { sessionId: options.channelId },
      }))
      return
    }

    const terminalDuringReplay = this.sendInitialState(ws, options.channelId, options.fromSeq)
    if (terminalDuringReplay) {
      return
    }

    const unsubscribe = this.timeline.subscribe(options.channelId, (event) => {
      ws.send(event)
      if (event.type === 'exit') {
        this.detach(ws.id)
        this.closeSoon(ws, 1000, 'terminal exited')
      }
    })

    this.attachments.set(ws.id, {
      channelId: options.channelId,
      unsubscribe,
      onClose: options.onClose,
    })
  }

  handleMessage(ws: PtyLiveSocket, event: PtyClientEvent): void {
    const attachment = this.attachments.get(ws.id)
    if (!attachment) {
      this.sendErrorAndClose(ws, new AppError({
        code: 'terminal_socket_not_attached',
        status: 409,
        message: 'Terminal live channel is not attached',
      }))
      return
    }

    switch (event.type) {
      case 'input':
        if (!this.runtime.write(attachment.channelId, event.data)) {
          this.sendError(ws, {
            type: 'error',
            code: 'terminal_not_running',
            message: 'Terminal session is not running',
          })
        }
        return
      case 'resize':
        if (!this.runtime.resize(attachment.channelId, event.cols, event.rows)) {
          this.sendError(ws, {
            type: 'error',
            code: 'terminal_not_running',
            message: 'Terminal session is not running',
          })
        }
        return
      case 'ping':
        ws.send({ type: 'pong' })
    }
  }

  close(ws: PtyLiveSocket): void {
    const attachment = this.detach(ws.id)
    attachment?.onClose?.()
  }

  clear(): void {
    for (const attachment of this.attachments.values()) {
      attachment.unsubscribe()
    }
    this.attachments.clear()
  }

  reject(ws: PtyLiveSocket, error: unknown): void {
    this.sendErrorAndClose(ws, error)
  }

  private sendInitialState(ws: PtyLiveSocket, channelId: string, fromSeq?: number): boolean {
    if (fromSeq !== undefined) {
      const replay = this.timeline.since(channelId, fromSeq)
      if (replay?.ok) {
        for (const event of replay.events) {
          ws.send(event)
        }
        if (replay.events.some(event => event.type === 'exit')) {
          this.closeSoon(ws, 1000, 'terminal exited')
          return true
        }

        if (!this.timeline.isRunning(channelId) && replay.events.length === 0) {
          this.sendSnapshotAndTerminalExit(ws, channelId)
          return true
        }

        return false
      }
    }

    this.sendSnapshotAndMaybeExit(ws, channelId)
    return !this.timeline.isRunning(channelId)
  }

  private sendSnapshotAndMaybeExit(ws: PtyLiveSocket, channelId: string): void {
    const snapshot = this.timeline.snapshot(channelId)
    if (!snapshot) {
      return
    }

    ws.send(snapshot)
    if (!snapshot.running) {
      const exitEvent = this.timeline.latestExitEvent(channelId)
      if (exitEvent) {
        ws.send(exitEvent)
      }
      this.closeSoon(ws, 1000, 'terminal exited')
    }
  }

  private sendSnapshotAndTerminalExit(ws: PtyLiveSocket, channelId: string): void {
    this.sendSnapshotAndMaybeExit(ws, channelId)
  }

  private detach(socketId: string): SocketAttachment | undefined {
    const attachment = this.attachments.get(socketId)
    if (!attachment) {
      return undefined
    }

    attachment.unsubscribe()
    this.attachments.delete(socketId)
    return attachment
  }

  private sendErrorAndClose(ws: PtyLiveSocket, error: unknown): void {
    if (error instanceof AppError) {
      this.sendError(ws, {
        type: 'error',
        code: error.code,
        message: error.message,
      })
      this.closeSoon(ws, 1011, error.message)
      return
    }

    this.sendError(ws, {
      type: 'error',
      code: 'terminal_socket_error',
      message: 'Terminal live channel failed',
    })
    this.closeSoon(ws, 1011, 'terminal live channel failed')
  }

  private sendError(ws: PtyLiveSocket, event: Extract<PtyServerEvent, { type: 'error' }>): void {
    ws.send(event)
  }

  private closeSoon(ws: PtyLiveSocket, code: number, reason: string): void {
    setTimeout(() => {
      try {
        ws.close(code, reason)
      }
      catch {
        // best-effort close; connection may already be gone
      }
    }, 0)
  }
}
