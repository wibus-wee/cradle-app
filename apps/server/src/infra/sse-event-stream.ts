export interface EventSubscription<TEvent> {
  subscribe: (listener: (event: TEvent) => void) => () => void
}

export type SseOverflowPolicy = 'drop-oldest' | 'close'

export type SsePressureKind = 'overflow-dropped' | 'overflow-closed' | 'stall-closed'

export interface SsePressureInfo {
  kind: SsePressureKind
  bufferedEvents: number
  bufferedBytes: number
}

export interface SseEventStreamOptions<TEvent> {
  source: EventSubscription<TEvent>
  signal: AbortSignal
  maxBufferedEvents?: number
  maxBufferedBytes?: number
  overflow?: SseOverflowPolicy
  /**
   * Consumer-stall watchdog. When events stay buffered with no delivery
   * progress for longer than `stallMs`, the consumer is treated as dead
   * (suspended renderer, half-open TCP) and the stream closes.
   */
  stallMs?: number
  keepAliveMs?: number
  /**
   * Custom wire encoding per event. Defaults to a plain
   * `data: <json>` frame. Use it when a surface owns richer SSE framing
   * (`id:`/`event:` lines); the buffer caps measure its output bytes.
   */
  encodeEvent?: (event: TEvent) => Uint8Array
  /** Payload-free pressure hook for callers to wire into observability. */
  onPressure?: (info: SsePressureInfo) => void
}

const encoder = new TextEncoder()
const DEFAULT_MAX_BUFFERED_EVENTS = 64
const DEFAULT_MAX_BUFFERED_BYTES = 256 * 1024
const DEFAULT_KEEP_ALIVE_MS = 15_000
const DEFAULT_STALL_MS = 30_000
const STALL_CHECK_INTERVAL_MS = 1_000

/**
 * Shared default for consumer-stall reaping across every server stream.
 */
export const DEFAULT_STREAM_STALL_MS = DEFAULT_STALL_MS

export interface DeliveryStallWatchdog {
  /** Refreshes the delivery-progress timestamp. Call after real deliveries. */
  touch: () => void
  stop: () => void
}

export interface DeliveryStallWatchdogOptions {
  stallMs?: number
  isClosed: () => boolean
  isBuffering: () => boolean
  onStall: () => void
}

/**
 * Reaps consumers that stopped reading. A stream counts as stalled when it
 * keeps buffered data with no delivery progress for `stallMs`; this catches
 * suspended renderers and half-open TCP peers whose sockets never fire
 * `close`. Progress must be reported through `touch()` on actual deliveries.
 */
export function startDeliveryStallWatchdog(options: DeliveryStallWatchdogOptions): DeliveryStallWatchdog {
  const stallMs = Math.max(STALL_CHECK_INTERVAL_MS, options.stallMs ?? DEFAULT_STALL_MS)
  let progressAt = Date.now()
  const timer = setInterval(() => {
    if (options.isClosed()) {
      clearInterval(timer)
      return
    }
    if (!options.isBuffering()) {
      progressAt = Date.now()
      return
    }
    if (Date.now() - progressAt >= stallMs) {
      clearInterval(timer)
      options.onStall()
    }
  }, STALL_CHECK_INTERVAL_MS)
  return {
    touch: () => {
      progressAt = Date.now()
    },
    stop: () => {
      clearInterval(timer)
    },
  }
}

/**
 * Process-wide payload-free backpressure counters. Owners may publish these
 * through observability without retaining any event payload here.
 */
export const sseStreamPressureCounters = {
  droppedOldest: 0,
  overflowCloses: 0,
  stallCloses: 0,
}

interface BufferedChunk {
  bytes: Uint8Array
}

/**
 * Adapts an in-process subscription to SSE with bounded buffering and
 * consumer-pressure handling:
 * - Buffer is capped by both event count and encoded byte size.
 * - `drop-oldest` evicts the oldest buffered chunk; `close` stops the
 *   producer, drains what was already accepted, then closes the stream
 *   cleanly (clients recover via their own reconnect/cursor/snapshot path).
 * - A stall watchdog closes streams whose buffered events see no delivery
 *   progress for `stallMs`.
 * The stream owns the subscription lifetime: cancel or request abort always
 * unsubscribes and clears its timers.
 */
