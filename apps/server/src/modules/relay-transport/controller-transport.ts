import net from 'node:net'

import WebSocket from 'ws'

import { AppError } from '../../errors/app-error'
import type { SignedRelayAssertion } from '../relay-servers/relay-signature-service'
import { relayAssertionHeaders } from '../relay-servers/relay-signature-service'
import type { RemoteCradleServerTunnelHandle } from '../remote-hosts/cradle-server-tunnel'
import { allocateLocalPort } from '../remote-hosts/cradle-server-tunnel'
import { generateRelayKeyPair, publicKeyFromPrivate } from './crypto'
import type { RelayEnvelope } from './protocol'
import { relayEnvelopeSchema } from './protocol'
import { RelaySession } from './session'

/**
 * Controller-side relay transport.
 *
 * Connects to relayd `/ws/controller` as one end of an E2E-encrypted tunnel,
 * runs the `RelaySession` handshake, and listens on a local TCP port. Each TCP
 * connection accepted on the local port becomes one multiplexed stream over the
 * tunnel: bytes flow local-socket → stream_data → host peer → host's local
 * Cradle Server socket, and back. The handle returned is shaped exactly like
 * the SSH tunnel handle so `remote-hosts` connects/health-checks transparently.
 *
 * The controller's X25519 private key is supplied by the caller (stored as a
 * managed secret). If none is supplied (first pairing), a fresh keypair is
 * generated and returned so the caller can persist it for reconnect.
 */

export interface RelayControllerTransportOptions {
  hostId: string
  relayUrl: string
  roomId: string
  /** Signed assertion for relayd /ws/controller. */
  wsAssertion: SignedRelayAssertion
  /** Controller private key (base64). If omitted, a fresh keypair is generated. */
  controllerPrivateKeyBase64?: string
  controllerPublicKeyBase64?: string
  /** First-pairing code. Mutually exclusive with pinnedHostPubkey. */
  pairingCode?: string
  /** Pinned host public key for reconnect. */
  pinnedHostPubkey?: string
  /** Optional label sent in `hello` so the host can show who paired with it. */
  controllerName?: string
  readyTimeoutMs?: number
}

export interface RelayControllerTransportHandle extends RemoteCradleServerTunnelHandle {
  /** The controller keypair actually used. Persist the private key for reconnect. */
  readonly controllerPrivateKeyBase64: string
  readonly controllerPublicKeyBase64: string
  /** The host public key learned during the handshake (pin it for reconnect). */
  readonly hostPublicKeyBase64: string | null
}

interface ActiveStream {
  socket: net.Socket
  streamId: string
}

export async function startRelayControllerTransport(
  options: RelayControllerTransportOptions,
): Promise<RelayControllerTransportHandle> {
  const readyTimeoutMs = options.readyTimeoutMs ?? 15_000
  const keypair = options.controllerPrivateKeyBase64
    ? {
        privateKeyBase64: options.controllerPrivateKeyBase64,
        publicKeyBase64: options.controllerPublicKeyBase64
          ?? publicKeyFromPrivate(options.controllerPrivateKeyBase64),
      }
    : generateRelayKeyPair()

  const localPort = await allocateLocalPort()
  const transport = new ControllerTransport(options, keypair, localPort)
  await transport.start(readyTimeoutMs)
  return transport.toHandle()
}

class ControllerTransport {
  private readonly streams = new Map<string, ActiveStream>()
  private readonly exitListeners = new Set<(exit: { code: number | null, signal: NodeJS.Signals | null }) => void>()
  private session: RelaySession | null = null
  private ws: WebSocket | null = null
  private server: net.Server | null = null
  private streamCounter = 0
  private closed = false
  private hostPublicKeyBase64: string | null = null

  constructor(
    private readonly options: RelayControllerTransportOptions,
    private readonly keypair: { privateKeyBase64: string, publicKeyBase64: string },
    private readonly localPort: number,
  ) {}

