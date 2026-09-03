import type { MembershipCertificate } from '@cradle/fabric-protocol'
import {
  createFabricAuthHeaderValues,
  decodeFabricEnvelope,
  encodeFabricEnvelope,
  FabricSession,
  RELAY_MAX_STREAM_CHUNK_BYTES,
  toFabricSessionEnvelope,
  verifyFabricCertificate,
} from '@cradle/fabric-protocol'
import { Platform } from 'react-native'

import { mobileFabricRuntime } from '@/features/fabric/fabric-runtime'

import type { SerializedFabricHttpRequest } from './fabric-http-codec'
import {
  FabricHttpResponseDecoder,
  serializeFabricHttpRequest,
} from './fabric-http-codec'
import { FabricTransportError, shouldRetryFabricRead } from './fabric-retry-policy'
import type { CradleResponse, CradleTransport } from './types'

export { FabricTransportError } from './fabric-retry-policy'

const SESSION_READY_TIMEOUT_MS = 15_000
const LINK_EXPIRY_MARGIN_MS = 30_000
const READ_RETRY_DELAY_MS = 250

interface OpenLinkResponse {
  linkId: string
  expiresAt: string
  nodeCertificate: MembershipCertificate
}

interface RelayErrorBody {
  error?: string
  message?: string
}

interface StreamState {
  decoder: FabricHttpResponseDecoder
  requestBytes: Uint8Array
  requestOffset: number
  paused: boolean
  removeAbortListener: () => void
}

interface ReactNativeWebSocketConstructor {
  new (
    url: string,
    protocols: string[] | null,
    options: { headers: Record<string, string> },
  ): WebSocket
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: Error) => void
}

export type FabricTransportStatus
  = 'idle' | 'connecting' | 'connected' | 'offline' | 'access-denied' | 'suspended'

export interface FabricHttpTransportCallbacks {
  onStatusChange?: (status: FabricTransportStatus, error?: string) => void
}

export interface FabricTransportIdentity {
  relayUrl: string
  fabricId: string
  ownerPubkey: string
  controllerCertificate: MembershipCertificate
}

export interface FabricTransportCredentials {
  identityPrivateKeyBase64: string
  encryptionPrivateKeyBase64: string
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer
}

function websocketUrl(relayUrl: string, path: string): string {
  const url = new URL(path, `${relayUrl}/`)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

function abortError(): Error {
  const error = new Error('The request was aborted.')
  error.name = 'AbortError'
  return error
}

function isAccessDenied(error: Error): boolean {
  return error instanceof FabricTransportError
    && [401, 403].includes(error.status ?? 0)
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  let reject!: Deferred<T>['reject']
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

async function relayJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const body = await response.json().catch(() => null) as RelayErrorBody | null
    throw new FabricTransportError(
      body?.message ?? body?.error ?? `Fabric Relay returned ${response.status}.`,
      response.status,
    )
  }
  return await response.json() as T
}

/** One multiplexed, certificate-bound Fabric link for a selected Node. */
export class FabricHttpTransport implements CradleTransport {
  private socket: WebSocket | null = null
  private session: FabricSession | null = null
  private connectPromise: Promise<void> | null = null
  private connectAbort: AbortController | null = null
  private linkExpiresAt = 0
  private active = true
  private readonly streams = new Map<string, StreamState>()

  constructor(
    private readonly membership: FabricTransportIdentity,
    private readonly secrets: FabricTransportCredentials,
    private readonly nodeId: string,
    private readonly callbacks: FabricHttpTransportCallbacks = {},
  ) {}

  async request(path: string, init: RequestInit): Promise<CradleResponse> {
    if (!this.active) {
      throw new FabricTransportError('Fabric is suspended while Cradle is in the background.')
    }
    if (init.signal?.aborted) {
      throw abortError()
    }
    const serialized = serializeFabricHttpRequest(path, init)
    try {
      return await this.requestOnce(serialized, init)
    }
    catch (cause) {
      const error = cause as Error
      if (!shouldRetryFabricRead(serialized.method, init, error)) {
        throw error
      }
      await new Promise(resolve => setTimeout(resolve, READ_RETRY_DELAY_MS))
      if (init.signal?.aborted) {
        throw abortError()
      }
      if (!this.active) {
        throw error
      }
      return await this.requestOnce(serialized, init)
    }
  }

  private async requestOnce(
    serialized: SerializedFabricHttpRequest,
    init: RequestInit,
  ): Promise<CradleResponse> {
    await this.ensureReady()
    if (init.signal?.aborted) {
      throw abortError()
    }
    const session = this.session
    if (!session?.isReady) {
      throw new FabricTransportError('The Fabric link is not ready.')
    }

    const streamId = `http_${mobileFabricRuntime.randomId().replaceAll('-', '')}`
    const decoder = new FabricHttpResponseDecoder(serialized.method, {
      onConsumed: (bytes, flush) => {
        if (bytes > 0 || flush) {
          this.session?.reportStreamDataConsumed(streamId, bytes, { flush })
        }
      },
      onCancel: reason => this.cancelStream(streamId, reason),
    })
    const abort = () => decoder.abort()
    init.signal?.addEventListener('abort', abort, { once: true })
    const state: StreamState = {
      decoder,
      requestBytes: serialized.bytes,
      requestOffset: 0,
      paused: false,
      removeAbortListener: () => init.signal?.removeEventListener('abort', abort),
    }
    this.streams.set(streamId, state)
    try {
      session.openStream(streamId)
      this.pumpRequest(streamId)
    }
    catch (cause) {
      this.removeStream(streamId)
      decoder.fail(cause as Error)
    }
    return await decoder.response
  }

