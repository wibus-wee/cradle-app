import { x25519 } from '@noble/curves/ed25519'

import { AppError } from '../../errors/app-error'
import type { RelayCryptoRole, RelayDerivedKeys } from './crypto'
import {
  computeRelayConfirm,
  computeRelaySharedSecret,
  deriveRelayKeys,
  RelayCipher,
  relayPublicKeyFingerprint,
} from './crypto'
import type { InnerFrame, RelayEnvelope } from './protocol'
import {
  encryptedPayloadSchema,
  helloFrameSchema,
  INNER_FRAME_KIND,
  innerFrameSchema,
  peerClosedPayloadSchema,
  RELAY_ENVELOPE_KIND,
  RELAY_MAX_STREAM_CHUNK_BYTES,
  RELAY_PROTOCOL_VERSION,
  RELAY_STREAM_CREDIT_BYTES,
  relayErrorPayloadSchema,
} from './protocol'

/**
 * RelaySession — the protocol state machine shared by the controller and host
 * transports. It owns:
 *
 * 1. The `hello` / `hello_confirm` handshake (ECDH → key derivation → pinning).
 * 2. Per-frame XChaCha20-Poly1305 encryption of inner stream frames.
 * 3. Stream multiplexing over the single relayd room.
 * 4. Credit-based flow control so a fast sender can't overrun the relayd queue
 *    (64 frames / 4 MiB) or the peer.
 *
 * The session is transport-agnostic: it emits outbound bytes via `send` and
 * inbound stream events via callbacks. The controller-transport / host-connector
 * wires it to a WebSocket (to relayd) and to local TCP sockets.
 */

export type RelaySessionRole = RelayCryptoRole

export interface RelaySessionOptions {
  /** The relayd room id this session operates in. Stamped on every outbound envelope. */
  roomId: string
  /** Pairing code. Required for first pairing; omitted on reconnect. */
  pairingCode?: string
  /** Pinned peer public key (base64). Present on reconnect; null on first pairing. */
  pinnedPeerPubkey?: string
  /** Our public key (base64). Derived from the private key if not supplied. */
  ourPublicKeyBase64?: string
  /** Whether this side sends `hello` on start() (controller) or waits (host). Defaults to role === 'controller'. */
  initiateHello?: boolean
  /** Optional human-readable label sent in our `hello` so the peer can show who we are. */
  ourName?: string
  /** Optional Ed25519 relay assertion public key sent in our `hello`. */
  ourSigningPubkey?: string
}

export interface RelaySessionCallbacks {
  /** Write serialized envelope bytes (JSON string) to the relayd WebSocket. */
  send: (data: string) => void
  onReady?: () => void
  onPeerPubkey?: (peerPubkey: string, fingerprint: string) => void
  /** Fires with the peer's reported label (from its `hello.name`) once known. */
  onPeerInfo?: (info: { name?: string, signingPubkey?: string }) => void
  onStreamOpen?: (streamId: string) => void
  onStreamData?: (streamId: string, data: Uint8Array) => void
  onStreamAck?: (streamId: string, ackedBytes: number) => void
  onStreamClose?: (streamId: string, reason?: string) => void
  onPeerClosed?: (reason?: string) => void
  onError?: (error: Error) => void
  /** Backpressure signal: stop reading from the local source for this stream. */
  onPauseStream?: (streamId: string) => void
  /** Backpressure cleared: resume reading from the local source for this stream. */
  onResumeStream?: (streamId: string) => void
}

type SessionState = 'idle' | 'handshake' | 'ready' | 'closed'

interface StreamFlowState {
  /** Bytes sent (plaintext) for which we have not yet received an ack. */
  bytesInFlight: number
  /** Whether the local source is currently paused due to flow control. */
  paused: boolean
  /** Total plaintext bytes sent on this stream. */
  sentBytes: number
  /** Total plaintext bytes received on this stream (receiver side). */
  receivedBytes: number
  /** Bytes already acked back to the peer. */
  ackedBytes: number
  closed: boolean
}

const ACK_INTERVAL_BYTES = 64 * 1024

