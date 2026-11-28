import net from 'node:net'

import type { EnvelopePipe, EnvelopePipeHandlers } from './envelope-pipe'

/**
 * Maximum frame size of the fabric-agent IPC contract: 1 MiB, matching the
 * relayd frame cap. A peer announcing a larger frame breaks the contract, so
 * the connection closes.
 */
export const FABRIC_IPC_MAX_FRAME_BYTES = 1 << 20

const LENGTH_PREFIX_BYTES = 4

export class FabricIpcProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FabricIpcProtocolError'
  }
}

/**
 * Incremental decoder for the fabric-agent IPC framing: a 4-byte big-endian
 * length prefix followed by one complete Fabric v3 envelope.
 *
 * Zero-copy discipline: when one pushed chunk already contains a complete
 * frame, the frame is emitted as a `subarray` view over that chunk without
 * copying — matching the `relayWebSocketDataView` interlock of the WebSocket
 * carriage. Only fragmentation forces copies, exactly one per fragmented
 * frame: prefix bytes are copied into a small contiguous header when they
 * straddle chunk boundaries, and a fragmented payload is concatenated once.
 */
export class FabricIpcFrameParser {
  private pending: Buffer[] = []
  private pendingBytes = 0

  /** Append one TCP chunk and return every complete frame now available. */
  push(chunk: Buffer): Uint8Array[] {
    this.pending.push(chunk)
    this.pendingBytes += chunk.byteLength
    const frames: Uint8Array[] = []
    for (;;) {
      if (this.pendingBytes < LENGTH_PREFIX_BYTES) {
        return frames
      }
      const length = this.peekLength()
      if (length > FABRIC_IPC_MAX_FRAME_BYTES) {
        throw new FabricIpcProtocolError(`Fabric agent IPC frame announces ${length} bytes, above the 1 MiB cap.`)
      }
      if (this.pendingBytes < LENGTH_PREFIX_BYTES + length) {
        return frames
      }
      frames.push(this.takeFrame(length))
    }
  }

  /** Length of the next frame; valid only when at least 4 bytes are pending. */
  private peekLength(): number {
    const first = this.pending[0]!
    if (first.byteLength >= LENGTH_PREFIX_BYTES) {
      return first.readUInt32BE(0)
    }
    const prefix = Buffer.allocUnsafe(LENGTH_PREFIX_BYTES)
    let needed = LENGTH_PREFIX_BYTES
    for (const chunk of this.pending) {
      chunk.copy(prefix, LENGTH_PREFIX_BYTES - needed, 0, Math.min(needed, chunk.byteLength))
      needed -= Math.min(needed, chunk.byteLength)
      if (needed === 0) {
        break
      }
    }
    return prefix.readUInt32BE(0)
  }

  private takeFrame(length: number): Uint8Array {
    const first = this.pending[0]!
    if (first.byteLength >= LENGTH_PREFIX_BYTES + length) {
      // Fast path: one contiguous frame inside one chunk — emit a zero-copy
      // view over the original socket memory.
      const frame = new Uint8Array(first.buffer, first.byteOffset + LENGTH_PREFIX_BYTES, length)
      if (first.byteLength === LENGTH_PREFIX_BYTES + length) {
        this.pending.shift()
      }
 else {
        this.pending[0] = first.subarray(LENGTH_PREFIX_BYTES + length)
      }
      this.pendingBytes -= LENGTH_PREFIX_BYTES + length
      return frame
    }
    // Fragmented frame: copy the region once into contiguous memory, then
    // emit a view that skips the prefix.
    const region = Buffer.allocUnsafe(LENGTH_PREFIX_BYTES + length)
    let copied = 0
    let remaining = LENGTH_PREFIX_BYTES + length
    while (remaining > 0) {
      const chunk = this.pending[0]!
      const take = Math.min(remaining, chunk.byteLength)
      chunk.copy(region, copied, 0, take)
      copied += take
      remaining -= take
      if (take === chunk.byteLength) {
        this.pending.shift()
      }
 else {
        this.pending[0] = chunk.subarray(take)
      }
    }
    this.pendingBytes -= LENGTH_PREFIX_BYTES + length
    return new Uint8Array(region.buffer, region.byteOffset + LENGTH_PREFIX_BYTES, length)
  }
}

