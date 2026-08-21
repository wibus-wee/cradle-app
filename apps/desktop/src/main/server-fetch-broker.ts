import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import { Agent, fetch as undiciFetch } from 'undici'

import type {
  DesktopServerFetchChunk,
  DesktopServerFetchErrorEvent,
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

interface ActiveRequest {
  key: string
  requestId: string
  owner: WebContents
  kind: 'finite' | 'stream'
  controller: AbortController
  reader: ReadableStreamDefaultReader<Uint8Array> | null
  credit: number
  remainder: Uint8Array | null
  pumping: boolean
  closed: boolean
}

interface OwnerRequests {
  owner: WebContents
  keys: Set<string>
  handleDestroyed: () => void
}

type ServerFetch = typeof undiciFetch

interface DesktopServerFetchBrokerOptions {
  fetchFn?: ServerFetch
  isAllowedSender: (sender: WebContents) => boolean
}

export class DesktopServerFetchBroker {
  private readonly fetchFn: ServerFetch
  private readonly isAllowedSender: (sender: WebContents) => boolean
  private readonly finiteDispatcher = new Agent({ connections: 128, pipelining: 1 })
  private readonly streamDispatcher = new Agent({ connections: 256, pipelining: 1 })
  private readonly active = new Map<string, ActiveRequest>()
  private readonly ownerRequests = new Map<number, OwnerRequests>()
  private serverUrl: string | null = null
  private generation = 0

  constructor(options: DesktopServerFetchBrokerOptions) {
    this.fetchFn = options.fetchFn ?? undiciFetch
    this.isAllowedSender = options.isAllowedSender
  }

  register(ipcMain: IpcMain): void {
    ipcMain.handle(
      DESKTOP_SERVER_FETCH_OPEN_CHANNEL,
      async (event, request: DesktopServerFetchRequest) => await this.open(event, request),
    )
    ipcMain.on(DESKTOP_SERVER_FETCH_CREDIT_CHANNEL, (event, requestId: unknown, credit: unknown) => {
      if (!this.isAllowedSender(event.sender) || typeof requestId !== 'string') {
        return
      }
      const active = this.active.get(this.key(event.sender, requestId))
      if (!active || !Number.isSafeInteger(credit) || (credit as number) <= 0) {
        return
      }
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
      void this.cancel(this.key(event.sender, requestId))
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
      void this.cancel(key)
    }
  }

  async close(): Promise<void> {
    for (const key of this.active.keys()) {
      await this.cancel(key)
    }
    await Promise.all([
      this.finiteDispatcher.close(),
      this.streamDispatcher.close(),
    ])
  }

  diagnostics(): {
    generation: number
    activeRequests: number
    finiteRequests: number
    streamRequests: number
    rendererCount: number
  } {
    const requests = [...this.active.values()]
    return {
      generation: this.generation,
      activeRequests: requests.length,
      finiteRequests: requests.filter(request => request.kind === 'finite').length,
      streamRequests: requests.filter(request => request.kind === 'stream').length,
      rendererCount: this.ownerRequests.size,
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
      kind: acceptsEventStream(headers) ? 'stream' : 'finite',
      controller,
      reader: null,
      credit: 0,
      remainder: null,
      pumping: false,
      closed: false,
    }
    this.active.set(key, active)
    this.attachOwner(active)

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
      this.take(active)
      throw error
    }

    if (active.closed || controller.signal.aborted) {
      await response.body?.cancel().catch(() => {})
      throw new DOMException('The operation was aborted.', 'AbortError')
    }
    active.reader = response.body?.getReader() ?? null

    if (!active.reader) {
      queueMicrotask(() => this.finish(active))
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
        if (bytes === null) {
          this.finish(active)
          return
        }
        active.credit -= 1
        const payload: DesktopServerFetchChunk = { requestId: active.requestId, bytes }
        active.owner.send(DESKTOP_SERVER_FETCH_CHUNK_CHANNEL, payload)
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

  private async cancel(key: string): Promise<void> {
    const active = this.active.get(key)
    if (!active || !this.take(active)) {
      return
    }
    active.controller.abort()
    await active.reader?.cancel().catch(() => {})
  }

  private take(active: ActiveRequest): boolean {
    if (active.closed) {
      return false
    }
    active.closed = true
    this.active.delete(active.key)
    this.detachOwner(active)
    return true
  }

  private attachOwner(active: ActiveRequest): void {
    let registration = this.ownerRequests.get(active.owner.id)
    if (!registration) {
      const keys = new Set<string>()
      const handleDestroyed = () => {
        for (const key of [...keys]) {
          void this.cancel(key)
        }
      }
      registration = { owner: active.owner, keys, handleDestroyed }
      this.ownerRequests.set(active.owner.id, registration)
      active.owner.once('destroyed', handleDestroyed)
    }
    registration.keys.add(active.key)
  }

  private detachOwner(active: ActiveRequest): void {
    const registration = this.ownerRequests.get(active.owner.id)
    if (!registration) {
      return
    }
    registration.keys.delete(active.key)
    if (registration.keys.size === 0) {
      registration.owner.removeListener('destroyed', registration.handleDestroyed)
      this.ownerRequests.delete(active.owner.id)
    }
  }

  private key(sender: WebContents, requestId: string): string {
    return `${sender.id}:${requestId}`
  }
}

function validateRequest(request: DesktopServerFetchRequest): void {
  if (
    !request
    || typeof request.requestId !== 'string'
    || request.requestId.length < 1
    || request.requestId.length > 128
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