export class RelaySession {
  readonly role: RelaySessionRole
  private readonly roomId: string
  private readonly ourPrivateKeyBase64: string
  private readonly ourPublicKeyBase64: string
  private readonly pairingCode: string | undefined
  private readonly pinnedPeerPubkey: string | undefined
  private readonly cb: RelaySessionCallbacks
  private readonly initiateHello: boolean
  private readonly ourName: string | undefined
  private readonly ourSigningPubkey: string | undefined

  private state: SessionState = 'idle'
  private peerPubkey: string | null = null
  private keys: RelayDerivedKeys | null = null
  private sendCipher: RelayCipher | null = null
  private receiveCipher: RelayCipher | null = null
  private outboundSeq = 0
  private readonly streams = new Map<string, StreamFlowState>()
  /** Set when we've sent our hello, awaiting peer hello. */
  private helloSent = false
  /** Set when we've sent hello_confirm (first pairing). */
  private confirmSent = false
  /** Set when we've verified the peer's hello_confirm (first pairing). */
  private confirmVerified = false
  private readonly isReconnect: boolean

  constructor(
    role: RelaySessionRole,
    ourPrivateKeyBase64: string,
    options: RelaySessionOptions,
    callbacks: RelaySessionCallbacks,
  ) {
    this.role = role
    this.roomId = options.roomId
    this.ourPrivateKeyBase64 = ourPrivateKeyBase64
    this.pairingCode = options.pairingCode
    this.pinnedPeerPubkey = options.pinnedPeerPubkey
    this.cb = callbacks
    this.ourPublicKeyBase64 = options.ourPublicKeyBase64 ?? publicKeyFromPrivateKey(ourPrivateKeyBase64)
    this.isReconnect = Boolean(options.pinnedPeerPubkey)
    // The controller initiates the hello exchange; the host waits for it. This
    // matches the relay model where the host is always-on and the controller
    // connects later — if the host sent hello first, relayd would close it
    // (TryAgainLater) because no controller peer is connected yet.
    this.initiateHello = options.initiateHello ?? (role === 'controller')
    this.ourName = options.ourName
    this.ourSigningPubkey = options.ourSigningPubkey
  }

  get isReady(): boolean {
    return this.state === 'ready'
  }

  get peerPublicKey(): string | null {
    return this.peerPubkey
  }

  /**
   * Begin the handshake. The controller sends its `hello` immediately; the
   *  host waits and sends its hello reactively when the controller's arrives.
   */
  start(): void {
    if (this.helloSent || this.state === 'closed') {
      return
    }
    if (this.state === 'idle') {
      this.state = 'handshake'
    }
    if (this.initiateHello) {
      this.sendHello()
    }
    // else: host waits for the controller's hello, then sends ours in handleHello.
  }

  /** Process a raw envelope received from relayd. */
  handleEnvelope(env: RelayEnvelope): void {
    if (this.state === 'closed') {
      return
    }
    if (env.version !== RELAY_PROTOCOL_VERSION) {
      this.fail(new AppError({ code: 'relay_protocol_version', status: 400, message: `Unsupported relay protocol version ${env.version}` }))
      return
    }
    switch (env.kind) {
      case RELAY_ENVELOPE_KIND.dataFrame:
        this.handleDataFrame(env)
        break
      case RELAY_ENVELOPE_KIND.peerClosed:
        this.handlePeerClosed(env)
        break
      case RELAY_ENVELOPE_KIND.relayError:
        this.handleRelayError(env)
        break
      default:
        this.fail(new AppError({ code: 'relay_protocol_unknown_kind', status: 400, message: `Unknown relay envelope kind ${env.kind}` }))
    }
  }

  // ── Handshake ──

  private sendHello(): void {
    if (this.helloSent) {
      return
    }
    const frame = {
      kind: INNER_FRAME_KIND.hello,
      version: RELAY_PROTOCOL_VERSION,
      pubkey: this.ourPublicKeyBase64,
      ...(this.pinnedPeerPubkey ? { pinnedPubkey: this.pinnedPeerPubkey } : {}),
      ...(this.ourName ? { name: this.ourName } : {}),
      ...(this.ourSigningPubkey ? { signingPubkey: this.ourSigningPubkey } : {}),
    }
    helloFrameSchema.parse(frame)
    // Set helloSent BEFORE sendPlainEnvelope: sendPlainEnvelope is delivered
    // synchronously by the test transport, which can re-enter handleHello →
    // sendHello before this call returns. Without this guard the host would
    // send a second, plaintext hello after keys are derived.
    this.helloSent = true
    this.sendPlainEnvelope(frame)
    this.maybeSendConfirm()
  }

