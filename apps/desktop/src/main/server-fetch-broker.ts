import type {
  Event as ElectronEvent,
  IpcMain,
  IpcMainInvokeEvent,
  RenderProcessGoneDetails,
  WebContents,
  WebContentsDidStartNavigationEventParams,
} from 'electron'
import { Agent, fetch as undiciFetch } from 'undici'

import type {
  DesktopServerFetchChunk,
  DesktopServerFetchErrorEvent,
  DesktopServerFetchOpenResponse,
  DesktopServerFetchRequest,
  DesktopServerFetchResponseHead,
  DesktopServerFetchTerminalEvent,
} from '../shared/server-fetch-transport'
import {
  DESKTOP_SERVER_FETCH_CANCEL_CHANNEL,
  DESKTOP_SERVER_FETCH_CHUNK_BYTES,
  DESKTOP_SERVER_FETCH_CHUNK_CHANNEL,
  DESKTOP_SERVER_FETCH_CLOSED_CHANNEL,
  DESKTOP_SERVER_FETCH_CREDIT_CHANNEL,
  DESKTOP_SERVER_FETCH_DOCUMENT_CHANNEL,
  DESKTOP_SERVER_FETCH_ERROR_CHANNEL,
  DESKTOP_SERVER_FETCH_MAX_CREDIT,
  DESKTOP_SERVER_FETCH_OPEN_CHANNEL,
} from '../shared/server-fetch-transport'

const STRIPPED_REQUEST_HEADERS = new Set([
  'authorization',
  'connection',
  'content-length',
  'cookie',
  'host',
  'proxy-authorization',
  'transfer-encoding',
  'x-cradle-relay-token',
  'x-cradle-token',
])

const STRIPPED_RESPONSE_HEADERS = new Set([
  'connection',
  'content-length',
  'set-cookie',
  'transfer-encoding',
])

const DEFAULT_CONSUMER_IDLE_MS = 60_000
const DIAGNOSTIC_REQUEST_LIMIT = 20

type ActiveRequestState = 'opening' | 'reading' | 'waiting-credit'
type CancellationReason
  = | 'consumer-idle'
    | 'explicit'
    | 'navigation'
    | 'owner-destroyed'
    | 'render-process-gone'
    | 'server-generation'
    | 'shutdown'

interface ActiveRequest {
  key: string
  requestId: string
  owner: WebContents
  ownerGeneration: number
  kind: 'finite' | 'stream'
  method: string
  pathname: string
  controller: AbortController
  reader: ReadableStreamDefaultReader<Uint8Array> | null
  credit: number
  remainder: Uint8Array | null
  declaredBytes: number | null
  deliveredBytes: number
  openedAt: number
  responseHeadAt: number | null
  lastCreditAt: number | null
  lastDeliveryAt: number | null
  idleTimer: ReturnType<typeof setTimeout> | null
  pumping: boolean
  closed: boolean
}

interface OwnerRequests {
  owner: WebContents
  currentDocumentId: string | null
  retiredDocumentIds: Set<string>
  generation: number
  keys: Set<string>
  handleDestroyed: () => void
  handleNavigation: (event: ElectronEvent<WebContentsDidStartNavigationEventParams>) => void
  handleRenderProcessGone: (event: ElectronEvent, details: RenderProcessGoneDetails) => void
}

type ServerFetch = typeof undiciFetch

interface DesktopServerFetchBrokerOptions {
  fetchFn?: ServerFetch
  isAllowedSender: (sender: WebContents) => boolean
  consumerIdleMs?: number
}

export interface DesktopServerFetchRequestDiagnostics {
  requestId: string
  ownerId: number
  ownerGeneration: number
  method: string
  pathname: string
  kind: 'finite' | 'stream'
  state: ActiveRequestState
  ageMs: number
  responseAgeMs: number | null
  credit: number
  declaredBytes: number | null
  deliveredBytes: number
  declaredUndeliveredBytes: number | null
  bufferedBytes: number
  lastCreditAgeMs: number | null
  lastDeliveryAgeMs: number | null
}

export interface DesktopServerFetchDiagnostics {
  generation: number
  activeRequests: number
  finiteRequests: number
  streamRequests: number
  rendererCount: number
  zeroCreditRequests: number
  oldestRequestAgeMs: number
  declaredUndeliveredBytes: number
  bufferedBytes: number
  cancellations: Record<CancellationReason, number>
  requests: DesktopServerFetchRequestDiagnostics[]
}

