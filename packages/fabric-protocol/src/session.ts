import { FabricProtocolError } from './error'
import type { FabricCipherSuite, FabricSessionEnvelope, FabricSessionEnvelopeKind, InnerFrame, RelayCompressionKind, RelayPriority } from './session-codec'
import {
  decodeInnerFrame,
  decodeRelayErrorPayload,
  decodeRelayPeerClosedPayload,
  encodeInnerFrame,
  FABRIC_CIPHER_SUITE,
  FABRIC_SESSION_ENVELOPE_KIND,
  FABRIC_SESSION_PROTOCOL_VERSION,
  INNER_FRAME_KIND,
  RELAY_CONNECTION_MAX_CREDIT_BYTES,
  RELAY_MAX_STREAM_CHUNK_BYTES,
  RELAY_STREAM_MAX_CREDIT_BYTES,
  RELAY_STREAM_MIN_CREDIT_BYTES,
  relayPriorityForInnerFrame,
} from './session-codec'
import type {
  FabricSessionKeys,
  FabricSessionRole as FabricCryptoRole,
  SecureRandomBytes,
} from './session-crypto'
import {
  computeFabricSharedSecret,
  deriveFabricSessionKeys,
  fabricPublicKeyFingerprint,
  FabricSessionCipher,
  publicKeyFromPrivate,
} from './session-crypto'

class FabricSessionError extends FabricProtocolError {
  constructor(input: { code: string, status: number, message: string }) {
    super(input.code, input.message)
  }
}

export interface FabricSessionEncodedChunk {
  data: Uint8Array
  compression: RelayCompressionKind
  uncompressedBytes: number
}

export interface FabricSessionCompressionCodec {
  readonly kind: 'zstd'
  readonly minInputBytes: number
  encode: (data: Uint8Array) => FabricSessionEncodedChunk
  decode: (chunk: FabricSessionEncodedChunk) => Uint8Array
}

export interface FabricSessionCipherCodec {
  encrypt: (plaintext: Uint8Array) => Uint8Array
  decrypt: (ciphertext: Uint8Array) => Uint8Array
}

export type FabricSessionCipherFactory = (
  key: Uint8Array,
  suite: FabricCipherSuite,
) => FabricSessionCipherCodec

/**
 * FabricSession — the protocol state machine shared by the controller and node
 * transports. It owns:
 *
 * 1. The Fabric certificate-bound `hello` handshake (ECDH → key derivation).
 * 2. Negotiated AEAD encryption and stream compression.
 * 3. Stream multiplexing over one Fabric link.
 * 4. Credit-based flow control so a fast sender can't overrun the relayd queue
 *    (64 frames / 4 MiB) or the peer.
 *
 * The session is transport-agnostic: it emits outbound bytes via `send` and
 * inbound stream events via callbacks. The controller-transport / node-connector
 * wire it to a WebSocket (to relayd) and to local TCP sockets.
 */

type FabricSessionRole = FabricCryptoRole

export interface FabricSessionOptions {
  /** Fabric identity that scopes key derivation for this link. */
  fabricId: string
  /** Fabric link identity that scopes routing and key derivation. */
  linkId: string
  /** Public encryption key from the peer's Fabric membership certificate. */
  expectedPeerPubkey: string
  /** Our public key (base64). Derived from the private key if not supplied. */
  ourPublicKeyBase64?: string
  /** Whether this side sends `hello` on start() (controller) or waits (node). Defaults to role === 'controller'. */
  initiateHello?: boolean
  /** Initial per-stream in-flight byte allowance. Defaults to 512 KiB. */
  initialStreamCreditBytes?: number
  /** Hard per-stream byte allowance. Defaults to 8 MiB. */
  maxStreamCreditBytes?: number
  /** Hard aggregate byte allowance across all streams. Defaults to 16 MiB. */
  maxConnectionCreditBytes?: number
  /** Supported AEAD suites. AES-256-GCM is the portable CryptoKit baseline. */
  supportedCipherSuites?: FabricCipherSuite[]
  /** Supported stream compression modes. `none` is the portable baseline. */
  supportedCompressions?: RelayCompressionKind[]
  /** Cryptographically secure randomness supplied by the platform runtime. */
  randomBytes: SecureRandomBytes
  /** Optional platform-optimized AEAD implementation. */
  cipherFactory?: FabricSessionCipherFactory
  /** Optional Zstandard implementation. Omit for the portable `none` mode. */
  compressionCodec?: FabricSessionCompressionCodec
  /**
   * Fabric v3 envelope encoding. Routing is owned by Fabric and is never
   * projected into this session state machine.
   */
  encodeOutboundEnvelope: (frame: FabricSessionOutboundEnvelope) => Uint8Array
}