/** Fields of the fabric-agent IPC authentication frame. */
export interface FabricIpcAuthFrame {
  version: 1
  token: string
  role: 'node' | 'controller'
  relayUrl: string
  fabricId: string
  nodeId: string
  linkId?: string
  headers: Record<string, string>
}

export function encodeFabricIpcFrame(payload: Buffer): Buffer {
  const frame = Buffer.allocUnsafe(LENGTH_PREFIX_BYTES + payload.byteLength)
  frame.writeUInt32BE(payload.byteLength, 0)
  payload.copy(frame, LENGTH_PREFIX_BYTES)
  return frame
}

/**
 * EnvelopePipe over the fabric-agent loopback IPC contract
 * (`apps/relayd/protocol/README.md`, "Fabric agent IPC").
 *
 * Construction connects to the agent's loopback TCP port. The length-prefixed
 * JSON auth frame is written immediately when TCP connects — the token is
 * supplied by the caller, which reads it from the token file recorded in the
 * agent locator; it never travels on a command line. `onOpen` fires as soon
 * as the auth frame is accepted by the kernel. The contract has no positive
 * auth acknowledgement: a wrong token is an immediate close without reply,
 * indistinguishable by design from any other pre-traffic close, and consumers
 * treat it as a retryable setup failure.
 *
 * The pipe is byte-transparent: it never inspects payloads beyond carriage,
 * enforces the 1 MiB frame cap inbound (an oversize announcement closes the
 * connection as contract-breach), and performs no reconnect, resume, or
 * replay — when the agent's upstream dies it closes this connection and the
 * link dies exactly as a relayd WebSocket death does.
 */
export class IpcEnvelopePipe implements EnvelopePipe {
  private readonly socket: net.Socket
  private readonly parser = new FabricIpcFrameParser()
  private readonly handlers: EnvelopePipeHandlers
  private connecting = true
  private writable = false
  private tornDown = false

  constructor(options: { host?: string, port: number, auth: FabricIpcAuthFrame }, handlers: EnvelopePipeHandlers) {
    this.handlers = handlers
    const socket = net.connect({ host: options.host ?? '127.0.0.1', port: options.port })
    this.socket = socket
    socket.once('connect', () => {
      if (this.tornDown) {
        return
      }
      this.connecting = false
      this.writable = true
      // Two writes of one logical frame; cork/uncork coalesces them into a
      // single flush so the agent observes the complete auth frame atomically.
      socket.cork()
      socket.write(encodeFabricIpcFrame(Buffer.from(JSON.stringify(options.auth), 'utf8')))
      socket.uncork()
      handlers.onOpen?.()
    })
    socket.on('data', (chunk) => {
      if (this.tornDown) {
        return
      }
      try {
        for (const frame of this.parser.push(chunk)) {
          this.handlers.onMessage?.(frame)
        }
      }
 catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
    socket.on('error', (error) => {
      if (!this.tornDown) {
        this.handlers.onError?.(error)
      }
    })
    socket.once('close', (hadError) => {
      this.connecting = false
      this.writable = false
      if (!this.tornDown) {
        this.handlers.onClose?.(null, hadError ? 'Fabric agent IPC socket closed after an error' : 'Fabric agent IPC socket closed')
      }
    })
  }

  get open(): boolean {
    return this.writable && !this.socket.destroyed
  }

  send(data: Uint8Array): void {
    if (!this.open) {
      return
    }
    const prefix = Buffer.allocUnsafe(LENGTH_PREFIX_BYTES)
    prefix.writeUInt32BE(data.byteLength, 0)
    // Buffer.from(arrayBuffer, byteOffset, length) is a view, so outbound
    // envelopes are not copied before the kernel write.
    const payload = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    this.socket.cork()
    this.socket.write(prefix)
    this.socket.write(payload)
    this.socket.uncork()
  }

  close(): void {
    if (this.socket.destroyed) {
      return
    }
    if (this.open) {
      this.writable = false
      this.socket.end()
      return
    }
    // A still-connecting socket cannot perform a graceful close; destroying
    // it aborts the connect and the close event still reaches the handlers.
    this.socket.destroy()
  }

  teardown(): void {
    if (this.tornDown) {
      return
    }
    this.tornDown = true
    this.connecting = false
    this.writable = false
    this.socket.destroy()
  }

  private fail(error: Error): void {
    if (!this.tornDown) {
      this.handlers.onError?.(error)
    }
    this.socket.destroy()
  }
}