export class DesktopServerFetchBroker {
  private readonly fetchFn: ServerFetch
  private readonly isAllowedSender: (sender: WebContents) => boolean
  private readonly consumerIdleMs: number
  private readonly finiteDispatcher = new Agent({ connections: 128, pipelining: 1 })
  private readonly streamDispatcher = new Agent({ connections: 256, pipelining: 1 })
  private readonly active = new Map<string, ActiveRequest>()
  private readonly ownerRequests = new Map<number, OwnerRequests>()
  private readonly cancellations: Record<CancellationReason, number> = {
    'consumer-idle': 0,
    'explicit': 0,
    'navigation': 0,
    'owner-destroyed': 0,
    'render-process-gone': 0,
    'server-generation': 0,
    'shutdown': 0,
  }

  private serverUrl: string | null = null
  private generation = 0

  constructor(options: DesktopServerFetchBrokerOptions) {
    this.fetchFn = options.fetchFn ?? undiciFetch
    this.isAllowedSender = options.isAllowedSender
    this.consumerIdleMs = options.consumerIdleMs ?? DEFAULT_CONSUMER_IDLE_MS
    if (!Number.isFinite(this.consumerIdleMs) || this.consumerIdleMs <= 0) {
      throw new Error('Desktop Server fetch consumer idle lease must be positive.')
    }
  }

  register(ipcMain: IpcMain): void {
    ipcMain.on(DESKTOP_SERVER_FETCH_DOCUMENT_CHANNEL, (event, documentId: unknown) => {
      if (
        !this.isAllowedSender(event.sender)
        || typeof documentId !== 'string'
        || documentId.length < 1
        || documentId.length > 128
      ) {
        return
      }
      this.activateDocument(this.ensureOwner(event.sender), documentId)
    })
    ipcMain.handle(
      DESKTOP_SERVER_FETCH_OPEN_CHANNEL,
      async (event, request: DesktopServerFetchRequest): Promise<DesktopServerFetchOpenResponse> => {
        try {
          return await this.open(event, request)
        }
        catch (error) {
          if (error instanceof DesktopServerFetchCancelledError) {
            return {
              requestId: error.requestId,
              cancelled: true,
            }
          }
          throw error
        }
      },
    )
    ipcMain.on(DESKTOP_SERVER_FETCH_CREDIT_CHANNEL, (event, requestId: unknown, credit: unknown) => {
      if (!this.isAllowedSender(event.sender) || typeof requestId !== 'string') {
        return
      }
      const active = this.active.get(this.key(event.sender, requestId))
      if (!active || !Number.isSafeInteger(credit) || (credit as number) <= 0) {
        return
      }
      active.lastCreditAt = Date.now()
      this.clearConsumerIdle(active)
      active.credit = Math.min(
        DESKTOP_SERVER_FETCH_MAX_CREDIT,
        active.credit + (credit as number),
      )
      void this.pump(active)
    })
    ipcMain.on(DESKTOP_SERVER_FETCH_CANCEL_CHANNEL, (event, requestId: unknown) => {
      if (!this.isAllowedSender(event.sender) || typeof requestId !== 'string') {
        return
      }
      void this.cancel(this.key(event.sender, requestId), 'explicit')
    })
  }

  setServerUrl(serverUrl: string, generation: number): void {
    const next = new URL(serverUrl).toString()
    if (this.serverUrl === next && this.generation === generation) {
      return
    }
    this.serverUrl = next
    this.generation = generation
    for (const key of this.active.keys()) {
      void this.cancel(key, 'server-generation')
    }
  }

  async close(): Promise<void> {
    for (const key of this.active.keys()) {
      await this.cancel(key, 'shutdown')
    }
    for (const registration of this.ownerRequests.values()) {
      this.removeOwner(registration)
    }
    await Promise.all([
      this.finiteDispatcher.close(),
      this.streamDispatcher.close(),
    ])
  }

  diagnostics(): DesktopServerFetchDiagnostics {
    const now = Date.now()
    const requests = [...this.active.values()]
    const details = requests
      .map(request => this.requestDiagnostics(request, now))
      .sort((left, right) => right.ageMs - left.ageMs
        || (right.declaredUndeliveredBytes ?? -1) - (left.declaredUndeliveredBytes ?? -1))
      .slice(0, DIAGNOSTIC_REQUEST_LIMIT)
    return {
      generation: this.generation,
      activeRequests: requests.length,
      finiteRequests: requests.filter(request => request.kind === 'finite').length,
      streamRequests: requests.filter(request => request.kind === 'stream').length,
      rendererCount: [...this.ownerRequests.values()].filter(owner => owner.keys.size > 0).length,
      zeroCreditRequests: requests.filter(request => request.reader && request.credit === 0).length,
      oldestRequestAgeMs: details[0]?.ageMs ?? 0,
      declaredUndeliveredBytes: requests.reduce((total, request) => total + (
        request.declaredBytes === null
          ? 0
          : Math.max(0, request.declaredBytes - request.deliveredBytes)
      ), 0),
      bufferedBytes: requests.reduce((total, request) => total + (request.remainder?.byteLength ?? 0), 0),
      cancellations: { ...this.cancellations },
      requests: details,
    }
  }