export function openSseEventStream<TEvent>(options: SseEventStreamOptions<TEvent>): ReadableStream<Uint8Array> {
  const maxBufferedEvents = Math.max(1, options.maxBufferedEvents ?? DEFAULT_MAX_BUFFERED_EVENTS)
  const maxBufferedBytes = Math.max(1, options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES)
  const closeOnOverflow = options.overflow === 'close'
  const keepAliveMs = options.keepAliveMs ?? DEFAULT_KEEP_ALIVE_MS
  const encodeEvent = options.encodeEvent ?? ((event: TEvent) => encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
  let unsubscribe: (() => void) | null = null
  let keepAlive: ReturnType<typeof setInterval> | null = null
  let abortListener: (() => void) | null = null
  let watchdog: DeliveryStallWatchdog | null = null
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  let closed = false
  let overflowClosed = false
  let bufferedBytes = 0
  const pending: BufferedChunk[] = []

  const reportPressure = (kind: SsePressureKind) => {
    options.onPressure?.({
      kind,
      bufferedEvents: pending.length,
      bufferedBytes,
    })
  }

  const cleanup = () => {
    if (closed) {
      return
    }
    closed = true
    pending.length = 0
    bufferedBytes = 0
    unsubscribe?.()
    unsubscribe = null
    if (keepAlive) {
      clearInterval(keepAlive)
      keepAlive = null
    }
    watchdog?.stop()
    watchdog = null
    if (abortListener) {
      options.signal.removeEventListener('abort', abortListener)
      abortListener = null
    }
  }

  /**
   * Delivers buffered chunks while the consumer accepts them. Delivery
   * progress doubles as the liveness signal for the stall watchdog.
   */
  const flush = () => {
    if (closed || !controller) {
      return
    }
    let delivered = false
    while (pending.length > 0 && (controller.desiredSize ?? 0) > 0) {
      const chunk = pending.shift()!
      bufferedBytes -= chunk.bytes.byteLength
      controller.enqueue(chunk.bytes)
      delivered = true
    }
    if (delivered) {
      watchdog?.touch()
    }
    if (overflowClosed && pending.length === 0 && !closed) {
      cleanup()
      controller.close()
    }
  }

  return new ReadableStream<Uint8Array>({
    start(nextController) {
      controller = nextController
      const close = () => {
        if (closed) {
          return
        }
        cleanup()
        nextController.close()
      }
      abortListener = close
      if (options.signal.aborted) {
        close()
        return
      }
      options.signal.addEventListener('abort', close, { once: true })
      nextController.enqueue(encoder.encode(': cradle-event-stream-open\n\n'))
      try {
        unsubscribe = options.source.subscribe((event) => {
          if (closed) {
            return
          }
          const chunk: BufferedChunk = { bytes: encodeEvent(event) }
          if (
            pending.length + 1 > maxBufferedEvents
            || bufferedBytes + chunk.bytes.byteLength > maxBufferedBytes
          ) {
            if (closeOnOverflow) {
              overflowClosed = true
              sseStreamPressureCounters.overflowCloses += 1
              reportPressure('overflow-closed')
              unsubscribe?.()
              unsubscribe = null
              flush()
              return
            }
            while (
              pending.length > 0
              && (pending.length + 1 > maxBufferedEvents || bufferedBytes + chunk.bytes.byteLength > maxBufferedBytes)
            ) {
              const evicted = pending.shift()!
              bufferedBytes -= evicted.bytes.byteLength
              sseStreamPressureCounters.droppedOldest += 1
            }
            reportPressure('overflow-dropped')
          }
          pending.push(chunk)
          bufferedBytes += chunk.bytes.byteLength
          flush()
        })
      }
      catch (error) {
        cleanup()
        nextController.error(error)
        return
      }
      keepAlive = setInterval(() => {
        if (!closed && controller && (controller.desiredSize ?? 0) > 0) {
          controller.enqueue(encoder.encode(': keepalive\n\n'))
        }
      }, keepAliveMs)
      watchdog = startDeliveryStallWatchdog({
        stallMs: options.stallMs,
        isClosed: () => closed || overflowClosed,
        isBuffering: () => pending.length > 0,
        onStall: () => {
          sseStreamPressureCounters.stallCloses += 1
          reportPressure('stall-closed')
          close()
        },
      })
    },
    pull() {
      flush()
    },
    cancel() {
      cleanup()
    },
  })
}