  private handleDataFrame(env: RelayEnvelope): void {
    let frame: InnerFrame
    try {
      if (this.keys === null) {
        // Pre-key: only plaintext handshake frames are accepted.
        frame = this.parsePlainFrame(env.payload)
        if (frame.kind !== INNER_FRAME_KIND.hello && frame.kind !== INNER_FRAME_KIND.helloConfirm) {
          this.fail(new AppError({ code: 'relay_handshake_unexpected_frame', status: 400, message: `Unexpected pre-handshake frame ${frame.kind}` }))
          return
        }
      }
      else {
        frame = this.decryptFrame(env.payload)
      }
    }
    catch (error) {
      this.fail(error instanceof Error ? error : new AppError({ code: 'relay_protocol_invalid_frame', status: 400, message: String(error) }))
      return
    }

    switch (frame.kind) {
      case INNER_FRAME_KIND.hello:
        this.handleHello(frame)
        break
      case INNER_FRAME_KIND.helloConfirm:
        this.handleHelloConfirm(frame)
        break
      case INNER_FRAME_KIND.streamOpen:
        this.handleStreamOpen(frame.streamId)
        break
      case INNER_FRAME_KIND.streamData:
        this.handleStreamData(frame.streamId, frame.data)
        break
      case INNER_FRAME_KIND.streamAck:
        this.handleStreamAck(frame.streamId, frame.ackedBytes)
        break
      case INNER_FRAME_KIND.streamClose:
        this.handleStreamCloseFrame(frame.streamId, frame.reason)
        break
      default:
        this.fail(new AppError({ code: 'relay_protocol_unknown_frame', status: 400, message: `Unknown inner frame kind ${(frame as { kind: string }).kind}` }))
    }
  }

  private handleHello(frame: { kind: 'hello', version: number, pubkey: string, pinnedPubkey?: string, name?: string, signingPubkey?: string }): void {
    if (this.peerPubkey !== null) {
      this.fail(new AppError({ code: 'relay_handshake_duplicate_hello', status: 400, message: 'Received duplicate hello frame.' }))
      return
    }
    // Reconnect: the peer's pubkey must match the pinned value.
    if (this.isReconnect) {
      if (!this.pinnedPeerPubkey || frame.pubkey !== this.pinnedPeerPubkey) {
        this.fail(new AppError({
          code: 'relay_handshake_pubkey_mismatch',
          status: 400,
          message: 'Peer public key does not match the pinned value.',
        }))
        return
      }
    }
    // The peer's pinnedPubkey (if any) must match ours too.
    if (frame.pinnedPubkey && frame.pinnedPubkey !== this.ourPublicKeyBase64) {
      this.fail(new AppError({
        code: 'relay_handshake_pubkey_mismatch',
        status: 400,
        message: 'Peer expected a different local public key.',
      }))
      return
    }

    this.peerPubkey = frame.pubkey
    this.cb.onPeerPubkey?.(frame.pubkey, peerFingerprint(frame.pubkey))
    if (frame.name || frame.signingPubkey) {
      this.cb.onPeerInfo?.({ ...(frame.name ? { name: frame.name } : {}), ...(frame.signingPubkey ? { signingPubkey: frame.signingPubkey } : {}) })
    }
    this.deriveKeys()

    // Host (reactive): send our hello now that the controller has spoken, so
    // the controller can learn our pubkey and complete the handshake.
    if (!this.helloSent) {
      this.sendHello()
    }

    if (this.isReconnect) {
      // Pinning verified → ready immediately, no confirm exchange needed.
      this.markReady()
    }
    else {
      // First pairing: try to send hello_confirm now (only fires once we have
      // both sent our own hello and learned the peer's pubkey).
      this.maybeSendConfirm()
    }
  }

