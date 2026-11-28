import WebSocket from 'ws'

import type { EnvelopePipe, EnvelopePipeHandlers } from './envelope-pipe'
import { closeRelayWebSocket } from './websocket'
import { relayWebSocketDataView } from './websocket-data'

/**
 * EnvelopePipe over a relayd WebSocket — the direct carriage the Node
 * connector and Controller transport have always used. Inbound envelopes keep
 * the `relayWebSocketDataView` zero-copy discipline; teardown uses
 * `closeRelayWebSocket` so an aborting upgrade can never surface as an
 * uncaught error after handlers detach.
 */
export class WebSocketEnvelopePipe implements EnvelopePipe {
  private readonly socket: WebSocket

  constructor(url: string | URL, headers: Record<string, string>, handlers: EnvelopePipeHandlers) {
    this.socket = new WebSocket(url, { headers })
    if (handlers.onOpen) {
      this.socket.once('open', handlers.onOpen)
    }
    if (handlers.onRejected) {
      this.socket.once('unexpected-response', (_request, response) => {
        handlers.onRejected?.({ statusCode: response.statusCode ?? null })
      })
    }
    if (handlers.onMessage) {
      const deliver = handlers.onMessage
      this.socket.on('message', (data) => { deliver(relayWebSocketDataView(data)) })
    }
    if (handlers.onError) {
      this.socket.on('error', handlers.onError)
    }
    if (handlers.onClose) {
      const deliver = handlers.onClose
      this.socket.once('close', (code, reason) => { deliver(code, reason.toString()) })
    }
  }

  get open(): boolean {
    return this.socket.readyState === WebSocket.OPEN
  }

  send(data: Uint8Array): void {
    if (this.open) {
      this.socket.send(data)
    }
  }

  close(code?: number, reason?: string): void {
    if (this.socket.readyState === WebSocket.CLOSED || this.socket.readyState === WebSocket.CLOSING) {
      return
    }
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.close(code, reason)
      return
    }
    // CONNECTING sockets throw synchronously from close(); terminate aborts
    // the upgrade instead, and the close event still reaches the handlers.
    this.socket.terminate()
  }

  teardown(): void {
    closeRelayWebSocket(this.socket)
  }
}
