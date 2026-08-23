import type { UIMessageChunk } from 'ai'

import type { DeliveryStallWatchdog } from '../../../infra/sse-event-stream'
import {
  DEFAULT_STREAM_STALL_MS,
  sseStreamPressureCounters,
  startDeliveryStallWatchdog,
} from '../../../infra/sse-event-stream'
import { projectChatChunkForClient } from '../client-message-projection'
import { serializeChatError } from '../run/errors'
import { isTerminalUIMessageChunk, mergeBufferedStreamChunk } from '../run/stream-chunks'
import type { ChunkSubscriber } from './subscriber-registry'

export type { ChunkSubscriber } from './subscriber-registry'

export interface BufferedChunkStreamInput {
  replayChunks: UIMessageChunk[]
  terminal?: boolean
  shouldCloseWithoutSubscriber?: boolean
  coalesceMaxChars: number
  subscribe: (subscriber: ChunkSubscriber) => () => void
  /** Backlog cap before the overflow-close policy ends the stream. */
  maxBufferedEvents?: number
  maxBufferedBytes?: number
  /** Consumer-stall watchdog window. */
  stallMs?: number
}

const encoder = new TextEncoder()
const STREAM_OPEN_COMMENT = ': cradle-stream-open\n\n'
const REPLAY_END_COMMENT = ': cradle-replay-end\n\n'

type ChunkStreamItem
  = | { kind: 'chunk', chunk: UIMessageChunk }
    | { kind: 'replay-end' }

export function bindReadableStreamToAbortSignal<T>(
  stream: ReadableStream<T>,
  signal: AbortSignal,
): ReadableStream<T> {
  const reader = stream.getReader()
  let abortListener: (() => void) | null = null
  let closed = false
  let readerReleased = false

  const detachAbortListener = () => {
    if (!abortListener) {
      return
    }
    signal.removeEventListener('abort', abortListener)
    abortListener = null
  }

  const releaseReader = () => {
    if (readerReleased) {
      return
    }
    readerReleased = true
    reader.releaseLock()
  }

  return new ReadableStream<T>({
    start(controller) {
      const abort = () => {
        if (closed) {
          return
        }
        closed = true
        detachAbortListener()
        void reader.cancel(createStreamAbortError())
          .catch(() => undefined)
          .finally(releaseReader)
        controller.error(createStreamAbortError())
      }

      abortListener = abort
      if (signal.aborted) {
        abort()
        return
      }
      signal.addEventListener('abort', abort, { once: true })
    },
    async pull(controller) {
      if (closed) {
        return
      }
      try {
        const result = await reader.read()
        if (closed) {
          return
        }
        if (result.done) {
          closed = true
          detachAbortListener()
          releaseReader()
          controller.close()
          return
        }
        controller.enqueue(result.value)
      }
 catch (error) {
        if (closed) {
          return
        }
        closed = true
        detachAbortListener()
        releaseReader()
        controller.error(error)
      }
    },
    async cancel(reason) {
      if (closed) {
        return
      }
      closed = true
      detachAbortListener()
      await reader.cancel(reason).catch(() => undefined)
      releaseReader()
    },
  })
}

function createStreamAbortError(): DOMException {
  return new DOMException('Readable stream aborted by request signal', 'AbortError')
}

/**
 * Shared SSE encoding tail used by every chunk stream.
 */
