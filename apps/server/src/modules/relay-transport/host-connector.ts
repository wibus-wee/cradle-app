import net from 'node:net'

import { relayHostEnrollments } from '@cradle/db'
import { eq } from 'drizzle-orm'
import WebSocket from 'ws'

import { AppError } from '../../errors/app-error'
import { CRADLE_RELAY_TOKEN_HEADER } from '../../http/auth'
import { db } from '../../infra'
import { createChildLogger } from '../../logging/logger'
import { relayAssertionHeaders, signRelayAssertion } from '../relay-servers/relay-signature-service'
import { readSecret, upsertSecret } from '../secrets/service'
import { loadPrivateKeyBytes, publicKeyFromPrivate } from './crypto'
import type { RelayEnvelope } from './protocol'
import { relayEnvelopeSchema } from './protocol'
import { readOrCreateHostRelayAuthToken } from './relay-auth-token-service'
import { RelaySession } from './session'

const logger = createChildLogger({ module: 'relay-host-connector' })

/**
 * Host-side always-on background service.
 *
 * For each `relay_host_enrollments` row, maintains a /ws/host connection to
 * relayd with exponential-backoff reconnect. On first pairing it uses the
 * stored pairing code; once paired it reconnects via the pinned controller
 * pubkey (no human intervention). Each `stream_open` from the controller is
 * bridged to a `net.connect` against this Cradle Server's own HTTP port, so
 * the controller's remote-hosts upstream gateway reaches the host server end-to-end.
 */

export interface HostConnectorConfig {
  /** The host's own Cradle Server address (where stream_open connects to). */
  localServerHost: string
  localServerPort: number
}

/**
 * In-memory snapshot of a host enrollment's live connection state. Not persisted
 * — re-learned from the controller's `hello` on each reconnect, so it's null
 * until the first handshake after a Cradle Server restart.
 */
export interface HostEnrollmentLiveState {
  /** True when the E2E session is currently ready (controller connected right now). */
  connected: boolean
  /** Controller label learned from its `hello.name`, or null if not yet known. */
  controllerName: string | null
  /** Unix ms of the most recent successful handshake, or null if never. */
  lastReadyAt: number | null
  /** Currently open tunneled streams (a controller with active traffic has ≥1). */
  activeStreams: number
}

interface ActiveStream {
  socket: net.Socket
  streamId: string
  requestWriter: RelayHttpRequestWriter
}

class HostConnection {
  private streams = new Map<string, ActiveStream>()
  private session: RelaySession | null = null
  private ws: WebSocket | null = null
  private stopped = false
  private reconnectTimer: NodeJS.Timeout | null = null
  private backoffMs = 1_000
  private readonly maxBackoffMs = 30_000
  /** Unix ms of the most recent `onReady` (controller connected + handshake done). */
  private lastReadyAt: number | null = null
  /** Controller label learned from its `hello.name`. Cleared on teardown. */
  private controllerName: string | null = null

  constructor(
    private readonly enrollmentId: string,
    private readonly config: HostConnectorConfig,
    private readonly reloadEnrollment: () => Promise<HostEnrollmentRecord>,
    private readonly onPaired: (controllerPubkey: string, controllerSigningPubkey: string) => void,
    private readonly onStatus: (status: 'pending' | 'paired' | 'offline', lastError?: string) => void,
  ) {}

  start(): void {
    this.stopped = false
    void this.loop()
  }

  stop(): void {
    this.stopped = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    void this.teardown()
  }

  /** Snapshot of the in-memory connection state for UI surfacing. */
  getLiveState(): HostEnrollmentLiveState {
    return {
      connected: this.session?.isReady ?? false,
      controllerName: this.controllerName,
      lastReadyAt: this.lastReadyAt,
      activeStreams: this.streams.size,
    }
  }