  private async open(
    event: IpcMainInvokeEvent,
    request: DesktopServerFetchRequest,
  ): Promise<DesktopServerFetchResponseHead> {
    if (!this.isAllowedSender(event.sender)) {
      throw new Error('Desktop Server fetch is unavailable to this renderer.')
    }
    if (!this.serverUrl) {
      throw new Error('Desktop Server is not ready.')
    }
    validateRequest(request)
    if (request.generation !== this.generation) {
      throw new Error('Desktop Server fetch generation is stale.')
    }
    const owner = this.ensureOwner(event.sender)
    const senderFrameIsCurrent = event.senderFrame !== null
      && !event.senderFrame.detached
      && event.senderFrame === event.sender.mainFrame
    if (
      senderFrameIsCurrent
      && owner.currentDocumentId === null
      && !owner.retiredDocumentIds.has(request.documentId)
    ) {
      this.activateDocument(owner, request.documentId)
    }
    if (
      owner.currentDocumentId !== request.documentId
      || !senderFrameIsCurrent
    ) {
      throw new DesktopServerFetchCancelledError(request.requestId)
    }

    const target = new URL(request.path, this.serverUrl)
    if (target.origin !== new URL(this.serverUrl).origin) {
      throw new Error('Desktop Server fetch target escaped the active Server origin.')
    }

    const key = this.key(event.sender, request.requestId)
    if (this.active.has(key)) {
      throw new Error('Desktop Server fetch request id is already active.')
    }

    const controller = new AbortController()
    const headers = sanitizeRequestHeaders(request.headers)
    const active: ActiveRequest = {
      key,
      requestId: request.requestId,
      owner: event.sender,
      ownerGeneration: owner.generation,
      kind: acceptsEventStream(headers) ? 'stream' : 'finite',
      method: request.method.toUpperCase(),
      pathname: target.pathname,
      controller,
      reader: null,
      credit: 0,
      remainder: null,
      declaredBytes: null,
      deliveredBytes: 0,
      openedAt: Date.now(),
      responseHeadAt: null,
      lastCreditAt: null,
      lastDeliveryAt: null,
      idleTimer: null,
      pumping: false,
      closed: false,
    }
    this.active.set(key, active)
    owner.keys.add(active.key)

    let response: Awaited<ReturnType<ServerFetch>>
    try {
      response = await this.fetchFn(target, {
        method: request.method,
        headers,
        body: request.body ?? undefined,
        dispatcher: active.kind === 'stream'
          ? this.streamDispatcher
          : this.finiteDispatcher,
        // The broker is authority for exactly one Desktop-owned origin. Never let
        // a request escape that origin through an upstream redirect.
        redirect: 'error',
        signal: controller.signal,
      })
    }
    catch (error) {
      const cancelled = active.closed || controller.signal.aborted
      this.take(active)
      if (cancelled) {
        throw new DesktopServerFetchCancelledError(request.requestId)
      }
      throw error
    }

    if (active.closed || controller.signal.aborted) {
      await response.body?.cancel().catch(() => {})
      throw new DesktopServerFetchCancelledError(request.requestId)
    }
    active.reader = response.body?.getReader() ?? null
    active.responseHeadAt = Date.now()
    active.declaredBytes = parseContentLength(response.headers.get('content-length'))

    if (!active.reader) {
      queueMicrotask(() => this.finish(active))
    }
    else {
      this.scheduleConsumerIdle(active)
    }

    return {
      requestId: request.requestId,
      status: response.status,
      statusText: response.statusText,
      headers: sanitizeResponseHeaders(response.headers),
      url: response.url,
    }
  }

