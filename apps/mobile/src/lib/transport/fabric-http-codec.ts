import type {
  CradleResponse,
  CradleResponseBody,
  CradleResponseBodyReader,
} from './types'

const CRLF = '\r\n'
const HEADER_END = new TextEncoder().encode(`${CRLF}${CRLF}`)
const MAX_HEADER_BYTES = 64 * 1024
const MAX_REQUEST_BODY_BYTES = 8 * 1024 * 1024

export interface SerializedFabricHttpRequest {
  bytes: Uint8Array
  method: string
}

export interface FabricHttpResponseCallbacks {
  onConsumed: (bytes: number, flush?: boolean) => void
  onCancel: (reason?: string) => void
}

interface QueuedBodyChunk {
  data: Uint8Array
  wireBytes: number
}

interface FabricResponseInit {
  body: CradleResponseBody | null
  headers: Headers
  status: number
  statusText: string
}

/** Response implementation that preserves streaming on React Native's non-streaming fetch polyfill. */
class FabricHttpResponse implements CradleResponse {
  readonly body: CradleResponseBody | null
  readonly headers: Headers
  readonly status: number
  readonly statusText: string
  bodyUsed = false

  constructor(init: FabricResponseInit) {
    this.body = init.body
    this.headers = init.headers
    this.status = init.status
    this.statusText = init.statusText
  }

  get ok(): boolean {
    return this.status >= 200 && this.status < 300
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    if (this.bodyUsed) {
      throw new TypeError('Body has already been consumed.')
    }
    this.bodyUsed = true
    if (!this.body) {
      return new ArrayBuffer(0)
    }
    const reader = this.body.getReader()
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      while (true) {
        const next = await reader.read()
        if (next.done) {
          break
        }
        chunks.push(next.value)
        length += next.value.byteLength
      }
    }
    finally {
      reader.releaseLock()
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes.buffer
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(await this.arrayBuffer())
  }

  async json(): Promise<unknown> {
    return JSON.parse(await this.text()) as unknown
  }
}

class FabricHttpResponseBody implements CradleResponseBody {
  private locked = false

  constructor(
    private readonly readBody: () => Promise<ReadableStreamReadResult<Uint8Array>>,
    private readonly cancelBody: (reason?: unknown) => void,
    private readonly hasPendingRead: () => boolean,
  ) {}

  async cancel(reason?: unknown): Promise<void> {
    if (this.locked) {
      throw new TypeError('Cannot cancel a locked response body.')
    }
    this.cancelBody(reason)
  }

  getReader(): CradleResponseBodyReader {
    if (this.locked) {
      throw new TypeError('Response body is already locked to a reader.')
    }
    this.locked = true
    let released = false
    const assertActive = () => {
      if (released) {
        throw new TypeError('Reader lock has been released.')
      }
    }
    return {
      cancel: async (reason?: unknown) => {
        assertActive()
        this.cancelBody(reason)
      },
      read: () => {
        assertActive()
        return this.readBody()
      },
      releaseLock: () => {
        assertActive()
        if (this.hasPendingRead()) {
          throw new TypeError('Cannot release a reader with a pending read.')
        }
        released = true
        this.locked = false
      },
    }
  }
}

type BodyMode
  = | { kind: 'none' }
    | { kind: 'content-length', remaining: number }
    | { kind: 'chunked', state: ChunkState }
    | { kind: 'connection-close' }

type ChunkState
  = | { kind: 'size' }
    | { kind: 'data', remaining: number }
    | { kind: 'data-crlf' }
    | { kind: 'trailers' }

function abortError(message = 'The request was aborted.'): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(left.byteLength + right.byteLength)
  result.set(left)
  result.set(right, left.byteLength)
  return result
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  for (let index = 0; index <= haystack.byteLength - needle.byteLength; index += 1) {
    let matches = true
    for (let offset = 0; offset < needle.byteLength; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) {
        matches = false
        break
      }
    }
    if (matches) {
      return index
    }
  }
  return -1
}

function requestBodyBytes(body: BodyInit | null | undefined): Uint8Array {
  if (body === null || body === undefined) {
    return new Uint8Array()
  }
  if (typeof body === 'string') {
    return new TextEncoder().encode(body)
  }
  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body)
  }
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength).slice()
  }
  if (body instanceof URLSearchParams) {
    return new TextEncoder().encode(body.toString())
  }
  throw new TypeError('Fabric requests support string, URLSearchParams, and binary bodies.')
}

function validateRequestTarget(path: string): string {
  const target = path.startsWith('/') ? path : `/${path}`
  if (!target || /[\u0000-\u0020\u007F]/u.test(target)) {
    throw new TypeError('The Fabric request path contains an invalid character.')
  }
  return target
}