  private deriveKeys(): void {
    if (!this.peerPubkey) {
      throw new Error('deriveKeys called before peer pubkey known')
    }
    const sharedSecret = computeRelaySharedSecret(this.ourPrivateKeyBase64, this.peerPubkey)
    this.keys = deriveRelayKeys(sharedSecret, this.pairingCode ?? '')
    this.sendCipher = new RelayCipher(this.role === 'host' ? this.keys.hostSendKey : this.keys.controllerSendKey)
    this.receiveCipher = new RelayCipher(this.role === 'host' ? this.keys.controllerSendKey : this.keys.hostSendKey)
  }

  /**
   * Build the canonical pairing `confirm` value. The transcript is role-tagged
   * (controller pubkey, then host pubkey), so both peers compute the identical
   * value regardless of which role they hold.
   */
  private buildConfirm(sharedSecret: Uint8Array): string {
    if (!this.keys || !this.peerPubkey) {
      throw new Error('buildConfirm called before keys derived')
    }
    const controllerPub = this.role === 'controller' ? this.ourPublicKeyBase64 : this.peerPubkey
    const hostPub = this.role === 'host' ? this.ourPublicKeyBase64 : this.peerPubkey
    return computeRelayConfirm({
      confirmKey: this.keys.confirmKey,
      controllerPublicKeyBase64: controllerPub,
      hostPublicKeyBase64: hostPub,
      sharedSecret,
    })
  }

  /**
   * Send `hello_confirm` once we have both sent our own `hello` and received
   * the peer's `hello` (so we know the peer's pubkey and can build the
   * canonical transcript). This ordering guarantee ensures the peer can always
   * verify our confirm, regardless of which side calls start() first.
   */
  private maybeSendConfirm(): void {
    if (this.isReconnect || this.confirmSent || !this.helloSent || !this.peerPubkey || !this.keys) {
      return
    }
    this.sendHelloConfirm()
  }

  private sendHelloConfirm(): void {
    if (!this.keys || !this.peerPubkey) {
      return
    }
    const sharedSecret = computeRelaySharedSecret(this.ourPrivateKeyBase64, this.peerPubkey)
    const confirm = this.buildConfirm(sharedSecret)
    // hello_confirm is sent AFTER both hellos are exchanged, so both peers have
    // derived keys — encrypt it like every other post-handshake frame.
    this.sendEncryptedFrame({ kind: INNER_FRAME_KIND.helloConfirm, confirm })
    this.confirmSent = true
    this.maybeMarkReady()
  }

  private handleHelloConfirm(frame: { kind: 'hello_confirm', confirm: string }): void {
    if (this.isReconnect || !this.keys || !this.peerPubkey) {
      this.fail(new AppError({ code: 'relay_handshake_unexpected_confirm', status: 400, message: 'Unexpected hello_confirm frame.' }))
      return
    }
    const sharedSecret = computeRelaySharedSecret(this.ourPrivateKeyBase64, this.peerPubkey)
    const expected = this.buildConfirm(sharedSecret)
    if (frame.confirm !== expected) {
      this.fail(new AppError({
        code: 'relay_handshake_confirm_mismatch',
        status: 400,
        message: 'Pairing confirmation failed. Check the pairing code.',
      }))
      return
    }
    this.confirmVerified = true
    this.maybeMarkReady()
  }

  private maybeMarkReady(): void {
    // Ready once we have both sent and verified the confirm (first pairing),
    // i.e. both directions of the proof are complete.
    if (this.confirmSent && this.confirmVerified) {
      this.markReady()
    }
  }

  private markReady(): void {
    if (this.state === 'ready') {
      return
    }
    this.state = 'ready'
    this.cb.onReady?.()
  }

  // ── Stream API (used by transports) ──

  /** Controller side: open a new stream. Returns the streamId. */
  openStream(streamId: string): void {
    if (!this.isReady) {
      throw new AppError({ code: 'relay_not_ready', status: 503, message: 'Relay session is not ready.' })
    }
    this.streams.set(streamId, { bytesInFlight: 0, paused: false, sentBytes: 0, receivedBytes: 0, ackedBytes: 0, closed: false })
    this.sendEncryptedFrame({ kind: INNER_FRAME_KIND.streamOpen, streamId })
  }

