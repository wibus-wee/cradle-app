export interface EventSubscription<TEvent> {
  subscribe: (listener: (event: TEvent) => void) => () => void
}

export interface SseEventStreamOptions<TEvent> {
  source: EventSubscription<TEvent>
  signal: AbortSignal
  maxBufferedEvents?: number
  keepAliveMs?: number
}

const encoder = new TextEncoder()
const DEFAULT_MAX_BUFFERED_EVENTS = 64
const DEFAULT_KEEP_ALIVE_MS = 15_000

/**
 * Adapts an in-process subscription to SSE with bounded, latest-first buffering.
 * The stream owns the subscription lifetime: cancel or request abort always
 * unsubscribes and clears its keepalive timer.
 */
export function openSseEventStream<TEvent>(options: SseEventStreamOptions<TEvent>): ReadableStream<Uint8Array> {
  const maxBufferedEvents = Math.max(1, options.maxBufferedEvents ?? DEFAULT_MAX_BUFFERED_EVENTS)
  const keepAliveMs = options.keepAliveMs ?? DEFAULT_KEEP_ALIVE_MS
  let unsubscribe: (() => void) | null = null
  let keepAlive: ReturnType<typeof setInterval> | null = null
  let abortListener: (() => void) | null = null
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  let closed = false
  const pending: TEvent[] = []

  const cleanup = () => {
    if (closed) {
      return
    }
    closed = true
    pending.length = 0
    unsubscribe?.()
    unsubscribe = null
    if (keepAlive) {
      clearInterval(keepAlive)
      keepAlive = null
    }
    if (abortListener) {
      options.signal.removeEventListener('abort', abortListener)
      abortListener = null
    }
  }

  const flush = () => {
    if (closed || !controller) {
      return
    }
    while (pending.length > 0 && (controller.desiredSize ?? 0) > 0) {
      const event = pending.shift()!
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
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
          if (pending.length >= maxBufferedEvents) {
            pending.shift()
          }
          pending.push(event)
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
    },
    pull() {
      flush()
    },
    cancel() {
      cleanup()
    },
  })
}