  private async pump(active: ActiveRequest): Promise<void> {
    if (active.pumping || active.closed || !active.reader) {
      return
    }
    active.pumping = true
    try {
      while (active.credit > 0 && !active.closed) {
        const bytes = await this.readChunk(active)
        if (active.closed) {
          return
        }
        if (bytes === null) {
          this.finish(active)
          return
        }
        active.credit -= 1
        active.deliveredBytes += bytes.byteLength
        active.lastDeliveryAt = Date.now()
        const payload: DesktopServerFetchChunk = { requestId: active.requestId, bytes }
        active.owner.send(DESKTOP_SERVER_FETCH_CHUNK_CHANNEL, payload)
        if (active.credit === 0) {
          this.scheduleConsumerIdle(active)
        }
      }
    }
    catch (error) {
      if (!active.controller.signal.aborted) {
        this.fail(active, error)
      }
    }
    finally {
      active.pumping = false
    }
  }

  private async readChunk(active: ActiveRequest): Promise<Uint8Array | null> {
    const buffered = active.remainder
    if (buffered) {
      active.remainder = null
      return this.splitChunk(active, buffered)
    }
    const result = await active.reader!.read()
    if (result.done) {
      return null
    }
    return this.splitChunk(active, result.value)
  }

  private splitChunk(active: ActiveRequest, bytes: Uint8Array): Uint8Array {
    if (bytes.byteLength <= DESKTOP_SERVER_FETCH_CHUNK_BYTES) {
      return bytes
    }
    active.remainder = bytes.subarray(DESKTOP_SERVER_FETCH_CHUNK_BYTES)
    return bytes.subarray(0, DESKTOP_SERVER_FETCH_CHUNK_BYTES)
  }

  private finish(active: ActiveRequest): void {
    if (!this.take(active)) {
      return
    }
    const payload: DesktopServerFetchTerminalEvent = { requestId: active.requestId }
    if (!active.owner.isDestroyed()) {
      active.owner.send(DESKTOP_SERVER_FETCH_CLOSED_CHANNEL, payload)
    }
  }

  private fail(active: ActiveRequest, error: unknown): void {
    if (!this.take(active)) {
      return
    }
    const payload: DesktopServerFetchErrorEvent = {
      requestId: active.requestId,
      message: error instanceof Error ? error.message : String(error),
    }
    if (!active.owner.isDestroyed()) {
      active.owner.send(DESKTOP_SERVER_FETCH_ERROR_CHANNEL, payload)
    }
  }

  private async cancel(key: string, reason: CancellationReason): Promise<void> {
    const active = this.active.get(key)
    if (!active || !this.take(active)) {
      return
    }
    this.cancellations[reason] += 1
    active.controller.abort()
    await active.reader?.cancel().catch(() => {})
  }

  private take(active: ActiveRequest): boolean {
    if (active.closed) {
      return false
    }
    active.closed = true
    this.clearConsumerIdle(active)
    this.active.delete(active.key)
    this.detachOwner(active)
    return true
  }

  private detachOwner(active: ActiveRequest): void {
    const registration = this.ownerRequests.get(active.owner.id)
    if (!registration) {
      return
    }
    registration.keys.delete(active.key)
  }

  private key(sender: WebContents, requestId: string): string {
    return `${sender.id}:${requestId}`
  }

  private cancelOwner(keys: Set<string>, reason: CancellationReason): void {
    for (const key of [...keys]) {
      void this.cancel(key, reason)
    }
  }

  private ensureOwner(owner: WebContents): OwnerRequests {
    const existing = this.ownerRequests.get(owner.id)
    if (existing) {
      return existing
    }
    const keys = new Set<string>()
    const registration: OwnerRequests = {
      owner,
      currentDocumentId: null,
      retiredDocumentIds: new Set(),
      generation: 0,
      keys,
      handleDestroyed: () => {},
      handleNavigation: () => {},
      handleRenderProcessGone: () => {},
    }
    registration.handleDestroyed = () => {
      this.cancelOwner(keys, 'owner-destroyed')
      this.removeOwner(registration)
    }
    registration.handleNavigation = (event) => {
      if (!event.isMainFrame || event.isSameDocument) {
        return
      }
      this.retireDocument(registration)
      this.cancelOwner(keys, 'navigation')
    }
    registration.handleRenderProcessGone = () => {
      this.retireDocument(registration)
      this.cancelOwner(keys, 'render-process-gone')
    }
    this.ownerRequests.set(owner.id, registration)
    owner.once('destroyed', registration.handleDestroyed)
    owner.on('did-start-navigation', registration.handleNavigation)
    owner.on('render-process-gone', registration.handleRenderProcessGone)
    return registration
  }

  private activateDocument(registration: OwnerRequests, documentId: string): void {
    if (
      registration.currentDocumentId === documentId
      || registration.retiredDocumentIds.has(documentId)
    ) {
      return
    }
    const hadCurrentDocument = registration.currentDocumentId !== null
    if (hadCurrentDocument) {
      this.retireDocument(registration)
      this.cancelOwner(registration.keys, 'navigation')
    }
    registration.currentDocumentId = documentId
    registration.generation += 1
  }

