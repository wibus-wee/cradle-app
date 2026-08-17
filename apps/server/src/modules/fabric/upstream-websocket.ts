import WebSocket from 'ws'

const MAX_PENDING_CLIENT_BYTES = 1024 * 1024

export interface UpstreamBridgeSocket {
  send: (data: string | ArrayBuffer | ArrayBufferView) => number
  close: (code?: number, reason?: string) => void
}

interface PendingClientMessage {
  data: string | Uint8Array
  bytes: number
}

export function buildUpstreamWebSocketUrl(
  baseUrl: string,
  upstreamPathWithQuery: string,
): URL {
  const url = new URL(
    upstreamPathWithQuery.replace(/^\//, ''),
    `${baseUrl.replace(/\/+$/, '')}/`,
  )
  url.searchParams.delete('ticket')
  if (url.protocol === 'http:') {
    url.protocol = 'ws:'
  }
  else if (url.protocol === 'https:') {
    url.protocol = 'wss:'
  }
  return url
}

/**
 * Bridges a local `/nodes/:nodeId/upstream/*` WebSocket to the Cradle Server
 * running on a Fabric Node. The link is resolved on demand through the Fabric
 * node link manager; frames flow in both directions, local frames received
 * before the upstream socket opens are buffered, and close/error events
 * propagate to the peer with a mapped code.
 */
export class FabricUpstreamWebSocketBridge {
  private upstream: WebSocket | null = null
  private pendingClientMessages: PendingClientMessage[] = []
  private pendingClientBytes = 0
  private closed = false

  constructor(
    private readonly local: UpstreamBridgeSocket,
    private readonly resolveBaseUrl: () => Promise<string>,
    private readonly upstreamPathWithQuery: string,
  ) {}

  async open(): Promise<void> {
    try {
      const baseUrl = await this.resolveBaseUrl()
      if (this.closed) {
        return
      }
      const upstream = new WebSocket(
        buildUpstreamWebSocketUrl(baseUrl, this.upstreamPathWithQuery),
        { perMessageDeflate: false },
      )
      this.upstream = upstream
      upstream.binaryType = 'arraybuffer'
      upstream.once('open', () => this.flushPendingClientMessages())
      upstream.on('message', (data, isBinary) => {
        const message = isBinary ? websocketBinaryView(data) : data.toString()
        const status = this.local.send(message)
        if (status < 0) {
          upstream.pause()
        }
      })
      upstream.once('close', (code, reason) => {
        this.closed = true
        this.local.close(closeCodeForPeer(code), reason.toString().slice(0, 123))
      })
      upstream.once('error', () => {
        this.close(1011, 'Node WebSocket connection failed')
      })
    }
    catch {
      this.close(1011, 'Node WebSocket connection failed')
    }
  }

  send(data: unknown): void {
    if (this.closed) {
      return
    }
    const message = normalizeClientMessage(data)
    const upstream = this.upstream
    if (upstream?.readyState === WebSocket.OPEN) {
      upstream.send(message.data, { binary: typeof message.data !== 'string' })
      if (upstream.bufferedAmount > MAX_PENDING_CLIENT_BYTES) {
        this.close(1013, 'Node WebSocket is congested')
      }
      return
    }

    this.pendingClientMessages.push(message)
    this.pendingClientBytes += message.bytes
    if (this.pendingClientBytes > MAX_PENDING_CLIENT_BYTES) {
      this.close(1013, 'Node WebSocket is congested')
    }
  }

  drain(): void {
    this.upstream?.resume()
  }

  close(code = 1000, reason = 'Client closed'): void {
    if (this.closed) {
      return
    }
    this.closed = true
    this.pendingClientMessages = []
    this.pendingClientBytes = 0
    const upstream = this.upstream
    this.upstream = null
    if (upstream?.readyState === WebSocket.OPEN) {
      upstream.close(closeCodeForPeer(code), reason.slice(0, 123))
    }
    else {
      upstream?.terminate()
    }
    this.local.close(code, reason.slice(0, 123))
  }

  private flushPendingClientMessages(): void {
    const upstream = this.upstream
    if (!upstream || upstream.readyState !== WebSocket.OPEN || this.closed) {
      return
    }
    for (const message of this.pendingClientMessages) {
      upstream.send(message.data, { binary: typeof message.data !== 'string' })
    }
    this.pendingClientMessages = []
    this.pendingClientBytes = 0
    if (upstream.bufferedAmount > MAX_PENDING_CLIENT_BYTES) {
      this.close(1013, 'Node WebSocket is congested')
    }
  }
}

function closeCodeForPeer(code: number): number {
  if (code === 1005) {
    return 1000
  }
  if (
    (code >= 1000 && code <= 1014 && ![1004, 1005, 1006].includes(code))
    || (code >= 3000 && code <= 4999)
  ) {
    return code
  }
  return 1011
}

function normalizeClientMessage(data: unknown): PendingClientMessage {
  if (typeof data === 'string') {
    return { data, bytes: Buffer.byteLength(data) }
  }
  if (data instanceof ArrayBuffer) {
    return { data: new Uint8Array(data), bytes: data.byteLength }
  }
  if (ArrayBuffer.isView(data)) {
    const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    return { data: view, bytes: view.byteLength }
  }
  const text = JSON.stringify(data)
  return { data: text, bytes: Buffer.byteLength(text) }
}

function websocketBinaryView(data: WebSocket.RawData): Uint8Array {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data)
  }
  if (Array.isArray(data)) {
    const combined = Buffer.concat(data)
    return new Uint8Array(combined.buffer, combined.byteOffset, combined.byteLength)
  }
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}
