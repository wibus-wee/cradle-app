import type { EventSourceMessage } from 'eventsource-parser'
import { createParser } from 'eventsource-parser'

import { cradleFetch } from '../server-credential'

export type ServerEventSourceListener = (event: MessageEvent<string>) => void
export type ServerEventSourceErrorListener = (event: Event) => void

export interface OpenServerEventSourceOptions {
  /** Abort the stream and suppress further reconnects. */
  signal?: AbortSignal
  /**
   * Feature-owned request construction on (re)connect.
   * Defaults to the original URL/Request; may attach cursor / Last-Event-ID query params.
   */
  buildRequest?: (context: {
    lastEventId: string | null
    attempt: number
  }) => RequestInfo | URL
  /**
   * Feature-owned reconnect policy. Return `false` to stop, `true` for default delay,
   * or a delay in milliseconds.
   */
  shouldReconnect?: (context: {
    attempt: number
    lastEventId: string | null
    error: unknown
  }) => boolean | number
  /** Override fetch (defaults to cradleFetch). */
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  /** Initial reconnect delay (ms). Default 1000. */
  reconnectDelayMs?: number
  /** Max reconnect delay (ms). Default 30_000. */
  maxReconnectDelayMs?: number
}

/**
 * Minimal EventSource-compatible surface backed by fetch + eventsource-parser.
 * Safe on `cradle-server://` custom schemes where native EventSource is not.
 */
export interface ServerEventSource {
  readonly url: string
  readonly readyState: 0 | 1 | 2
  onopen: ((event: Event) => void) | null
  onmessage: ServerEventSourceListener | null
  onerror: ServerEventSourceErrorListener | null
  addEventListener: ((type: 'open', listener: (event: Event) => void) => void)
    & ((type: 'message', listener: ServerEventSourceListener) => void)
    & ((type: 'error', listener: ServerEventSourceErrorListener) => void)
    & ((type: string, listener: EventListenerOrEventListenerObject | ServerEventSourceListener | ServerEventSourceErrorListener) => void)
  removeEventListener: ((type: string, listener: EventListenerOrEventListenerObject | ServerEventSourceListener | ServerEventSourceErrorListener) => void)
  close: () => void
}

const CONNECTING = 0 as const
const OPEN = 1 as const
const CLOSED = 2 as const

const DEFAULT_RECONNECT_DELAY_MS = 1_000
const DEFAULT_MAX_RECONNECT_DELAY_MS = 30_000

export function openServerEventSource(
  input: RequestInfo | URL,
  options: OpenServerEventSourceOptions = {},
): ServerEventSource {
  return new FetchEventSource(input, options)
}

class FetchEventSource implements ServerEventSource {
  onopen: ((event: Event) => void) | null = null
  onmessage: ServerEventSourceListener | null = null
  onerror: ServerEventSourceErrorListener | null = null

  private readyStateValue: 0 | 1 | 2 = CONNECTING
  private urlValue: string
  private readonly initialInput: RequestInfo | URL
  private readonly options: OpenServerEventSourceOptions
  private readonly listeners = new Map<string, Set<(event: Event) => void>>()
  private readonly abortController = new AbortController()
  private lastEventId: string | null = null
  private retryDelayMs: number
  private attempt = 0
  private closed = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(input: RequestInfo | URL, options: OpenServerEventSourceOptions) {
    this.initialInput = input
    this.options = options
    this.urlValue = resolveInputUrl(input)
    this.retryDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS
    options.signal?.addEventListener('abort', () => this.close(), { once: true })
    void this.connect()
  }

  get url(): string {
    return this.urlValue
  }

  get readyState(): 0 | 1 | 2 {
    return this.readyStateValue
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | ServerEventSourceListener | ServerEventSourceErrorListener,
  ): void {
    const set = this.listeners.get(type) ?? new Set()
    set.add(normalizeListener(listener))
    this.listeners.set(type, set)
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | ServerEventSourceListener | ServerEventSourceErrorListener,
  ): void {
    this.listeners.get(type)?.delete(normalizeListener(listener))
  }

  close(): void {
    if (this.closed) {
      return
    }
    this.closed = true
    this.readyStateValue = CLOSED
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.abortController.abort()
  }

  private async connect(): Promise<void> {
    if (this.closed || this.abortController.signal.aborted) {
      return
    }

    this.readyStateValue = CONNECTING
    const fetchImpl = this.options.fetch ?? cradleFetch
    const requestInput = this.options.buildRequest?.({
      lastEventId: this.lastEventId,
      attempt: this.attempt,
    }) ?? this.initialInput
    this.urlValue = resolveInputUrl(requestInput)

    const headers = new Headers(requestInput instanceof Request ? requestInput.headers : undefined)
    headers.set('accept', 'text/event-stream')
    if (this.lastEventId) {
      headers.set('last-event-id', this.lastEventId)
    }

    try {
      const response = await fetchImpl(requestInput, {
        headers,
        signal: this.abortController.signal,
        cache: 'no-store',
      })
      if (this.closed) {
        return
      }
      if (!response.ok) {
        throw new Error(`SSE HTTP ${response.status}`)
      }
      if (!response.body) {
        throw new Error('SSE response missing body')
      }

      this.readyStateValue = OPEN
      this.attempt = 0
      this.dispatch('open', new Event('open'))
      this.onopen?.(new Event('open'))

      const parser = createParser({
        onEvent: event => this.handleParsedEvent(event),
        onRetry: (retry) => {
          this.retryDelayMs = retry
        },
      })

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      while (!this.closed) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        parser.feed(decoder.decode(value, { stream: true }))
      }
      parser.reset({ consume: true })
      if (!this.closed) {
        this.scheduleReconnect(new Error('SSE stream ended'))
      }
    }
    catch (error) {
      if (this.closed || this.abortController.signal.aborted) {
        return
      }
      this.scheduleReconnect(error)
    }
  }

  private handleParsedEvent(event: EventSourceMessage): void {
    if (event.id) {
      this.lastEventId = event.id
    }
    const type = event.event?.trim() || 'message'
    const message = new MessageEvent(type, { data: event.data })
    this.dispatch(type, message)
    if (type === 'message') {
      this.onmessage?.(message)
    }
  }

  private scheduleReconnect(error: unknown): void {
    if (this.closed) {
      return
    }
    this.readyStateValue = CONNECTING
    const errorEvent = new Event('error')
    this.dispatch('error', errorEvent)
    this.onerror?.(errorEvent)

    const decision = this.options.shouldReconnect?.({
      attempt: this.attempt,
      lastEventId: this.lastEventId,
      error,
    }) ?? true
    if (decision === false) {
      this.close()
      return
    }

    const maxDelay = this.options.maxReconnectDelayMs ?? DEFAULT_MAX_RECONNECT_DELAY_MS
    const delay = typeof decision === 'number'
      ? Math.max(0, decision)
      : Math.min(this.retryDelayMs * (2 ** this.attempt), maxDelay)
    this.attempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.connect()
    }, delay)
  }

  private dispatch(type: string, event: Event): void {
    const set = this.listeners.get(type)
    if (!set) {
      return
    }
    for (const listener of set) {
      listener(event)
    }
  }
}

function resolveInputUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input
  }
  if (input instanceof URL) {
    return input.toString()
  }
  return input.url
}

function normalizeListener(
  listener: EventListenerOrEventListenerObject | ServerEventSourceListener | ServerEventSourceErrorListener,
): (event: Event) => void {
  if (typeof listener === 'function') {
    return listener as (event: Event) => void
  }
  return event => listener.handleEvent(event)
}
