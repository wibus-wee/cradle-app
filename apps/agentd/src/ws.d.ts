declare module 'ws' {
  import type { Server } from 'node:http'

  export class WebSocket {
    static readonly OPEN: number
    readonly readyState: number
    send(data: string | Buffer): void
    close(code?: number, reason?: string): void
    on(event: 'message', listener: (data: Buffer | string) => void): this
    on(event: 'close', listener: (code: number, reason: Buffer) => void): this
    on(event: 'error', listener: (error: Error) => void): this
  }

  export class WebSocketServer {
    constructor(options: { server: Server })
    on(event: 'connection', listener: (socket: WebSocket) => void): this
    close(callback?: (error?: Error) => void): void
  }
}