  private async loop(): Promise<void> {
    if (this.stopped) {
      return
    }
    try {
      const enrollment = await this.reloadEnrollment()
      await this.ensureRoom(enrollment)
      await this.connectAndServe(enrollment)
      // If connectAndServe returns normally, the connection dropped; schedule reconnect.
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('relay host connection dropped', { enrollmentId: this.enrollmentId, err: message })
      this.onStatus('offline', message)
    }
    await this.teardown()
    if (this.stopped) {
      return
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.loop()
    }, this.backoffMs)
    this.reconnectTimer.unref?.()
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs)
  }

  private async ensureRoom(enrollment: HostEnrollmentRecord): Promise<void> {
    // Re-create/renew the room idempotently so a reconnect after a relayd
    // restart (or after RoomTTL with no peers) succeeds.
    const controllerSigningPubkey = enrollment.pinnedControllerPubkey
      ? readHostControllerSigningPubkey(enrollment.id)
      : null
    const assertion = signRelayAssertion(enrollment.hostSigningPrivateKey, {
      role: 'host',
      purpose: 'reconnect',
      roomId: enrollment.roomId,
      ...(controllerSigningPubkey ? { controllerPubkey: controllerSigningPubkey } : {}),
    })
    const url = new URL('/rooms/host-session', `${enrollment.relayUrl.replace(/\/+$/, '')}/`)
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ assertion }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new AppError({
        code: 'relay_host_session_failed',
        status: 502,
        message: `relayd /rooms/host-session returned ${response.status}: ${text}`,
      })
    }
  }

  private connectAndServe(enrollment: HostEnrollmentRecord): Promise<void> {
    const wsUrl = toWebSocketUrl(enrollment.relayUrl, '/ws/host')
    return new Promise<void>((resolve, reject) => {
      let settled = false
      const drop = (error: Error) => {
        if (settled) {
          return
        }
        settled = true
        reject(error)
      }

      const hostWsAssertion = signRelayAssertion(enrollment.hostSigningPrivateKey, {
        role: 'host',
        purpose: 'ws',
        roomId: enrollment.roomId,
      })

      let ws: WebSocket
      try {
        ws = new WebSocket(wsUrl, { headers: relayAssertionHeaders(hostWsAssertion) })
      }
      catch (error) {
        drop(error instanceof Error ? error : new Error(String(error)))
        return
      }
      this.ws = ws

      const isReconnect = Boolean(enrollment.pinnedControllerPubkey)
      let learnedControllerPubkey: string | null = null
      let learnedControllerSigningPubkey: string | null = null
      const session = new RelaySession(
        'host',
        enrollment.hostPrivateKey,
        {
          roomId: enrollment.roomId,
          ourPublicKeyBase64: enrollment.hostPubkey,
          ...(isReconnect ? { pinnedPeerPubkey: enrollment.pinnedControllerPubkey! } : { pairingCode: enrollment.pairingCode ?? '' }),
        },
        {
          send: (data) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(data)
            }
          },
          onReady: () => {
            ws.removeAllListeners('close')
            ws.removeAllListeners('error')
            ws.on('close', () => drop(new Error('relayd closed the host websocket')))
            ws.on('error', () => drop(new Error('relayd host websocket error')))
            this.backoffMs = 1_000 // reset backoff after a clean ready
            this.lastReadyAt = Date.now()
            if (!enrollment.pinnedControllerPubkey && learnedControllerPubkey && learnedControllerSigningPubkey) {
              this.onPaired(learnedControllerPubkey, learnedControllerSigningPubkey)
            }
            this.onStatus('paired')
          },
          onPeerPubkey: (controllerPubkey) => {
            if (!enrollment.pinnedControllerPubkey) {
              learnedControllerPubkey = controllerPubkey
            }
          },
          onPeerInfo: (info) => {
            if (info.name) {
              this.controllerName = info.name
            }
            if (info.signingPubkey) {
              learnedControllerSigningPubkey = info.signingPubkey
            }
          },
          onStreamOpen: streamId => this.openLocalStream(streamId, enrollment.relayAuthToken),
          onStreamData: (streamId, data) => this.handleStreamData(streamId, data),
          onStreamClose: streamId => this.handleStreamClose(streamId),
          onPeerClosed: () => drop(new Error('controller peer closed')),
          onError: error => drop(error),
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
          drop(error instanceof Error ? error : new Error(String(error)))
        }
      })
      ws.once('close', () => drop(new Error('relayd closed the host websocket before ready')))
      ws.once('error', error => drop(error))
    })
  }

  private openLocalStream(streamId: string, relayAuthToken: string): void {
    const session = this.session
    if (!session) {
      return
    }
    const socket = net.connect({ host: this.config.localServerHost, port: this.config.localServerPort })
    const requestWriter = new RelayHttpRequestWriter(socket, relayAuthToken, () => {
      session.closeStream(streamId, 'invalid relay HTTP request')
      socket.destroy()
      this.streams.delete(streamId)
    })
    this.streams.set(streamId, { socket, streamId, requestWriter })

    socket.on('data', (chunk: Buffer) => {
      session.writeStreamData(streamId, new Uint8Array(chunk))
    })
    socket.on('close', () => {
      session.closeStream(streamId, 'local server socket closed')
      this.streams.delete(streamId)
    })
    socket.on('error', () => {
      session.closeStream(streamId, 'local server socket error')
      this.streams.delete(streamId)
    })
  }

  private handleStreamData(streamId: string, data: Uint8Array): void {
    const stream = this.streams.get(streamId)
    if (!stream) {
      return
    }
    stream.requestWriter.write(data)
  }

  private handleStreamClose(streamId: string): void {
    const stream = this.streams.get(streamId)
    if (!stream) {
      return
    }
    stream.socket.destroy()
    this.streams.delete(streamId)
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
    for (const { socket } of this.streams.values()) {
      socket.destroy()
    }
    this.streams.clear()
  }
}