export interface FabricSessionOutboundEnvelope {
  seq: number
  kind: FabricSessionEnvelopeKind
  priority: RelayPriority
  streamId?: string
  payload: Uint8Array
}

export interface FabricSessionCallbacks {
  /** Write one encoded binary envelope to relayd. */
  send: (data: Uint8Array) => void
  onReady?: () => void
  onNegotiatedCapabilities?: (capabilities: { cipherSuite: FabricCipherSuite, compression: RelayCompressionKind }) => void
  onPeerPubkey?: (peerPubkey: string, fingerprint: string) => void
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
  /** Local transport ended; send close after all accepted data is framed. */
  closeRequested: boolean
  closeReason?: string
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
    closeRequested: false,
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

function validatedCapabilities<T extends string>(values: T[], label: string): T[] {
  const unique = [...new Set(values)]
  if (unique.length === 0 || unique.length !== values.length) {
    throw new FabricSessionError({ code: 'relay_capabilities_invalid', status: 500, message: `Fabric Session ${label} must be non-empty and unique.` })
  }
  return unique
}

function selectCapability<T extends string>(preferred: T[], offered: T[]): T | null {
  return preferred.find(value => offered.includes(value)) ?? null
}

const ACK_INTERVAL_BYTES = 256 * 1024

export class FabricSession {
  readonly role: FabricSessionRole
  private readonly fabricId: string
  private readonly linkId: string
  private readonly ourPrivateKeyBase64: string
  private readonly ourPublicKeyBase64: string
  private readonly expectedPeerPubkey: string
  private readonly cb: FabricSessionCallbacks
  private readonly initiateHello: boolean

  private state: SessionState = 'idle'
  private peerPubkey: string | null = null
  private keys: FabricSessionKeys | null = null
  private sendCipher: FabricSessionCipherCodec | null = null
  private receiveCipher: FabricSessionCipherCodec | null = null
  private outboundSeq = 0
  private readonly streams = new Map<string, StreamFlowState>()
  /** Set when we've sent our hello, awaiting peer hello. */
  private helloSent = false
  private readonly initialStreamCreditBytes: number
  private readonly maxStreamCreditBytes: number
  private readonly maxConnectionCreditBytes: number
  private readonly supportedCipherSuites: FabricCipherSuite[]
  private readonly supportedCompressions: RelayCompressionKind[]
  private readonly randomBytes: SecureRandomBytes
  private readonly cipherFactory: FabricSessionCipherFactory
  private readonly compressionCodec?: FabricSessionCompressionCodec
  private selectedCipherSuite: FabricCipherSuite | null = null
  private selectedCompression: RelayCompressionKind | null = null
  private readonly encodeOutboundEnvelope: (frame: FabricSessionOutboundEnvelope) => Uint8Array
  private connectionInFlightBytes = 0
  private flushCursor = 0
  private flushingOutbound = false