  /**
   * Send data on a stream. The data is chunked to stay under the relayd frame
   * cap. The session always sends all of `data` (it does not partial-accept);
   * flow control is signaled back to the caller via onPauseStream/onResumeStream
   * — the caller must pause reading its local source when asked. A brief
   * overage of up to one chunk (≤ 256 KiB) past the credit window is absorbed
   * by relayd's 4 MiB queue and the peer's receive buffer, which keeps the
   * transport logic simple without risking a queue overrun.
   */
  writeStreamData(streamId: string, data: Uint8Array): void {
    const flow = this.streams.get(streamId)
    if (!flow || flow.closed || !this.isReady) {
      return
    }
    let offset = 0
    while (offset < data.length) {
      const chunkEnd = Math.min(offset + RELAY_MAX_STREAM_CHUNK_BYTES, data.length)
      const chunk = data.subarray(offset, chunkEnd)
      const seq = flow.sentBytes
      this.sendEncryptedFrame({
        kind: INNER_FRAME_KIND.streamData,
        streamId,
        seq,
        data: Buffer.from(chunk).toString('base64'),
      })
      flow.sentBytes += chunk.length
      flow.bytesInFlight += chunk.length
      offset = chunkEnd
    }
    if (flow.bytesInFlight >= RELAY_STREAM_CREDIT_BYTES && !flow.paused) {
      flow.paused = true
      this.cb.onPauseStream?.(streamId)
    }
  }

  /** Receiver side: acknowledge received bytes to release sender credit. */
  ackStream(streamId: string, ackedBytes: number): void {
    if (!this.isReady) {
      return
    }
    this.sendEncryptedFrame({ kind: INNER_FRAME_KIND.streamAck, streamId, ackedBytes })
  }

  /** Close a stream (either side). */
  closeStream(streamId: string, reason?: string): void {
    const flow = this.streams.get(streamId)
    if (!flow || flow.closed) {
      return
    }
    flow.closed = true
    this.sendEncryptedFrame({ kind: INNER_FRAME_KIND.streamClose, streamId, ...(reason ? { reason } : {}) })
  }

  private handleStreamOpen(streamId: string): void {
    if (this.streams.has(streamId)) {
      this.fail(new AppError({ code: 'relay_stream_duplicate', status: 400, message: `Stream ${streamId} already open.` }))
      return
    }
    this.streams.set(streamId, { bytesInFlight: 0, paused: false, sentBytes: 0, receivedBytes: 0, ackedBytes: 0, closed: false })
    this.cb.onStreamOpen?.(streamId)
  }

  private handleStreamData(streamId: string, dataBase64: string): void {
    const flow = this.streams.get(streamId)
    if (!flow || flow.closed) {
      return
    }
    const data = new Uint8Array(Buffer.from(dataBase64, 'base64'))
    flow.receivedBytes += data.length
    this.cb.onStreamData?.(streamId, data)

    // Ack cumulatively every ACK_INTERVAL_BYTES to release sender credit.
    if (flow.receivedBytes - flow.ackedBytes >= ACK_INTERVAL_BYTES) {
      flow.ackedBytes = flow.receivedBytes
      this.ackStream(streamId, flow.ackedBytes)
    }
  }

  private handleStreamAck(streamId: string, ackedBytes: number): void {
    const flow = this.streams.get(streamId)
    if (!flow) {
      return
    }
    if (ackedBytes > flow.sentBytes) {
      return
    }
    flow.ackedBytes = Math.max(flow.ackedBytes, ackedBytes)
    flow.bytesInFlight = flow.sentBytes - flow.ackedBytes
    if (flow.paused && flow.bytesInFlight < RELAY_STREAM_CREDIT_BYTES / 2) {
      flow.paused = false
      this.cb.onResumeStream?.(streamId)
    }
    this.cb.onStreamAck?.(streamId, ackedBytes)
  }