export function serializeFabricHttpRequest(
  path: string,
  init: RequestInit,
): SerializedFabricHttpRequest {
  const method = (init.method ?? 'GET').toUpperCase()
  if (!/^[!#$%&'*+.^_`|~0-9A-Z-]+$/u.test(method)) {
    throw new TypeError('The Fabric request method is invalid.')
  }
  const body = requestBodyBytes(init.body)
  if (body.byteLength > MAX_REQUEST_BODY_BYTES) {
    throw new TypeError('The Fabric request body exceeds the 8 MiB Mobile limit.')
  }

  const headers = new Headers(init.headers)
  for (const name of ['authorization', 'connection', 'content-length', 'host', 'transfer-encoding']) {
    headers.delete(name)
  }
  headers.set('connection', 'close')
  headers.set('content-length', String(body.byteLength))
  headers.set('host', 'cradle.fabric')

  const lines = [`${method} ${validateRequestTarget(path)} HTTP/1.1`]
  headers.forEach((value, name) => {
    if (/[^!#$%&'*+.^`|~\w-]/u.test(name) || /[\u0000-\u0008\u000A-\u001F\u007F]/u.test(value)) {
      throw new TypeError(`The Fabric request header ${name} is invalid.`)
    }
    lines.push(`${name}: ${value}`)
  })
  const head = new TextEncoder().encode(`${lines.join(CRLF)}${CRLF}${CRLF}`)
  if (head.byteLength > MAX_HEADER_BYTES) {
    throw new TypeError('The Fabric request headers exceed 64 KiB.')
  }
  return { bytes: concatBytes(head, body), method }
}

/** Incrementally turns the Node's raw HTTP/1 response into a fetch-compatible response. */
export class FabricHttpResponseDecoder {
  readonly response: Promise<CradleResponse>

  private buffer = new Uint8Array()
  private bodyMode: BodyMode | null = null
  private readonly queuedBody: QueuedBodyChunk[] = []
  private pendingBodyRead: {
    resolve: (result: ReadableStreamReadResult<Uint8Array>) => void
    reject: (error: Error) => void
  } | null = null

  private bodyError: Error | null = null
  private responseSettled = false
  private streamEnded = false
  private flushWhenDrained = false
  private failed = false
  private resolveResponse!: (response: CradleResponse) => void
  private rejectResponse!: (error: Error) => void

  constructor(
    private readonly requestMethod: string,
    private readonly callbacks: FabricHttpResponseCallbacks,
  ) {
    this.response = new Promise<CradleResponse>((resolve, reject) => {
      this.resolveResponse = resolve
      this.rejectResponse = reject
    })
  }

  push(data: Uint8Array): void {
    if (this.failed || this.streamEnded || data.byteLength === 0) {
      return
    }
    this.buffer = concatBytes(this.buffer, data)
    this.parse()
  }

  end(reason?: string): void {
    if (this.failed || this.streamEnded) {
      return
    }
    if (!this.bodyMode) {
      this.fail(new Error(reason || 'The Fabric Node closed before returning HTTP headers.'))
      return
    }
    if (this.bodyMode.kind === 'connection-close') {
      if (this.buffer.byteLength > 0) {
        const length = this.buffer.byteLength
        this.queueBody(this.take(length), length)
      }
      this.complete()
      return
    }
    if (this.bodyMode.kind === 'none' || (this.bodyMode.kind === 'content-length' && this.bodyMode.remaining === 0)) {
      this.complete()
      return
    }
    this.fail(new Error(reason || 'The Fabric Node closed an incomplete HTTP response.'))
  }

  fail(error: Error): void {
    if (this.failed) {
      return
    }
    this.failed = true
    this.callbacks.onCancel('invalid or interrupted response')
    if (!this.responseSettled) {
      this.rejectResponse(error)
    }
    else {
      this.bodyError = error
      this.pendingBodyRead?.reject(error)
      this.pendingBodyRead = null
    }
    this.queuedBody.length = 0
  }

  abort(): void {
    if (this.failed || this.streamEnded) {
      return
    }
    this.callbacks.onCancel('request aborted')
    this.failWithoutCancel(abortError())
  }

  private failWithoutCancel(error: Error): void {
    if (this.failed) {
      return
    }
    this.failed = true
    if (!this.responseSettled) {
      this.rejectResponse(error)
    }
    else {
      this.bodyError = error
      this.pendingBodyRead?.reject(error)
      this.pendingBodyRead = null
    }
    this.queuedBody.length = 0
  }

  private parse(): void {
    if (!this.bodyMode) {
      const headerEnd = indexOfBytes(this.buffer, HEADER_END)
      if (headerEnd < 0) {
        if (this.buffer.byteLength > MAX_HEADER_BYTES) {
          this.fail(new Error('The Fabric Node response headers exceed 64 KiB.'))
        }
        return
      }
      const headerBytes = this.take(headerEnd + HEADER_END.byteLength)
      this.parseHead(headerBytes.subarray(0, headerEnd))
      this.callbacks.onConsumed(headerBytes.byteLength)
      if (this.failed || !this.bodyMode) {
        return
      }
    }

    switch (this.bodyMode.kind) {
      case 'none':
        if (this.buffer.byteLength > 0) {
          this.fail(new Error('The Fabric Node returned an unexpected HTTP response body.'))
        }
        else {
          this.complete()
        }
        break
      case 'content-length':
        this.parseContentLengthBody()
        break
      case 'connection-close':
        if (this.buffer.byteLength > 0) {
          const length = this.buffer.byteLength
          this.queueBody(this.take(length), length)
        }
        break
      case 'chunked':
        this.parseChunkedBody()
        break
    }
  }

  private parseHead(bytes: Uint8Array): void {
    let head: string
    try {
      head = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    }
    catch {
      this.fail(new Error('The Fabric Node returned invalid HTTP response headers.'))
      return
    }
    const lines = head.split(CRLF)
    const statusMatch = /^HTTP\/1\.[01] ([1-5]\d{2})(?: (.*))?$/u.exec(lines[0] ?? '')
    if (!statusMatch) {
      this.fail(new Error('The Fabric Node returned an invalid HTTP status line.'))
      return
    }
    const status = Number(statusMatch[1])
    if (status >= 100 && status < 200) {
      this.fail(new Error('Interim and upgrade HTTP responses are not supported over Fabric.'))
      return
    }
    const headers = new Headers()
    for (const line of lines.slice(1)) {
      const separator = line.indexOf(':')
      if (separator <= 0 || /^[ \t]/u.test(line)) {
        this.fail(new Error('The Fabric Node returned a malformed HTTP header.'))
        return
      }
      headers.append(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
    }

    const transferEncoding = headers.get('transfer-encoding')?.toLowerCase()
    const contentLength = headers.get('content-length')
    const hasNoBody = this.requestMethod === 'HEAD' || status === 204 || status === 304
    if (hasNoBody) {
      this.bodyMode = { kind: 'none' }
    }
    else if (transferEncoding) {
      if (transferEncoding !== 'chunked' || contentLength !== null) {
        this.fail(new Error('The Fabric Node returned unsupported HTTP transfer framing.'))
        return
      }
      this.bodyMode = { kind: 'chunked', state: { kind: 'size' } }
    }
    else if (contentLength !== null) {
      if (!/^(?:0|[1-9]\d*)$/u.test(contentLength)) {
        this.fail(new Error('The Fabric Node returned an invalid Content-Length.'))
        return
      }
      const remaining = Number(contentLength)
      if (!Number.isSafeInteger(remaining)) {
        this.fail(new Error('The Fabric Node returned an invalid Content-Length.'))
        return
      }
      this.bodyMode = { kind: 'content-length', remaining }
    }
    else {
      this.bodyMode = { kind: 'connection-close' }
    }

    const body = this.bodyMode.kind === 'none'
      ? null
      : new FabricHttpResponseBody(
          () => this.readBody(),
          reason => this.cancelBody(reason),
          () => this.pendingBodyRead !== null,
        )
    this.responseSettled = true
    this.resolveResponse(new FabricHttpResponse({
      body,
      headers,
      status,
      statusText: statusMatch[2] ?? '',
    }))
  }

  private parseContentLengthBody(): void {
    if (!this.bodyMode || this.bodyMode.kind !== 'content-length') {
      return
    }
    if (this.bodyMode.remaining === 0) {
      if (this.buffer.byteLength > 0) {
        this.fail(new Error('The Fabric Node returned more bytes than Content-Length.'))
      }
      else {
        this.complete()
      }
      return
    }
    if (this.buffer.byteLength === 0) {
      return
    }
    const length = Math.min(this.buffer.byteLength, this.bodyMode.remaining)
    this.bodyMode.remaining -= length
    this.queueBody(this.take(length), length)
    this.parseContentLengthBody()
  }

  private parseChunkedBody(): void {
    while (!this.failed && this.bodyMode?.kind === 'chunked') {
      const state = this.bodyMode.state
      if (state.kind === 'size') {
        const line = this.takeLine()
        if (!line) {
          return
        }
        const value = line.text.split(';', 1)[0] ?? ''
        if (!/^[0-9a-f]+$/iu.test(value)) {
          this.fail(new Error('The Fabric Node returned an invalid HTTP chunk size.'))
          return
        }
        const size = Number.parseInt(value, 16)
        if (!Number.isSafeInteger(size)) {
          this.fail(new Error('The Fabric Node returned an invalid HTTP chunk size.'))
          return
        }
        this.consumeFraming(line.wireBytes)
        this.bodyMode.state = size === 0 ? { kind: 'trailers' } : { kind: 'data', remaining: size }
      }
      else if (state.kind === 'data') {
        if (this.buffer.byteLength === 0) {
          return
        }
        const length = Math.min(this.buffer.byteLength, state.remaining)
        state.remaining -= length
        this.queueBody(this.take(length), length)
        if (state.remaining === 0) {
          this.bodyMode.state = { kind: 'data-crlf' }
        }
      }
      else if (state.kind === 'data-crlf') {
        if (this.buffer.byteLength < 2) {
          return
        }
        const ending = this.take(2)
        if (ending[0] !== 13 || ending[1] !== 10) {
          this.fail(new Error('The Fabric Node returned malformed HTTP chunk framing.'))
          return
        }
        this.consumeFraming(2)
        this.bodyMode.state = { kind: 'size' }
      }
      else {
        const trailer = this.takeLine()
        if (!trailer) {
          if (this.buffer.byteLength > MAX_HEADER_BYTES) {
            this.fail(new Error('The Fabric Node response trailers exceed 64 KiB.'))
          }
          return
        }
        this.consumeFraming(trailer.wireBytes)
        if (trailer.text === '') {
          this.complete()
          return
        }
        if (trailer.text.indexOf(':') <= 0 || /^[ \t]/u.test(trailer.text)) {
          this.fail(new Error('The Fabric Node returned a malformed HTTP trailer.'))
          return
        }
      }
    }
  }

  private takeLine(): { text: string, wireBytes: number } | null {
    for (let index = 0; index + 1 < this.buffer.byteLength; index += 1) {
      if (this.buffer[index] === 13 && this.buffer[index + 1] === 10) {
        const bytes = this.take(index + 2)
        let text: string
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, index))
        }
        catch {
          this.fail(new Error('The Fabric Node returned invalid HTTP framing.'))
          return null
        }
        return { text, wireBytes: bytes.byteLength }
      }
    }
    return null
  }

  private take(length: number): Uint8Array {
    const result = this.buffer.slice(0, length)
    this.buffer = this.buffer.slice(length)
    return result
  }

  private queueBody(data: Uint8Array, wireBytes: number): void {
    if (data.byteLength === 0) {
      return
    }
    this.queuedBody.push({ data, wireBytes })
    this.resolvePendingBodyRead()
  }

  private consumeFraming(wireBytes: number): void {
    if (this.queuedBody.length === 0) {
      this.callbacks.onConsumed(wireBytes)
      return
    }
    this.queuedBody.push({ data: new Uint8Array(), wireBytes })
  }

  private nextBodyResult(): ReadableStreamReadResult<Uint8Array> | null {
    let chunk = this.queuedBody.shift()
    while (chunk) {
      const flush = this.flushWhenDrained && this.queuedBody.length === 0
      this.callbacks.onConsumed(chunk.wireBytes, flush)
      if (flush) {
        this.flushWhenDrained = false
      }
      if (chunk.data.byteLength > 0) {
        return { done: false, value: chunk.data }
      }
      chunk = this.queuedBody.shift()
    }
    if (this.streamEnded) {
      return { done: true, value: undefined }
    }
    return null
  }

  private readBody(): Promise<ReadableStreamReadResult<Uint8Array>> {
    if (this.bodyError) {
      return Promise.reject(this.bodyError)
    }
    const result = this.nextBodyResult()
    if (result) {
      return Promise.resolve(result)
    }
    if (this.pendingBodyRead) {
      return Promise.reject(new TypeError('Only one response body read may be pending.'))
    }
    return new Promise((resolve, reject) => {
      this.pendingBodyRead = { resolve, reject }
    })
  }

  private resolvePendingBodyRead(): void {
    const pending = this.pendingBodyRead
    if (!pending) {
      return
    }
    const result = this.nextBodyResult()
    if (!result) {
      return
    }
    this.pendingBodyRead = null
    pending.resolve(result)
  }

  private cancelBody(reason?: unknown): void {
    if (this.failed || (this.streamEnded && this.queuedBody.length === 0)) {
      return
    }
    this.callbacks.onCancel(typeof reason === 'string' ? reason : 'response body cancelled')
    this.streamEnded = true
    this.queuedBody.length = 0
    this.resolvePendingBodyRead()
  }

  private complete(): void {
    if (this.streamEnded || this.failed) {
      return
    }
    if (this.buffer.byteLength > 0) {
      this.fail(new Error('The Fabric Node returned bytes after the HTTP response ended.'))
      return
    }
    this.streamEnded = true
    if (this.queuedBody.length === 0) {
      this.callbacks.onConsumed(0, true)
      this.resolvePendingBodyRead()
    }
    else {
      this.flushWhenDrained = true
    }
  }
}