  async start(readyTimeoutMs: number): Promise<void> {
    const deadline = Date.now() + readyTimeoutMs
    // Retry the WS connect + handshake until ready or the deadline lapses. The
    // host peer may not be connected yet (its connector is reconnecting), in
    // which case relayd closes us with TryAgainLater — we back off and retry.
    let lastError: unknown
    while (Date.now() < deadline) {
      try {
        await this.connectAndHandshake(deadline - Date.now())
        await this.startLocalServer()
        return
      }
      catch (error) {
        lastError = error
        await this.teardown()
        if (Date.now() >= deadline) {
          break
        }
        await sleep(500)
      }
    }
    throw new AppError({
      code: 'relay_controller_connect_failed',
      status: 503,
      message: `Relay controller transport did not become ready within ${readyTimeoutMs}ms: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    })
  }

  private connectAndHandshake(remainingMs: number): Promise<void> {
    const wsUrl = toWebSocketUrl(this.options.relayUrl, '/ws/controller')
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const timeout = setTimeout(() => {
        finish(new AppError({
          code: 'relay_controller_handshake_timeout',
          status: 503,
          message: `Relay controller handshake did not complete within ${Math.max(0, Math.floor(remainingMs))}ms.`,
        }))
      }, Math.max(1, remainingMs))
      timeout.unref?.()
      const finish = (error?: Error) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timeout)
        if (error) {
          reject(error)
        }
        else {
          resolve()
        }
      }

      let ws: WebSocket
      try {
        ws = new WebSocket(wsUrl, { headers: relayAssertionHeaders(this.options.wsAssertion) })
      }
      catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
        return
      }
      this.ws = ws

      const session = new RelaySession(
        'controller',
        this.keypair.privateKeyBase64,
        {
          roomId: this.options.roomId,
          ourPublicKeyBase64: this.keypair.publicKeyBase64,
          ...(this.options.pairingCode ? { pairingCode: this.options.pairingCode } : {}),
          ...(this.options.pinnedHostPubkey ? { pinnedPeerPubkey: this.options.pinnedHostPubkey } : {}),
          ...(this.options.controllerName ? { ourName: this.options.controllerName } : {}),
          ourSigningPubkey: this.options.wsAssertion.assertion.pubkey,
        },
        {
          send: (data) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(data)
            }
          },
          onReady: () => {
            // Swap the handshake close handler for a post-ready one: a drop
            // after ready is a tunnel exit, not a handshake failure.
            ws.removeAllListeners('close')
            ws.removeAllListeners('error')
            ws.on('close', () => this.fireExit(null, null))
            ws.on('error', () => this.fireExit(null, null))
            finish()
          },
          onPeerPubkey: (pubkey) => {
            this.hostPublicKeyBase64 = pubkey
          },
          onStreamData: (streamId, data) => this.handleStreamData(streamId, data),
          onStreamClose: streamId => this.handleStreamClose(streamId),
          onPeerClosed: () => this.fireExit(null, null),
          onError: error => finish(error),
          onPauseStream: streamId => this.streams.get(streamId)?.socket.pause(),
          onResumeStream: streamId => this.streams.get(streamId)?.socket.resume(),
        },
      )
      this.session = session

      ws.once('open', () => session.start())
      ws.on('message', (data: WebSocket.RawData) => {
        try {
          const env = relayEnvelopeSchema.parse(JSON.parse(data.toString('utf8')))
          session.handleEnvelope(env as RelayEnvelope)
        }
        catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)))
        }
      })
      ws.once('close', () => finish(new AppError({
        code: 'relay_controller_ws_closed',
        status: 503,
        message: 'Relayd closed the controller websocket before the handshake completed.',
      })))
      ws.once('error', error => finish(error))
    })
  }

  private startLocalServer(): Promise<void> {
    const server = net.createServer((socket) => {
      this.handleLocalConnection(socket)
    })
    this.server = server
    server.on('error', () => this.fireExit(null, null))
    return new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        server.off('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(this.localPort, '127.0.0.1')
    })
  }

  private handleLocalConnection(socket: net.Socket): void {
    const session = this.session
    if (!session || !session.isReady) {
      socket.destroy()
      return
    }
    const streamId = `c${++this.streamCounter}`
    this.streams.set(streamId, { socket, streamId })
    session.openStream(streamId)

    socket.on('data', (chunk: Buffer) => {
      session.writeStreamData(streamId, new Uint8Array(chunk))
    })
    socket.on('close', () => {
      session.closeStream(streamId, 'local socket closed')
      this.streams.delete(streamId)
    })
    socket.on('error', () => {
      session.closeStream(streamId, 'local socket error')
      this.streams.delete(streamId)
    })
  }

  private handleStreamData(streamId: string, data: Uint8Array): void {
    const stream = this.streams.get(streamId)
    if (!stream) {
      return
    }
    stream.socket.write(Buffer.from(data), (error) => {
      if (error) {
        stream.socket.destroy()
      }
    })
  }

  private handleStreamClose(streamId: string): void {
    const stream = this.streams.get(streamId)
    if (!stream) {
      return
    }
    stream.socket.destroy()
    this.streams.delete(streamId)
  }

  private fireExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.closed) {
      return
    }
    this.closed = true
    const exit = { code, signal }
    for (const listener of this.exitListeners) {
      listener(exit)
    }
    void this.teardown()
  }

  private async teardown(): Promise<void> {
    this.session?.close()
    this.session = null
    if (this.ws) {
      this.ws.removeAllListeners()
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close()
      }
      this.ws = null
    }
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server?.close(() => resolve())
      })
      this.server = null
    }
    for (const { socket } of this.streams.values()) {
      socket.destroy()
    }
    this.streams.clear()
  }

  toHandle(): RelayControllerTransportHandle {
    const { hostId } = this.options
    const { localPort, keypair, exitListeners } = this
    return {
      hostId,
      localPort,
      localBaseUrl: `http://127.0.0.1:${localPort}`,
      pid: null,
      stderr: '',
      get controllerPrivateKeyBase64() {
        return keypair.privateKeyBase64
      },
      get controllerPublicKeyBase64() {
        return keypair.publicKeyBase64
      },
      hostPublicKeyBase64: this.hostPublicKeyBase64,
      onExit: (listener) => {
        exitListeners.add(listener)
      },
      close: async () => {
        this.closed = true
        await this.teardown()
      },
    }
  }
}

function toWebSocketUrl(relayUrl: string, path: string): string {
  const url = new URL(path, `${relayUrl.replace(/\/+$/, '')}/`)
  if (url.protocol === 'http:') {
    url.protocol = 'ws:'
  }
  else if (url.protocol === 'https:') {
    url.protocol = 'wss:'
  }
  return url.toString()
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
