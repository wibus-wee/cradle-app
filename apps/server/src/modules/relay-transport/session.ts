import { timingSafeEqual } from 'node:crypto'

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
  decodeInnerFrame,
  decodeRelayErrorPayload,
  decodeRelayPeerClosedPayload,
  encodeInnerFrame,
  encodeRelayEnvelope,
  INNER_FRAME_KIND,
  RELAY_CONNECTION_MAX_CREDIT_BYTES,
  RELAY_ENVELOPE_KIND,
  RELAY_MAX_STREAM_CHUNK_BYTES,
  RELAY_PROTOCOL_VERSION,
  RELAY_STREAM_MAX_CREDIT_BYTES,
  RELAY_STREAM_MIN_CREDIT_BYTES,
  relayPriorityForInnerFrame,
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
  /** Initial per-stream in-flight byte allowance. Defaults to 512 KiB. */
  initialStreamCreditBytes?: number
  /** Hard per-stream byte allowance. Defaults to 8 MiB. */
  maxStreamCreditBytes?: number
  /** Hard aggregate byte allowance across all streams. Defaults to 16 MiB. */
  maxConnectionCreditBytes?: number
}

export interface RelaySessionCallbacks {
  /** Write one encoded binary envelope to relayd. */
  send: (data: Uint8Array) => void
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
  /** Whether the local source is currently paused due to flow control. */
  paused: boolean
  creditBytes: number
  pendingData: Uint8Array[]
  /** Total plaintext bytes sent on this stream. */
  sentBytes: number
  /**
   * Cumulative bytes the peer has acked for data *we* sent (send-side credit).
   * Independent of receive-side counters — HTTP request+response share one
   * streamId, so send credit and receive progress must not share a counter.
   */
  peerAckedBytes: number
  ackedSinceCreditIncrease: number
  /** Total plaintext bytes delivered to the local transport callback. */
  receivedBytes: number
  /** Cumulative bytes the local transport has applied (TCP write / drain). */
  appliedBytes: number
  /** Last cumulative value we advertised to the peer via stream_ack. */
  ackedToPeerBytes: number
  closed: boolean
}

function createStreamFlowState(creditBytes: number): StreamFlowState {
  return {
    paused: false,
    creditBytes,
    pendingData: [],
    sentBytes: 0,
    peerAckedBytes: 0,
    ackedSinceCreditIncrease: 0,
    receivedBytes: 0,
    appliedBytes: 0,
    ackedToPeerBytes: 0,
    closed: false,
  }
}

function bytesInFlight(flow: StreamFlowState): number {
  return Math.max(0, flow.sentBytes - flow.peerAckedBytes)
}