  close(reason = 'Fabric link suspended'): void {
    this.active = false
    this.connectAbort?.abort(new FabricTransportError(reason))
    this.failActiveLink(new FabricTransportError(reason))
    this.callbacks.onStatusChange?.('idle')
  }

  setActive(active: boolean): void {
    this.active = active
    if (!active) {
      this.close('Fabric link suspended while Cradle is in the background.')
      this.callbacks.onStatusChange?.('suspended')
    }
    else {
      this.callbacks.onStatusChange?.('idle')
    }
  }

  private ensureReady(): Promise<void> {
    if (
      this.socket?.readyState === WebSocket.OPEN
      && this.session?.isReady
      && (
        this.linkExpiresAt - LINK_EXPIRY_MARGIN_MS > Date.now()
        || this.streams.size > 0
      )
    ) {
      return Promise.resolve()
    }
    if (this.connectPromise) {
      return this.connectPromise
    }
    if (this.streams.size === 0 && (this.socket || this.session)) {
      this.failActiveLink(new FabricTransportError('Rotating the expired Fabric link.'))
    }
    this.callbacks.onStatusChange?.('connecting')
    const controller = new AbortController()
    const connectPromise = this.connect(controller.signal)
      .catch((cause) => {
        const error = cause as Error
        if (!controller.signal.aborted) {
          this.callbacks.onStatusChange?.(
            isAccessDenied(error) ? 'access-denied' : 'offline',
            error.message,
          )
        }
        throw error
      })
      .finally(() => {
        if (this.connectPromise === connectPromise) {
          this.connectPromise = null
        }
        if (this.connectAbort === controller) {
          this.connectAbort = null
        }
      })
    this.connectAbort = controller
    this.connectPromise = connectPromise
    return connectPromise
  }

  private async connect(signal: AbortSignal): Promise<void> {
    if (Platform.OS === 'web') {
      throw new FabricTransportError('Fabric transport requires the native iOS or Android app.')
    }
    const linkPath = `/v1/nodes/${encodeURIComponent(this.nodeId)}/links`
    const authHeaders = createFabricAuthHeaderValues(
      this.membership.controllerCertificate,
      this.secrets.identityPrivateKeyBase64,
      'POST',
      linkPath,
      mobileFabricRuntime,
    )
    const link = await relayJson<OpenLinkResponse>(
      `${this.membership.relayUrl}${linkPath}`,
      { method: 'POST', headers: authHeaders, signal },
    )
    this.assertConnectionActive(signal)
    this.validateLink(link)

    const wsPath = `/v1/ws/controllers/${encodeURIComponent(link.linkId)}`
    const wsHeaders = createFabricAuthHeaderValues(
      this.membership.controllerCertificate,
      this.secrets.identityPrivateKeyBase64,
      'GET',
      wsPath,
      mobileFabricRuntime,
    )
    // React Native intentionally supports upgrade headers as a third constructor
    // argument, although the DOM WebSocket declaration cannot express it.
    const NativeWebSocket = WebSocket as ReactNativeWebSocketConstructor
    const socket = new NativeWebSocket(
      websocketUrl(this.membership.relayUrl, wsPath),
      null,
      { headers: wsHeaders },
    )
    socket.binaryType = 'arraybuffer'

    const ready = deferred<void>()
    const fail = (error: Error) => {
      ready.reject(error)
      this.failSocket(socket, error)
    }
    const session = new FabricSession('controller', this.secrets.encryptionPrivateKeyBase64, {
      fabricId: this.membership.fabricId,
      linkId: link.linkId,
      expectedPeerPubkey: link.nodeCertificate.encryptionPubkey,
      ourPublicKeyBase64: this.membership.controllerCertificate.encryptionPubkey,
      supportedCipherSuites: ['aes-256-gcm'],
      supportedCompressions: ['none'],
      randomBytes: mobileFabricRuntime.randomBytes,
      encodeOutboundEnvelope: frame => encodeFabricEnvelope({
        fabricId: this.membership.fabricId,
        nodeId: this.nodeId,
        linkId: link.linkId,
      }, frame),
    }, {
      send: (data) => {
        if (socket.readyState !== WebSocket.OPEN) {
          fail(new FabricTransportError('The Fabric WebSocket closed while sending.'))
          return
        }
        try {
          socket.send(exactArrayBuffer(data))
        }
        catch (cause) {
          fail(cause as Error)
        }
      },
      onReady: () => {
        this.callbacks.onStatusChange?.('connected')
        ready.resolve(undefined)
      },
      onStreamData: (streamId, data) => this.streams.get(streamId)?.decoder.push(data),
      onStreamClose: (streamId, reason) => {
        const stream = this.streams.get(streamId)
        if (stream) {
          if (reason?.includes('error')) {
            stream.decoder.fail(new FabricTransportError(reason))
          }
          else {
            stream.decoder.end(reason)
          }
          this.removeStream(streamId)
        }
      },
      onPauseStream: (streamId) => {
        const stream = this.streams.get(streamId)
        if (stream) {
          stream.paused = true
        }
      },
      onResumeStream: (streamId) => {
        const stream = this.streams.get(streamId)
        if (stream) {
          stream.paused = false
          this.pumpRequest(streamId)
        }
      },
      onPeerClosed: reason => fail(new FabricTransportError(reason || 'The Fabric Node closed the link.')),
      onError: fail,
    })

    let timeout: ReturnType<typeof setTimeout> | null = null
    this.socket = socket
    this.session = session
    this.linkExpiresAt = Date.parse(link.expiresAt)
    const abortConnection = () => fail(
      signal.reason instanceof Error
        ? signal.reason
        : new FabricTransportError('Fabric connection was cancelled.'),
    )
    signal.addEventListener('abort', abortConnection, { once: true })
    socket.onopen = () => session.start()
    socket.onmessage = (event) => {
      try {
        if (!(event.data instanceof ArrayBuffer)) {
          throw new FabricTransportError('Fabric Relay returned a non-binary WebSocket frame.')
        }
        const envelope = decodeFabricEnvelope(new Uint8Array(event.data))
        if (
          envelope.fabricId !== this.membership.fabricId
          || envelope.nodeId !== this.nodeId
          || envelope.linkId !== link.linkId
        ) {
          throw new FabricTransportError('Fabric Relay route did not match the selected Node.')
        }
        session.handleEnvelope(toFabricSessionEnvelope(envelope))
      }
      catch (cause) {
        fail(cause as Error)
      }
    }
    socket.onerror = () => fail(new FabricTransportError('The Fabric WebSocket connection failed.'))
    socket.onclose = event => fail(new FabricTransportError(
      event.reason || `The Fabric WebSocket closed (${event.code}).`,
      event.reason === 'fabric_grant_revoked' ? 403 : undefined,
    ))
    timeout = setTimeout(() => {
      fail(new FabricTransportError('Timed out establishing the encrypted Fabric session.'))
    }, SESSION_READY_TIMEOUT_MS)
    try {
      await ready.promise
    }
    finally {
      signal.removeEventListener('abort', abortConnection)
      if (timeout !== null) {
        clearTimeout(timeout)
      }
    }
  }