interface HostEnrollmentRecord {
  id: string
  relayUrl: string
  roomId: string
  hostPubkey: string
  hostPrivateKey: string
  hostSigningPrivateKey: string
  pinnedControllerPubkey: string | null
  pairingCode: string | null
  relayAuthToken: string
}

export class HostConnectorService {
  private readonly connections = new Map<string, HostConnection>()

  constructor(private readonly config: HostConnectorConfig) {}
  startAll(): void {
    const enrollments = db()
      .select()
      .from(relayHostEnrollments)
      .all()
    for (const enrollment of enrollments) {
      this.startForEnrollment(enrollment.id)
    }
  }

  stopAll(): void {
    for (const id of [...this.connections.keys()]) {
      this.stopForEnrollment(id)
    }
  }

  startForEnrollment(enrollmentId: string): void {
    if (this.connections.has(enrollmentId)) {
      return
    }
    const reload = async (): Promise<HostEnrollmentRecord> => {
      const row = db()
        .select()
        .from(relayHostEnrollments)
        .where(eq(relayHostEnrollments.id, enrollmentId))
        .get()
      if (!row) {
        throw new AppError({ code: 'relay_host_enrollment_not_found', status: 404, message: 'Relay host enrollment not found.' })
      }
      return {
        id: row.id,
        relayUrl: row.relayUrl,
        roomId: row.roomId,
        hostPubkey: row.hostPubkey,
        hostPrivateKey: readHostPrivateKey(row.hostPrivateKeySecretId, row.hostPubkey),
        hostSigningPrivateKey: readHostSigningPrivateKey(row.id),
        pinnedControllerPubkey: row.pinnedControllerPubkey,
        pairingCode: row.pairingCode,
        relayAuthToken: readOrCreateHostRelayAuthToken({
          enrollmentId: row.id,
          displayName: row.displayName,
        }),
      }
    }
    const onPaired = (controllerPubkey: string, controllerSigningPubkey: string) => {
      const now = Math.floor(Date.now() / 1000)
      upsertSecret({
        id: hostControllerSigningPubkeySecretId(enrollmentId),
        kind: 'system-relay-host-controller-signing-pubkey',
        label: `Relay controller signing public key (${enrollmentId})`,
        secret: controllerSigningPubkey,
      })
      db()
        .update(relayHostEnrollments)
        .set({ pinnedControllerPubkey: controllerPubkey, status: 'paired', pairingCode: null, lastError: null, updatedAt: now })
        .where(eq(relayHostEnrollments.id, enrollmentId))
        .run()
      logger.info('relay host enrollment paired', { enrollmentId, controllerPubkeyFingerprint: controllerPubkey.slice(0, 16) })
    }
    const onStatus = (status, lastError) => {
      const now = Math.floor(Date.now() / 1000)
      db()
        .update(relayHostEnrollments)
        .set({ status, lastError: lastError ?? null, updatedAt: now })
        .where(eq(relayHostEnrollments.id, enrollmentId))
        .run()
    }
    const connection = new HostConnection(enrollmentId, this.config, reload, onPaired, onStatus)
    this.connections.set(enrollmentId, connection)
    connection.start()
  }

  stopForEnrollment(enrollmentId: string): void {
    const connection = this.connections.get(enrollmentId)
    if (!connection) {
      return
    }
    this.connections.delete(enrollmentId)
    connection.stop()
  }

  restartForEnrollment(enrollmentId: string): void {
    this.stopForEnrollment(enrollmentId)
    this.startForEnrollment(enrollmentId)
  }

  /** Live in-memory state for an enrollment, or null if no connector is running for it. */
  getLiveState(enrollmentId: string): HostEnrollmentLiveState | null {
    return this.connections.get(enrollmentId)?.getLiveState() ?? null
  }
}