function streamIdForFrame(frame: InnerFrame): string | undefined {
  switch (frame.kind) {
    case INNER_FRAME_KIND.streamOpen:
    case INNER_FRAME_KIND.streamData:
    case INNER_FRAME_KIND.streamAck:
    case INNER_FRAME_KIND.streamClose:
      return frame.streamId
    default:
      return undefined
  }
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
  private readonly initialStreamCreditBytes: number
  private readonly maxStreamCreditBytes: number
  private readonly maxConnectionCreditBytes: number

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
    this.ourPublicKeyBase64
      = options.ourPublicKeyBase64 ?? publicKeyFromPrivateKey(ourPrivateKeyBase64)
    this.isReconnect = Boolean(options.pinnedPeerPubkey)
    // The controller initiates the hello exchange; the host waits for it. This
    // matches the relay model where the host is always-on and the controller
    // connects later — if the host sent hello first, relayd would close it
    // (TryAgainLater) because no controller peer is connected yet.
    this.initiateHello = options.initiateHello ?? role === 'controller'
    this.ourName = options.ourName
    this.ourSigningPubkey = options.ourSigningPubkey
    this.initialStreamCreditBytes
      = options.initialStreamCreditBytes ?? RELAY_STREAM_MIN_CREDIT_BYTES
    this.maxStreamCreditBytes = options.maxStreamCreditBytes ?? RELAY_STREAM_MAX_CREDIT_BYTES
    this.maxConnectionCreditBytes
      = options.maxConnectionCreditBytes ?? RELAY_CONNECTION_MAX_CREDIT_BYTES
    if (
      !Number.isSafeInteger(this.initialStreamCreditBytes)
      || !Number.isSafeInteger(this.maxStreamCreditBytes)
      || !Number.isSafeInteger(this.maxConnectionCreditBytes)
      || this.initialStreamCreditBytes < RELAY_STREAM_MIN_CREDIT_BYTES
      || this.maxStreamCreditBytes < this.initialStreamCreditBytes
      || this.maxConnectionCreditBytes < this.initialStreamCreditBytes
    ) {
      throw new AppError({
        code: 'relay_credit_config_invalid',
        status: 500,
        message: 'Relay stream or connection credit bounds are invalid.',
      })
    }
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
      this.fail(
        new AppError({
          code: 'relay_protocol_version',
          status: 400,
          message: `Unsupported relay protocol version ${env.version}`,
        }),
      )
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
        this.fail(
          new AppError({
            code: 'relay_protocol_unknown_kind',
            status: 400,
            message: `Unknown relay envelope kind ${env.kind}`,
          }),
        )
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
          this.fail(
            new AppError({
              code: 'relay_handshake_unexpected_frame',
              status: 400,
              message: `Unexpected pre-handshake frame ${frame.kind}`,
            }),
          )
          return
        }
      }
 else {
        frame = this.decryptFrame(env.payload)
      }
    }
 catch (error) {
      this.fail(
        error instanceof Error
          ? error
          : new AppError({
              code: 'relay_protocol_invalid_frame',
              status: 400,
              message: String(error),
            }),
      )
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
        this.fail(
          new AppError({
            code: 'relay_protocol_unknown_frame',
            status: 400,
            message: `Unknown inner frame kind ${(frame as { kind: string }).kind}`,
          }),
        )
    }
  }

  private handleHello(frame: {
    kind: 'hello'
    version: number
    pubkey: string
    pinnedPubkey?: string
    name?: string
    signingPubkey?: string
  }): void {
    if (this.peerPubkey !== null) {
      this.fail(
        new AppError({
          code: 'relay_handshake_duplicate_hello',
          status: 400,
          message: 'Received duplicate hello frame.',
        }),
      )
      return
    }
    // Reconnect: the peer's pubkey must match the pinned value.
    if (this.isReconnect) {
      if (!this.pinnedPeerPubkey || frame.pubkey !== this.pinnedPeerPubkey) {
        this.fail(
          new AppError({
            code: 'relay_handshake_pubkey_mismatch',
            status: 400,
            message: 'Peer public key does not match the pinned value.',
          }),
        )
        return
      }
    }
    // The peer's pinnedPubkey (if any) must match ours too.
    if (frame.pinnedPubkey && frame.pinnedPubkey !== this.ourPublicKeyBase64) {
      this.fail(
        new AppError({
          code: 'relay_handshake_pubkey_mismatch',
          status: 400,
          message: 'Peer expected a different local public key.',
        }),
      )
      return
    }

    this.peerPubkey = frame.pubkey
    this.cb.onPeerPubkey?.(frame.pubkey, peerFingerprint(frame.pubkey))
    if (frame.name || frame.signingPubkey) {
      this.cb.onPeerInfo?.({
        ...(frame.name ? { name: frame.name } : {}),
        ...(frame.signingPubkey ? { signingPubkey: frame.signingPubkey } : {}),
      })
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
    this.sendCipher = new RelayCipher(
      this.role === 'host' ? this.keys.hostSendKey : this.keys.controllerSendKey,
    )
    this.receiveCipher = new RelayCipher(
      this.role === 'host' ? this.keys.controllerSendKey : this.keys.hostSendKey,
    )
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
      this.fail(
        new AppError({
          code: 'relay_handshake_unexpected_confirm',
          status: 400,
          message: 'Unexpected hello_confirm frame.',
        }),
      )
      return
    }
    const sharedSecret = computeRelaySharedSecret(this.ourPrivateKeyBase64, this.peerPubkey)
    const expected = this.buildConfirm(sharedSecret)
    if (!confirmEquals(frame.confirm, expected)) {
      this.fail(
        new AppError({
          code: 'relay_handshake_confirm_mismatch',
          status: 400,
          message: 'Pairing confirmation failed. Check the pairing code.',
        }),
      )
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
      throw new AppError({
        code: 'relay_not_ready',
        status: 503,
        message: 'Relay session is not ready.',
      })
    }
    this.streams.set(streamId, createStreamFlowState(this.initialStreamCreditBytes))
    this.sendEncryptedFrame({ kind: INNER_FRAME_KIND.streamOpen, streamId })
  }

  /**
   * Send data on a stream. The data is chunked to stay under the relayd frame
   * cap. The session always sends all of `data` (it does not partial-accept);
   * flow control is signaled back to the caller via onPauseStream/onResumeStream
   * — the caller must pause reading its local source when asked. Per-stream
   * and connection-wide credit bounds keep aggregate in-flight data within a
   * fixed memory budget even when many streams are active.
   */
  writeStreamData(streamId: string, data: Uint8Array): void {
    const flow = this.streams.get(streamId)
    if (!flow || flow.closed || !this.isReady) {
      return
    }
    flow.pendingData.push(data)
    this.flushOutboundStreams()
    if ((flow.pendingData.length > 0 || bytesInFlight(flow) >= flow.creditBytes) && !flow.paused) {
      flow.paused = true
      this.cb.onPauseStream?.(streamId)
    }
  }

  /**
   * Receiver side: report that `consumedBytes` of previously delivered stream
   * data have been applied locally (TCP write success / drain). Credit is
   * released to the peer only after real consumption so a slow local consumer
   * cannot inflate the window.
   *
   * Cumulative `stream_ack` frames are emitted every {@link ACK_INTERVAL_BYTES}.
   * Pass `flush: true` (or close the stream) to advertise any remainder.
   */
  reportStreamDataConsumed(
    streamId: string,
    consumedBytes: number,
    options?: { flush?: boolean },
  ): void {
    const flow = this.streams.get(streamId)
    if (!flow || flow.closed || !this.isReady || consumedBytes <= 0) {
      return
    }
    flow.appliedBytes = Math.min(flow.receivedBytes, flow.appliedBytes + consumedBytes)
    this.maybeSendReceiveAck(streamId, flow, Boolean(options?.flush))
  }

  /**
   * Receiver side: acknowledge applied bytes to release sender credit.
   * Prefer {@link reportStreamDataConsumed} so credit tracks real drain;
   * this remains for tests and explicit cumulative acks.
   */
  ackStream(streamId: string, ackedBytes: number): void {
    const flow = this.streams.get(streamId)
    if (!flow || flow.closed || !this.isReady) {
      return
    }
    if (ackedBytes < flow.ackedToPeerBytes || ackedBytes > flow.receivedBytes) {
      return
    }
    flow.appliedBytes = Math.max(flow.appliedBytes, ackedBytes)
    flow.ackedToPeerBytes = ackedBytes
    this.sendEncryptedFrame({ kind: INNER_FRAME_KIND.streamAck, streamId, ackedBytes })
  }

  private maybeSendReceiveAck(streamId: string, flow: StreamFlowState, flush: boolean): void {
    if (!this.isReady) {
      return
    }
    const pending = flow.appliedBytes - flow.ackedToPeerBytes
    if (pending <= 0) {
      return
    }
    if (!flush && pending < ACK_INTERVAL_BYTES) {
      return
    }
    flow.ackedToPeerBytes = flow.appliedBytes
    this.sendEncryptedFrame({
      kind: INNER_FRAME_KIND.streamAck,
      streamId,
      ackedBytes: flow.ackedToPeerBytes,
    })
  }

  /** Close a stream (either side). */
  closeStream(streamId: string, reason?: string): void {
    const flow = this.streams.get(streamId)
    if (!flow || flow.closed) {
      return
    }
    // Flush any unacked receive progress so the peer can release remaining credit.
    if (this.isReady && flow.appliedBytes < flow.receivedBytes) {
      flow.appliedBytes = flow.receivedBytes
    }
    this.maybeSendReceiveAck(streamId, flow, true)
    flow.closed = true
    this.sendEncryptedFrame({
      kind: INNER_FRAME_KIND.streamClose,
      streamId,
      ...(reason ? { reason } : {}),
    })
    this.streams.delete(streamId)
  }

  private handleStreamOpen(streamId: string): void {
    if (this.streams.has(streamId)) {
      this.fail(
        new AppError({
          code: 'relay_stream_duplicate',
          status: 400,
          message: `Stream ${streamId} already open.`,
        }),
      )
      return
    }
    this.streams.set(streamId, createStreamFlowState(this.initialStreamCreditBytes))
    this.cb.onStreamOpen?.(streamId)
  }

  private handleStreamData(streamId: string, data: Uint8Array): void {
    const flow = this.streams.get(streamId)
    if (!flow || flow.closed) {
      return
    }
    flow.receivedBytes += data.length
    // Deliver first; credit is released only when the transport reports the
    // bytes were applied (TCP write success / drain). See reportStreamDataConsumed.
    this.cb.onStreamData?.(streamId, data)
  }

  private handleStreamAck(streamId: string, ackedBytes: number): void {
    const flow = this.streams.get(streamId)
    if (!flow) {
      return
    }
    if (ackedBytes > flow.sentBytes) {
      return
    }
    const previousAckedBytes = flow.peerAckedBytes
    // Send-side credit only — never touch receive-side counters here.
    flow.peerAckedBytes = Math.max(flow.peerAckedBytes, ackedBytes)
    const releasedBytes = flow.peerAckedBytes - previousAckedBytes
    flow.ackedSinceCreditIncrease += releasedBytes
    if (
      flow.ackedSinceCreditIncrease >= flow.creditBytes / 2
      && flow.creditBytes < this.maxStreamCreditBytes
    ) {
      flow.creditBytes = Math.min(this.maxStreamCreditBytes, flow.creditBytes * 2)
      flow.ackedSinceCreditIncrease = 0
    }
    this.flushOutboundStreams()
    this.updatePausedStreams()
    this.cb.onStreamAck?.(streamId, ackedBytes)
  }

  private handleStreamCloseFrame(streamId: string, reason?: string): void {
    const flow = this.streams.get(streamId)
    if (flow) {
      flow.closed = true
      this.streams.delete(streamId)
    }
    this.cb.onStreamClose?.(streamId, reason)
  }

  private connectionBytesInFlight(): number {
    let total = 0
    for (const flow of this.streams.values()) {
      if (!flow.closed) {
        total += bytesInFlight(flow)
      }
    }
    return total
  }

  private flushOutboundStreams(): void {
    for (const [streamId, flow] of this.streams) {
      this.flushOutboundStream(streamId, flow)
      if (this.connectionBytesInFlight() >= this.maxConnectionCreditBytes) {
        break
      }
    }
  }

  private flushOutboundStream(streamId: string, flow: StreamFlowState): void {
    while (
      flow.pendingData.length > 0
      && bytesInFlight(flow) < flow.creditBytes
      && this.connectionBytesInFlight() < this.maxConnectionCreditBytes
    ) {
      const pending = flow.pendingData[0]
      const capacity = Math.min(
        flow.creditBytes - bytesInFlight(flow),
        this.maxConnectionCreditBytes - this.connectionBytesInFlight(),
      )
      const length = Math.min(pending.byteLength, capacity, RELAY_MAX_STREAM_CHUNK_BYTES)
      if (length <= 0) {
        break
      }
      const chunk = pending.subarray(0, length)
      if (length === pending.byteLength) {
        flow.pendingData.shift()
      }
 else {
        flow.pendingData[0] = pending.subarray(length)
      }
      const seq = flow.sentBytes
      flow.sentBytes += chunk.byteLength
      this.sendEncryptedFrame({ kind: INNER_FRAME_KIND.streamData, streamId, seq, data: chunk })
    }
  }

  private updatePausedStreams(): void {
    for (const [streamId, flow] of this.streams) {
      if (
        flow.paused
        && flow.pendingData.length === 0
        && bytesInFlight(flow) < flow.creditBytes / 2
      ) {
        flow.paused = false
        this.cb.onResumeStream?.(streamId)
      }
    }
  }

  private handlePeerClosed(env: RelayEnvelope): void {
    try {
      this.cb.onPeerClosed?.(decodeRelayPeerClosedPayload(env.payload).reason)
    }
 catch {
      this.cb.onPeerClosed?.()
    }
  }

  private handleRelayError(env: RelayEnvelope): void {
    let message = 'relay error'
    try {
      message = decodeRelayErrorPayload(env.payload).error ?? message
    }
 catch {
      // Keep a stable error when the untrusted control payload is malformed.
    }
    this.fail(
      new AppError({
        code: 'relay_error',
        status: 502,
        message,
      }),
    )
  }

  // ── Frame send helpers ──

  private sendPlainEnvelope(frame: InnerFrame): void {
    const env: RelayEnvelope = {
      version: RELAY_PROTOCOL_VERSION,
      roomId: this.roomId,
      seq: this.outboundSeq++,
      kind: RELAY_ENVELOPE_KIND.dataFrame,
      priority: relayPriorityForInnerFrame(frame),
      ...(streamIdForFrame(frame) ? { streamId: streamIdForFrame(frame) } : {}),
      payload: encodeInnerFrame(frame),
    }
    this.cb.send(encodeRelayEnvelope(env))
  }

  private sendEncryptedFrame(frame: InnerFrame): void {
    if (!this.sendCipher) {
      throw new AppError({
        code: 'relay_not_ready',
        status: 503,
        message: 'Relay session keys not derived.',
      })
    }
    const env: RelayEnvelope = {
      version: RELAY_PROTOCOL_VERSION,
      roomId: this.roomId,
      seq: this.outboundSeq++,
      kind: RELAY_ENVELOPE_KIND.dataFrame,
      priority: relayPriorityForInnerFrame(frame),
      ...(streamIdForFrame(frame) ? { streamId: streamIdForFrame(frame) } : {}),
      payload: this.sendCipher.encrypt(encodeInnerFrame(frame)),
    }
    this.cb.send(encodeRelayEnvelope(env))
  }

  private parsePlainFrame(payload: Uint8Array): InnerFrame {
    return decodeInnerFrame(payload)
  }

  private decryptFrame(payload: Uint8Array): InnerFrame {
    if (!this.receiveCipher) {
      throw new AppError({
        code: 'relay_not_ready',
        status: 503,
        message: 'Relay session keys not derived.',
      })
    }
    return decodeInnerFrame(this.receiveCipher.decrypt(payload))
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
  return Buffer.from(
    x25519.scalarMultBase(new Uint8Array(Buffer.from(privateKeyBase64, 'base64'))),
  ).toString('base64')
}

function peerFingerprint(publicKeyBase64: string): string {
  return relayPublicKeyFingerprint(publicKeyBase64)
}

/** Constant-time compare of base64-encoded confirm digests (or any equal-length secrets). */
function confirmEquals(actual: string, expected: string): boolean {
  const a = Buffer.from(actual)
  const b = Buffer.from(expected)
  if (a.length !== b.length) {
    // Still run a dummy compare so length leaks are the only timing channel.
    timingSafeEqual(b, b)
    return false
  }
  return timingSafeEqual(a, b)
}