  private assertConnectionActive(signal: AbortSignal): void {
    if (signal.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new FabricTransportError('Fabric connection was cancelled.')
    }
    if (!this.active) {
      throw new FabricTransportError('Fabric is suspended while Cradle is in the background.')
    }
  }

  private validateLink(link: OpenLinkResponse): void {
    if (!link.linkId || !Number.isFinite(Date.parse(link.expiresAt))) {
      throw new FabricTransportError('Fabric Relay returned an invalid link.')
    }
    verifyFabricCertificate(
      link.nodeCertificate,
      this.membership.ownerPubkey,
      this.membership.fabricId,
      mobileFabricRuntime.nowSeconds(),
    )
    if (
      link.nodeCertificate.subjectKind !== 'node'
      || link.nodeCertificate.subjectId !== this.nodeId
    ) {
      throw new FabricTransportError('Fabric Relay returned a certificate for another Node.')
    }
  }

  private pumpRequest(streamId: string): void {
    const stream = this.streams.get(streamId)
    const session = this.session
    if (!stream || !session?.isReady || stream.paused) {
      return
    }
    while (!stream.paused && stream.requestOffset < stream.requestBytes.byteLength) {
      const end = Math.min(
        stream.requestOffset + RELAY_MAX_STREAM_CHUNK_BYTES,
        stream.requestBytes.byteLength,
      )
      session.writeStreamData(streamId, stream.requestBytes.subarray(stream.requestOffset, end))
      stream.requestOffset = end
    }
  }

  private cancelStream(streamId: string, reason?: string): void {
    if (!this.streams.has(streamId)) {
      return
    }
    this.session?.closeStream(streamId, reason)
    this.removeStream(streamId)
  }

  private removeStream(streamId: string): void {
    this.streams.get(streamId)?.removeAbortListener()
    this.streams.delete(streamId)
  }

  private failSocket(socket: WebSocket, error: Error): void {
    if (this.socket !== socket) {
      return
    }
    this.callbacks.onStatusChange?.(
      isAccessDenied(error) ? 'access-denied' : 'offline',
      error.message,
    )
    this.failActiveLink(error)
  }

  private failActiveLink(error: Error): void {
    const socket = this.socket
    const session = this.session
    this.socket = null
    this.session = null
    this.linkExpiresAt = 0
    const streams = [...this.streams.values()]
    this.streams.clear()
    for (const stream of streams) {
      stream.removeAbortListener()
      stream.decoder.fail(error)
    }
    session?.close()
    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close(1000, 'Fabric link closed')
    }
  }
}