  private handleStreamCloseFrame(streamId: string, reason?: string): void {
    const flow = this.streams.get(streamId)
    if (flow) {
      flow.closed = true
    }
    this.cb.onStreamClose?.(streamId, reason)
  }

  private handlePeerClosed(env: RelayEnvelope): void {
    const parsed = peerClosedPayloadSchema.safeParse(env.payload)
    this.cb.onPeerClosed?.(parsed.success ? parsed.data.reason : undefined)
  }

  private handleRelayError(env: RelayEnvelope): void {
    const parsed = relayErrorPayloadSchema.safeParse(env.payload)
    this.fail(new AppError({
      code: 'relay_error',
      status: 502,
      message: parsed.success ? (parsed.data.error ?? 'relay error') : 'relay error',
    }))
  }

  // ── Frame send helpers ──

  private sendPlainEnvelope(payload: unknown): void {
    const env: RelayEnvelope = {
      version: RELAY_PROTOCOL_VERSION,
      roomId: this.roomId,
      seq: this.outboundSeq++,
      kind: RELAY_ENVELOPE_KIND.dataFrame,
      payload,
    }
    this.cb.send(JSON.stringify(env))
  }

  private sendEncryptedFrame(frame: InnerFrame): void {
    if (!this.sendCipher) {
      throw new AppError({ code: 'relay_not_ready', status: 503, message: 'Relay session keys not derived.' })
    }
    innerFrameSchema.parse(frame)
    const plaintext = Buffer.from(JSON.stringify(frame), 'utf8')
    const ciphertext = this.sendCipher.encrypt(new Uint8Array(plaintext))
    const payload = { ciphertext }
    encryptedPayloadSchema.parse(payload)
    this.sendPlainEnvelope(payload)
  }

  private parsePlainFrame(payload: unknown): InnerFrame {
    // Plaintext handshake frames arrive as bare JSON objects.
    const parsed = innerFrameSchema.safeParse(payload)
    if (!parsed.success) {
      throw new AppError({ code: 'relay_protocol_invalid_frame', status: 400, message: `Invalid inner frame: ${parsed.error.message}` })
    }
    return parsed.data
  }

  private decryptFrame(payload: unknown): InnerFrame {
    if (!this.receiveCipher) {
      throw new AppError({ code: 'relay_not_ready', status: 503, message: 'Relay session keys not derived.' })
    }
    const encryptedParsed = encryptedPayloadSchema.safeParse(payload)
    if (!encryptedParsed.success) {
      throw new AppError({ code: 'relay_protocol_invalid_payload', status: 400, message: 'Invalid encrypted payload.' })
    }
    const plaintext = this.receiveCipher.decrypt(encryptedParsed.data.ciphertext)
    let json: unknown
    try {
      json = JSON.parse(Buffer.from(plaintext).toString('utf8'))
    }
    catch (error) {
      throw new AppError({ code: 'relay_protocol_invalid_frame', status: 400, message: `Decrypted frame is not JSON: ${error instanceof Error ? error.message : String(error)}` })
    }
    const frameParsed = innerFrameSchema.safeParse(json)
    if (!frameParsed.success) {
      throw new AppError({ code: 'relay_protocol_invalid_frame', status: 400, message: `Invalid decrypted inner frame: ${frameParsed.error.message}` })
    }
    return frameParsed.data
  }

  private fail(error: Error): void {
    if (this.state === 'closed') {
      return
    }
    this.state = 'closed'
    this.cb.onError?.(error)
  }

  /** Tear down the session. Idempotent. */
  close(): void {
    if (this.state === 'closed') {
      return
    }
    this.state = 'closed'
    for (const streamId of [...this.streams.keys()]) {
      this.cb.onStreamClose?.(streamId, 'session closed')
    }
    this.streams.clear()
  }
}

function publicKeyFromPrivateKey(privateKeyBase64: string): string {
  return Buffer.from(x25519.scalarMultBase(new Uint8Array(Buffer.from(privateKeyBase64, 'base64')))).toString('base64')
}

function peerFingerprint(publicKeyBase64: string): string {
  return relayPublicKeyFingerprint(publicKeyBase64)
}