  private retireDocument(registration: OwnerRequests): void {
    if (registration.currentDocumentId) {
      registration.retiredDocumentIds.add(registration.currentDocumentId)
      registration.currentDocumentId = null
    }
  }

  private removeOwner(registration: OwnerRequests): void {
    if (this.ownerRequests.get(registration.owner.id) !== registration) {
      return
    }
    registration.owner.removeListener('destroyed', registration.handleDestroyed)
    registration.owner.removeListener('did-start-navigation', registration.handleNavigation)
    registration.owner.removeListener('render-process-gone', registration.handleRenderProcessGone)
    this.ownerRequests.delete(registration.owner.id)
  }

  private scheduleConsumerIdle(active: ActiveRequest): void {
    if (active.closed || !active.reader || active.credit > 0 || active.idleTimer) {
      return
    }
    active.idleTimer = setTimeout(() => {
      active.idleTimer = null
      if (!active.closed && active.credit === 0) {
        void this.cancel(active.key, 'consumer-idle')
      }
    }, this.consumerIdleMs)
    active.idleTimer.unref?.()
  }

  private clearConsumerIdle(active: ActiveRequest): void {
    if (!active.idleTimer) {
      return
    }
    clearTimeout(active.idleTimer)
    active.idleTimer = null
  }

  private requestDiagnostics(active: ActiveRequest, now: number): DesktopServerFetchRequestDiagnostics {
    const declaredUndeliveredBytes = active.declaredBytes === null
      ? null
      : Math.max(0, active.declaredBytes - active.deliveredBytes)
    return {
      requestId: active.requestId,
      ownerId: active.owner.id,
      ownerGeneration: active.ownerGeneration,
      method: active.method,
      pathname: active.pathname,
      kind: active.kind,
      state: active.responseHeadAt === null
        ? 'opening'
        : active.credit > 0
          ? 'reading'
          : 'waiting-credit',
      ageMs: now - active.openedAt,
      responseAgeMs: active.responseHeadAt === null ? null : now - active.responseHeadAt,
      credit: active.credit,
      declaredBytes: active.declaredBytes,
      deliveredBytes: active.deliveredBytes,
      declaredUndeliveredBytes,
      bufferedBytes: active.remainder?.byteLength ?? 0,
      lastCreditAgeMs: active.lastCreditAt === null ? null : now - active.lastCreditAt,
      lastDeliveryAgeMs: active.lastDeliveryAt === null ? null : now - active.lastDeliveryAt,
    }
  }
}

class DesktopServerFetchCancelledError extends Error {
  readonly requestId: string

  constructor(requestId: string) {
    super('Desktop Server fetch was cancelled.')
    this.name = 'DesktopServerFetchCancelledError'
    this.requestId = requestId
  }
}

function validateRequest(request: DesktopServerFetchRequest): void {
  if (
    !request
    || typeof request.requestId !== 'string'
    || request.requestId.length < 1
    || request.requestId.length > 128
    || typeof request.documentId !== 'string'
    || request.documentId.length < 1
    || request.documentId.length > 128
    || !Number.isSafeInteger(request.generation)
    || request.generation < 1
    || typeof request.method !== 'string'
    || !request.path.startsWith('/')
    || !Array.isArray(request.headers)
    || (request.body !== null && !(request.body instanceof Uint8Array))
  ) {
    throw new Error('Invalid Desktop Server fetch request.')
  }
}

function sanitizeRequestHeaders(entries: Array<[string, string]>): Headers {
  const headers = new Headers()
  for (const [name, value] of entries) {
    if (!STRIPPED_REQUEST_HEADERS.has(name.toLowerCase())) {
      headers.append(name, value)
    }
  }
  return headers
}

function sanitizeResponseHeaders(
  headers: { forEach: (callback: (value: string, name: string) => void) => void },
): Array<[string, string]> {
  const result: Array<[string, string]> = []
  headers.forEach((value, name) => {
    if (!STRIPPED_RESPONSE_HEADERS.has(name.toLowerCase())) {
      result.push([name, value])
    }
  })
  return result
}

function acceptsEventStream(headers: Headers): boolean {
  return headers.get('accept')
    ?.split(',')
    .some(value => value.trim().toLowerCase().startsWith('text/event-stream')) ?? false
}

function parseContentLength(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) {
    return null
  }
  const bytes = Number(value)
  return Number.isSafeInteger(bytes) ? bytes : null
}