function readHostPrivateKey(secretId: string, expectedPublicKey: string): string {
  const privateKey = readSecret(secretId)
  // Sanity check: the stored private key must derive the stored public key.
  if (publicKeyFromPrivate(privateKey) !== expectedPublicKey) {
    throw new AppError({
      code: 'relay_host_enrollment_key_mismatch',
      status: 500,
      message: 'Stored host private key does not match the enrollment public key.',
    })
  }
  return privateKey
}

function readHostSigningPrivateKey(enrollmentId: string): string {
  try {
    return readSecret(`relay-host-sign-key:${enrollmentId}`)
  }
  catch (error) {
    throw new AppError({
      code: 'relay_host_enrollment_signing_key_missing',
      status: 409,
      message: 'Relay host enrollment is missing its signing key. Re-create the pairing.',
      details: { enrollmentId, cause: error instanceof Error ? error.message : String(error) },
    })
  }
}

function readHostControllerSigningPubkey(enrollmentId: string): string {
  try {
    return readSecret(hostControllerSigningPubkeySecretId(enrollmentId))
  }
  catch (error) {
    throw new AppError({
      code: 'relay_host_enrollment_controller_signing_key_missing',
      status: 409,
      message: 'Relay host enrollment is missing the controller signing public key. Re-create the pairing.',
      details: { enrollmentId, cause: error instanceof Error ? error.message : String(error) },
    })
  }
}

function hostControllerSigningPubkeySecretId(enrollmentId: string): string {
  return `relay-host-controller-sign-pubkey:${enrollmentId}`
}

const MAX_RELAY_HTTP_HEADER_BYTES = 64 * 1024

class RelayHttpRequestWriter {
  private buffered: Buffer[] = []
  private bufferedLength = 0
  private released = false

  constructor(
    private readonly socket: net.Socket,
    private readonly relayAuthToken: string,
    private readonly reject: () => void,
  ) {}

  write(data: Uint8Array): void {
    if (this.released) {
      this.writeToSocket(Buffer.from(data))
      return
    }

    const chunk = Buffer.from(data)
    this.buffered.push(chunk)
    this.bufferedLength += chunk.byteLength
    if (this.bufferedLength > MAX_RELAY_HTTP_HEADER_BYTES) {
      this.reject()
      return
    }

    const buffered = Buffer.concat(this.buffered, this.bufferedLength)
    const headerEnd = buffered.indexOf('\r\n\r\n')
    if (headerEnd < 0) {
      return
    }

    const headerBlock = buffered.subarray(0, headerEnd).toString('latin1')
    const rewrittenHeader = rewriteRelayHttpRequestHead(headerBlock, this.relayAuthToken)
    if (!rewrittenHeader) {
      this.reject()
      return
    }

    this.released = true
    this.buffered = []
    this.bufferedLength = 0
    const body = buffered.subarray(headerEnd + 4)
    this.writeToSocket(Buffer.concat([
      Buffer.from(`${rewrittenHeader}\r\n\r\n`, 'latin1'),
      body,
    ]))
  }

  private writeToSocket(data: Buffer): void {
    this.socket.write(data, (error) => {
      if (error) {
        this.socket.destroy()
      }
    })
  }
}

export function rewriteRelayHttpRequestHead(headerBlock: string, relayAuthToken: string): string | null {
  const lines = headerBlock.split('\r\n')
  const requestLine = lines[0]
  if (!requestLine || !/^[A-Z!#$%&'*+.^_`|~-]+ \S+ HTTP\/1\.[01]$/.test(requestLine)) {
    return null
  }

  const headers = lines.slice(1).filter((line) => {
    const lower = line.toLowerCase()
    return !lower.startsWith(`${CRADLE_RELAY_TOKEN_HEADER}:`)
      && !lower.startsWith('connection:')
  })
  const isUpgrade = lines.slice(1).some((line) => {
    const lower = line.toLowerCase()
    return lower.startsWith('upgrade:')
      || (lower.startsWith('connection:') && lower.includes('upgrade'))
  })

  return [
    requestLine,
    ...headers,
    `${CRADLE_RELAY_TOKEN_HEADER}: ${relayAuthToken}`,
    ...(isUpgrade ? [] : ['Connection: close']),
  ].join('\r\n')
}

// Re-export for callers (e.g. enrollment service) that need to load the key.
export { loadPrivateKeyBytes }

// ── singleton accessor ──

let hostConnectorSingleton: HostConnectorService | null = null

export function initHostConnectorService(config: HostConnectorConfig): HostConnectorService {
  hostConnectorSingleton = new HostConnectorService(config)
  return hostConnectorSingleton
}

export function getHostConnectorService(): HostConnectorService | null {
  return hostConnectorSingleton
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