function encodeChunkStreamAsSse(stream: ReadableStream<ChunkStreamItem>): ReadableStream<Uint8Array> {
  return stream.pipeThrough(
    new TransformStream<ChunkStreamItem, Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(STREAM_OPEN_COMMENT))
      },
      transform: (item, controller) => {
        if (item.kind === 'replay-end') {
          controller.enqueue(encoder.encode(REPLAY_END_COMMENT))
          return
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(item.chunk)}\n\n`))
      },
      flush(controller) {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      },
    }),
  )
}

const CHUNK_STREAM_MAX_BUFFERED_EVENTS = 128
const CHUNK_STREAM_MAX_BUFFERED_BYTES = 1024 * 1024

interface BufferedChunkItem {
  bytes: Uint8Array
  chars: number
}

export function openBufferedChunkStream(input: BufferedChunkStreamInput): ReadableStream<Uint8Array> {
  const maxBufferedEvents = Math.max(1, input.maxBufferedEvents ?? CHUNK_STREAM_MAX_BUFFERED_EVENTS)
  const maxBufferedBytes = Math.max(1, input.maxBufferedBytes ?? CHUNK_STREAM_MAX_BUFFERED_BYTES)
  let unsubscribe = () => {}
  let queuedChunk: UIMessageChunk | null = null
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let closed = false
  let terminalAfterDrain = false
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null
  let watchdog: DeliveryStallWatchdog | null = null
  const pending: BufferedChunkItem[] = []
  let pendingChars = 0

  const clearQueuedFlush = () => {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    queuedChunk = null
  }

  const stopProducer = () => {
    unsubscribe()
    unsubscribe = () => {}
  }

  const finish = (closeController: boolean) => {
    if (closed) {
      return
    }
    closed = true
    clearQueuedFlush()
    stopProducer()
    watchdog?.stop()
    watchdog = null
    pending.length = 0
    pendingChars = 0
    if (closeController) {
      try {
        controllerRef?.close()
      }
      catch {
      }
    }
  }

  /**
   * Overflow policy `close`: the consumer stopped keeping up, so stop the
   * producer, drop the backlog and end the stream. Clients recover losslessly
   * through cursor + snapshot reconnect (Plan 071).
   */
  const overflowClose = () => {
    if (closed) {
      return
    }
    sseStreamPressureCounters.overflowCloses += 1
    pending.length = 0
    pendingChars = 0
    terminalAfterDrain = true
    clearQueuedFlush()
    stopProducer()
    if (controllerRef) {
      drain(controllerRef)
    }
  }

  function drain(controller: ReadableStreamDefaultController<Uint8Array>, pullRequested = false) {
    if (closed) {
      return
    }
    while (
      pending.length > 0
      && (pullRequested || (controller.desiredSize ?? 0) > 0)
    ) {
      const item = pending.shift()!
      pendingChars -= item.chars
      controller.enqueue(item.bytes)
      watchdog?.touch()
      pullRequested = false
    }
    if (!closed && terminalAfterDrain && pending.length === 0) {
      finish(true)
    }
  }

  const encodeChunkItem = (item: ChunkStreamItem): BufferedChunkItem => {
    if (item.kind === 'replay-end') {
      return { bytes: encoder.encode(REPLAY_END_COMMENT), chars: REPLAY_END_COMMENT.length }
    }
    const text = `data: ${JSON.stringify(item.chunk)}\n\n`
    return { bytes: encoder.encode(text), chars: text.length }
  }

  /**
   * Emits the terminal `[DONE]` frame and marks the stream to close once the
   * backlog drains. The frame is force-accepted: under backlog pressure the
   * oldest buffered chunks are evicted so a clean terminal always lands.
   */
  const beginTerminal = () => {
    if (closed || terminalAfterDrain) {
      return
    }
    const done = encoder.encode('data: [DONE]\n\n')
    while (
      pending.length > 0
      && (pending.length + 1 > maxBufferedEvents || pendingChars + done.length > maxBufferedBytes)
    ) {
      const evicted = pending.shift()!
      pendingChars -= evicted.chars
    }
    pending.push({ bytes: done, chars: done.length })
    pendingChars += done.length
    terminalAfterDrain = true
    clearQueuedFlush()
    stopProducer()
    if (controllerRef) {
      drain(controllerRef)
    }
  }

  const pushItem = (item: ChunkStreamItem) => {
    if (closed || terminalAfterDrain) {
      return
    }
    const encoded = encodeChunkItem(item)
    // A single oversized chunk (e.g. a recovery snapshot) is always accepted;
    // the caps exist to bound backlog accumulation, not to reject real events.
    // While an oversized item dominates the buffer, the count cap keeps the
    // backlog bounded instead of closing on every follow-up event.
    const byteOver = pendingChars + encoded.chars > maxBufferedBytes && pendingChars <= maxBufferedBytes
    if (
      pending.length > 0
      && (pending.length + 1 > maxBufferedEvents || byteOver)
    ) {
      overflowClose()
      return
    }
    pending.push(encoded)
    pendingChars += encoded.chars
    if (controllerRef) {
      drain(controllerRef)
    }
  }

  /** Clears only the coalescing timer; the queued chunk stays pending. */
  const clearFlushTimer = () => {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
  }

  const flushQueuedChunk = () => {
    flushTimer = null
    const chunk = queuedChunk
    queuedChunk = null
    if (chunk) {
      pushItem({ kind: 'chunk', chunk })
    }
  }

  const scheduleFlush = () => {
    flushTimer ??= setTimeout(flushQueuedChunk, 0)
  }

  const writeChunk = (chunk: UIMessageChunk, terminal: boolean) => {
    if (closed || terminalAfterDrain) {
      return
    }
    if (terminal) {
      if (queuedChunk) {
        clearFlushTimer()
        flushQueuedChunk()
        if (closed || terminalAfterDrain) {
          return
        }
      }
      pushItem({ kind: 'chunk', chunk })
      beginTerminal()
      return
    }
    if (!queuedChunk) {
      queuedChunk = chunk
      scheduleFlush()
      return
    }
    const merged = mergeBufferedStreamChunk(queuedChunk, chunk, input.coalesceMaxChars)
    if (merged) {
      queuedChunk = merged
      scheduleFlush()
      return
    }
    flushQueuedChunk()
    queuedChunk = chunk
    scheduleFlush()
  }

  const chunkStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller
      controller.enqueue(encoder.encode(STREAM_OPEN_COMMENT))
      watchdog = startDeliveryStallWatchdog({
        stallMs: input.stallMs ?? DEFAULT_STREAM_STALL_MS,
        isClosed: () => closed,
        isBuffering: () => pending.length > 0,
        onStall: overflowClose,
      })
      if (!input.terminal && !input.shouldCloseWithoutSubscriber) {
        unsubscribe = input.subscribe((chunk, terminal) => writeChunk(chunk, terminal))
      }

      for (const chunk of input.replayChunks) {
        const terminal = isTerminalUIMessageChunk(chunk)
        writeChunk(chunk, terminal)
        if (terminal || closed) {
          return
        }
      }
      if (closed) {
        return
      }
      clearFlushTimer()
      flushQueuedChunk()
      if (closed || terminalAfterDrain) {
        return
      }
      pushItem({ kind: 'replay-end' })

      if (input.terminal || input.shouldCloseWithoutSubscriber) {
        beginTerminal()
        return
      }
      drain(controller)
    },
    pull(controller) {
      drain(controller, true)
    },
    cancel() {
      finish(false)
    },
  })

  return chunkStream
}

/**
 * Stateless one-shot SSE stream for an async chunk iterable (e.g. quick-question).
 * No replay buffer, no subscriber registry. Terminal `[DONE]` is emitted by the
 * shared SSE transform on stream close.
 */
export function openDirectChunkStream(
  chunks: AsyncIterable<UIMessageChunk>,
): ReadableStream<Uint8Array> {
  const chunkStream = new ReadableStream<ChunkStreamItem>({
    async start(controller) {
      let terminalPublished = false
      const publish = (chunk: UIMessageChunk, terminal = isTerminalUIMessageChunk(chunk)) => {
        if (terminalPublished) {
          return
        }
        const clientChunk = projectChatChunkForClient(chunk)
        if (!clientChunk) {
          return
        }
        controller.enqueue({ kind: 'chunk', chunk: clientChunk })
        if (terminal) {
          terminalPublished = true
        }
      }
      try {
        for await (const chunk of chunks) {
          publish(chunk)
        }
        if (!terminalPublished) {
          publish({ type: 'finish', finishReason: 'stop' }, true)
        }
      }
 catch (error) {
        publish({ type: 'error', errorText: serializeChatError(error).text }, true)
      }
 finally {
        controller.close()
      }
    },
  })
  return encodeChunkStreamAsSse(chunkStream)
}