  constructor(
    role: FabricSessionRole,
    ourPrivateKeyBase64: string,
    options: FabricSessionOptions,
    callbacks: FabricSessionCallbacks,
  ) {
    this.role = role
    this.fabricId = options.fabricId
    this.linkId = options.linkId
    this.ourPrivateKeyBase64 = ourPrivateKeyBase64
    this.expectedPeerPubkey = options.expectedPeerPubkey
    this.cb = callbacks
    this.ourPublicKeyBase64
      = options.ourPublicKeyBase64 ?? publicKeyFromPrivate(ourPrivateKeyBase64)
    // The controller initiates the hello exchange; the node waits for it. This
    // matches the Fabric model where the node is always-on and the controller
    // connects later — if the node sent hello first, relayd would close it
    // (TryAgainLater) because no controller peer is connected yet.
    this.initiateHello = options.initiateHello ?? role === 'controller'
    this.initialStreamCreditBytes
      = options.initialStreamCreditBytes ?? RELAY_STREAM_MIN_CREDIT_BYTES
    this.maxStreamCreditBytes = options.maxStreamCreditBytes ?? RELAY_STREAM_MAX_CREDIT_BYTES
    this.maxConnectionCreditBytes
      = options.maxConnectionCreditBytes ?? RELAY_CONNECTION_MAX_CREDIT_BYTES
    this.supportedCipherSuites = validatedCapabilities(
      options.supportedCipherSuites ?? [FABRIC_CIPHER_SUITE.aes256Gcm, FABRIC_CIPHER_SUITE.xchacha20Poly1305],
      'cipher suites',
    )
    this.supportedCompressions = validatedCapabilities(
      options.supportedCompressions ?? ['none'],
      'compression modes',
    )
    this.randomBytes = options.randomBytes
    this.cipherFactory = options.cipherFactory
      ?? ((key, suite) => new FabricSessionCipher(key, suite, this.randomBytes))
    this.compressionCodec = options.compressionCodec
    if (this.supportedCompressions.includes('zstd') && !this.compressionCodec) {
      throw new FabricSessionError({ code: 'relay_compression_codec_missing', status: 500, message: 'Fabric Session advertises Zstandard without a compression codec.' })
    }
    this.encodeOutboundEnvelope = options.encodeOutboundEnvelope
    if (
      !Number.isSafeInteger(this.initialStreamCreditBytes)
      || !Number.isSafeInteger(this.maxStreamCreditBytes)
      || !Number.isSafeInteger(this.maxConnectionCreditBytes)
      || this.initialStreamCreditBytes < RELAY_STREAM_MIN_CREDIT_BYTES
      || this.maxStreamCreditBytes < this.initialStreamCreditBytes
      || this.maxConnectionCreditBytes < this.initialStreamCreditBytes
    ) {
      throw new FabricSessionError({
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
   *  node waits and sends its hello reactively when the controller's arrives.
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
    // else: node waits for the controller's hello, then sends ours in handleHello.
  }

  /** Process a raw envelope received from relayd. */
  handleEnvelope(env: FabricSessionEnvelope): void {
    if (this.state === 'closed') {
      return
    }
    if (env.version !== FABRIC_SESSION_PROTOCOL_VERSION || env.linkId !== this.linkId) {
      this.fail(
        new FabricSessionError({
          code: 'relay_protocol_version',
          status: 400,
          message: `Unsupported relay protocol version ${env.version}`,
        }),
      )
      return
    }
    switch (env.kind) {
      case FABRIC_SESSION_ENVELOPE_KIND.dataFrame:
        this.handleDataFrame(env)
        break
      case FABRIC_SESSION_ENVELOPE_KIND.peerClosed:
        this.handlePeerClosed(env)
        break
      case FABRIC_SESSION_ENVELOPE_KIND.relayError:
        this.handleRelayError(env)
        break
      default:
        this.fail(
          new FabricSessionError({
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
      version: FABRIC_SESSION_PROTOCOL_VERSION,
      pubkey: this.ourPublicKeyBase64,
      selection: this.role === 'node',
      cipherSuites: this.role === 'node' && this.selectedCipherSuite
        ? [this.selectedCipherSuite]
        : this.supportedCipherSuites,
      compressions: this.role === 'node' && this.selectedCompression
        ? [this.selectedCompression]
        : this.supportedCompressions,
    }
    // Set helloSent BEFORE sendPlainEnvelope: sendPlainEnvelope is delivered
    // synchronously by the Fabric transport, which can re-enter handleHello →
    // sendHello before this call returns. Without this guard the node would
    // send a second, plaintext hello after keys are derived.
    this.helloSent = true
    this.sendPlainEnvelope(frame)
    this.maybeMarkReady()
  }

  private handleDataFrame(env: FabricSessionEnvelope): void {
    let frame: InnerFrame
    try {
      if (this.keys === null) {
        // Pre-key: only plaintext handshake frames are accepted.
        frame = this.parsePlainFrame(env.payload)
        if (frame.kind !== INNER_FRAME_KIND.hello) {
          this.fail(
            new FabricSessionError({
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
          : new FabricSessionError({
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
      case INNER_FRAME_KIND.streamOpen:
        this.handleStreamOpen(frame.streamId)
        break
      case INNER_FRAME_KIND.streamData:
        this.handleStreamData(frame)
        break
      case INNER_FRAME_KIND.streamAck:
        this.handleStreamAck(frame.streamId, frame.ackedBytes)
        break
      case INNER_FRAME_KIND.streamClose:
        this.handleStreamCloseFrame(frame.streamId, frame.reason)
        break
      default:
        this.fail(
          new FabricSessionError({
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
    selection: boolean
    cipherSuites: FabricCipherSuite[]
    compressions: RelayCompressionKind[]
  }): void {
    if (this.peerPubkey !== null) {
      this.fail(
        new FabricSessionError({
          code: 'relay_handshake_duplicate_hello',
          status: 400,
          message: 'Received duplicate hello frame.',
        }),
      )
      return
    }
    if (frame.version !== FABRIC_SESSION_PROTOCOL_VERSION) {
      this.fail(new FabricSessionError({ code: 'relay_handshake_version_mismatch', status: 400, message: `Unsupported Fabric Session hello version ${frame.version}.` }))
      return
    }
    if (frame.pubkey !== this.expectedPeerPubkey) {
      this.fail(
        new FabricSessionError({
          code: 'relay_handshake_pubkey_mismatch',
          status: 400,
          message: 'Peer public key does not match its Fabric membership certificate.',
        }),
      )
      return
    }

    if (this.role === 'node') {
      if (frame.selection) {
        this.fail(new FabricSessionError({ code: 'relay_handshake_invalid_offer', status: 400, message: 'Controller hello must offer Fabric Session capabilities.' }))
        return
      }
      this.selectedCipherSuite = selectCapability(this.supportedCipherSuites, frame.cipherSuites)
      this.selectedCompression = selectCapability(this.supportedCompressions, frame.compressions)
    }
    else {
      const selectedCipherSuite = frame.cipherSuites[0]
      const selectedCompression = frame.compressions[0]
      if (!frame.selection || frame.cipherSuites.length !== 1 || frame.compressions.length !== 1 || selectedCipherSuite === undefined || selectedCompression === undefined || !this.supportedCipherSuites.includes(selectedCipherSuite) || !this.supportedCompressions.includes(selectedCompression)) {
        this.fail(new FabricSessionError({ code: 'relay_handshake_invalid_selection', status: 400, message: 'Node selected unsupported Fabric Session capabilities.' }))
        return
      }
      this.selectedCipherSuite = selectedCipherSuite
      this.selectedCompression = selectedCompression
    }
    if (!this.selectedCipherSuite || !this.selectedCompression) {
      this.fail(new FabricSessionError({ code: 'relay_handshake_no_common_capability', status: 400, message: 'Fabric peers have no common cipher suite or compression mode.' }))
      return
    }

    this.peerPubkey = frame.pubkey
    this.cb.onPeerPubkey?.(frame.pubkey, peerFingerprint(frame.pubkey))
    this.deriveKeys()

    // Node (reactive): send our hello now that the controller has spoken, so
    // the controller can learn our pubkey and complete the handshake.
    if (!this.helloSent) {
      this.sendHello()
    }

    this.maybeMarkReady()
  }

  private deriveKeys(): void {
    if (!this.peerPubkey) {
      throw new Error('deriveKeys called before peer pubkey known')
    }
    const sharedSecret = computeFabricSharedSecret(this.ourPrivateKeyBase64, this.peerPubkey)
    this.keys = deriveFabricSessionKeys(sharedSecret, { fabricId: this.fabricId, linkId: this.linkId })
    this.sendCipher = this.cipherFactory(
      this.role === 'node' ? this.keys.nodeSendKey : this.keys.controllerSendKey,
      this.selectedCipherSuite!,
    )
    this.receiveCipher = this.cipherFactory(
      this.role === 'node' ? this.keys.controllerSendKey : this.keys.nodeSendKey,
      this.selectedCipherSuite!,
    )
  }

  private maybeMarkReady(): void {
    if (this.helloSent && this.peerPubkey !== null && this.keys !== null && this.selectedCipherSuite && this.selectedCompression) {
      this.markReady()
    }
  }

  private markReady(): void {
    if (this.state === 'ready') {
      return
    }
    this.state = 'ready'
    this.cb.onNegotiatedCapabilities?.({ cipherSuite: this.selectedCipherSuite!, compression: this.selectedCompression! })
    this.cb.onReady?.()
  }

  // ── Stream API (used by transports) ──

  /** Controller side: open a new stream. Returns the streamId. */
  openStream(streamId: string): void {
    if (!this.isReady) {
      throw new FabricSessionError({
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
    if (!flow || flow.closed || flow.closeRequested || !this.isReady) {
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
    if (
      !flow
      || flow.closed
      || !this.isReady
      || consumedBytes < 0
      || (consumedBytes === 0 && !options?.flush)
    ) {
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
    if (!flow || flow.closed || flow.closeRequested) {
      return
    }
    // Flush any unacked receive progress so the peer can release remaining credit.
    if (this.isReady && flow.appliedBytes < flow.receivedBytes) {
      flow.appliedBytes = flow.receivedBytes
    }
    this.maybeSendReceiveAck(streamId, flow, true)
    flow.closeRequested = true
    flow.closeReason = reason
    this.flushOutboundStreams()
    this.finishLocalCloseIfReady(streamId, flow)
  }

  private finishLocalCloseIfReady(streamId: string, flow: StreamFlowState): void {
    if (flow.closed || !flow.closeRequested || flow.pendingData.length > 0) {
      return
    }
    flow.closed = true
    this.connectionInFlightBytes = Math.max(
      0,
      this.connectionInFlightBytes - bytesInFlight(flow),
    )
    this.sendEncryptedFrame({
      kind: INNER_FRAME_KIND.streamClose,
      streamId,
      ...(flow.closeReason ? { reason: flow.closeReason } : {}),
    })
    this.streams.delete(streamId)
  }

  private handleStreamOpen(streamId: string): void {
    if (this.streams.has(streamId)) {
      this.fail(
        new FabricSessionError({
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

  private handleStreamData(frame: Extract<InnerFrame, { kind: 'stream_data' }>): void {
    const streamId = frame.streamId
    const flow = this.streams.get(streamId)
    if (!flow || flow.closed) {
      return
    }
    if (frame.seq !== flow.receivedBytes) {
      this.fail(
        new FabricSessionError({
          code: 'relay_stream_sequence_invalid',
          status: 400,
          message: `Unexpected stream sequence ${frame.seq}; expected ${flow.receivedBytes}.`,
        }),
      )
      return
    }
    if (frame.compression === 'zstd' && this.selectedCompression !== 'zstd') {
      this.fail(new FabricSessionError({ code: 'relay_protocol_unnegotiated_compression', status: 400, message: 'Peer used Zstandard without negotiating it.' }))
      return
    }
    const chunk = {
      data: frame.data,
      compression: frame.compression ?? 'none',
      uncompressedBytes: frame.uncompressedBytes ?? frame.data.byteLength,
    } satisfies FabricSessionEncodedChunk
    const data = chunk.compression === 'zstd'
      ? this.compressionCodec!.decode(chunk)
      : decodeRawChunk(chunk)
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
    this.connectionInFlightBytes = Math.max(0, this.connectionInFlightBytes - releasedBytes)
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
      this.connectionInFlightBytes = Math.max(
        0,
        this.connectionInFlightBytes - bytesInFlight(flow),
      )
      flow.closed = true
      this.streams.delete(streamId)
    }
    this.cb.onStreamClose?.(streamId, reason)
  }

  private flushOutboundStreams(): void {
    if (this.flushingOutbound) {
      return
    }
    this.flushingOutbound = true
    try {
      const streams = [...this.streams.entries()].filter(([, flow]) => !flow.closed)
      if (streams.length === 0) {
        return
      }
      let madeProgress = true
      while (madeProgress && this.connectionInFlightBytes < this.maxConnectionCreditBytes) {
        madeProgress = false
        for (let offset = 0; offset < streams.length; offset++) {
          const index = (this.flushCursor + offset) % streams.length
          const [streamId, flow] = streams[index]!
          if (this.flushOutboundChunk(streamId, flow)) {
            madeProgress = true
            this.flushCursor = (index + 1) % streams.length
          }
          if (this.connectionInFlightBytes >= this.maxConnectionCreditBytes) {
            break
          }
        }
      }
      for (const [streamId, flow] of streams) {
        this.finishLocalCloseIfReady(streamId, flow)
      }
    }
    finally {
      this.flushingOutbound = false
    }
  }

  private flushOutboundChunk(streamId: string, flow: StreamFlowState): boolean {
    if (
      flow.closed
      || flow.pendingData.length === 0
      || bytesInFlight(flow) >= flow.creditBytes
      || this.connectionInFlightBytes >= this.maxConnectionCreditBytes
    ) {
      return false
    }
    const pending = flow.pendingData[0]!
    const capacity = Math.min(
      flow.creditBytes - bytesInFlight(flow),
      this.maxConnectionCreditBytes - this.connectionInFlightBytes,
    )
    const length = Math.min(pending.byteLength, capacity, RELAY_MAX_STREAM_CHUNK_BYTES)
    if (length <= 0) {
      return false
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
    this.connectionInFlightBytes += chunk.byteLength
    if (this.selectedCompression !== 'zstd' || !this.compressionCodec || chunk.byteLength < this.compressionCodec.minInputBytes) {
      this.sendEncryptedFrame({
        kind: INNER_FRAME_KIND.streamData,
        streamId,
        seq,
        data: chunk,
      })
      return true
    }
    const encoded = this.compressionCodec.encode(chunk)
    this.sendEncryptedFrame({
      kind: INNER_FRAME_KIND.streamData,
      streamId,
      seq,
      data: encoded.data,
      ...(encoded.compression === 'zstd'
        ? { compression: 'zstd', uncompressedBytes: encoded.uncompressedBytes }
        : {}),
    })
    return true
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

  private handlePeerClosed(env: FabricSessionEnvelope): void {
    try {
      this.cb.onPeerClosed?.(decodeRelayPeerClosedPayload(env.payload).reason)
    }
 catch {
      this.cb.onPeerClosed?.()
    }
  }

  private handleRelayError(env: FabricSessionEnvelope): void {
    let message = 'relay error'
    try {
      message = decodeRelayErrorPayload(env.payload).error ?? message
    }
 catch {
      // Keep a stable error when the untrusted control payload is malformed.
    }
    this.fail(
      new FabricSessionError({
        code: 'relay_error',
        status: 502,
        message,
      }),
    )
  }

  // ── Frame send helpers ──

  private sendPlainEnvelope(frame: InnerFrame): void {
    const streamId = streamIdForFrame(frame)
    const env: FabricSessionOutboundEnvelope = {
      seq: this.outboundSeq++,
      kind: FABRIC_SESSION_ENVELOPE_KIND.dataFrame,
      priority: relayPriorityForInnerFrame(frame),
      ...(streamId ? { streamId } : {}),
      payload: encodeInnerFrame(frame),
    }
    this.cb.send(this.encodeOutboundEnvelope(env))
  }

  private sendEncryptedFrame(frame: InnerFrame): void {
    if (!this.sendCipher) {
      throw new FabricSessionError({
        code: 'relay_not_ready',
        status: 503,
        message: 'Relay session keys not derived.',
      })
    }
    const streamId = streamIdForFrame(frame)
    const env: FabricSessionOutboundEnvelope = {
      seq: this.outboundSeq++,
      kind: FABRIC_SESSION_ENVELOPE_KIND.dataFrame,
      priority: relayPriorityForInnerFrame(frame),
      ...(streamId ? { streamId } : {}),
      payload: this.sendCipher.encrypt(encodeInnerFrame(frame)),
    }
    this.cb.send(this.encodeOutboundEnvelope(env))
  }

  private parsePlainFrame(payload: Uint8Array): InnerFrame {
    return decodeInnerFrame(payload)
  }

  private decryptFrame(payload: Uint8Array): InnerFrame {
    if (!this.receiveCipher) {
      throw new FabricSessionError({
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
    this.connectionInFlightBytes = 0
  }
}

function peerFingerprint(publicKeyBase64: string): string {
  return fabricPublicKeyFingerprint(publicKeyBase64)
}

function decodeRawChunk(chunk: FabricSessionEncodedChunk): Uint8Array {
  if (chunk.data.byteLength !== chunk.uncompressedBytes) {
    throw new FabricSessionError({ code: 'relay_protocol_invalid_compression', status: 400, message: 'Raw Relay chunk length does not match its declared length.' })
  }
  return chunk.data
}
