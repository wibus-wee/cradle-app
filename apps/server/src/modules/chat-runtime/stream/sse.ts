import type { UIMessageChunk } from 'ai'

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

export function openBufferedChunkStream(input: BufferedChunkStreamInput): ReadableStream<Uint8Array> {
  let unsubscribe = () => {}
  let queuedChunk: UIMessageChunk | null = null
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let closed = false
  const clearQueuedFlush = () => {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    queuedChunk = null
  }

  const chunkStream = new ReadableStream<ChunkStreamItem>({
    start: (controller) => {
      const clearFlushTimer = () => {
        if (flushTimer) {
          clearTimeout(flushTimer)
          flushTimer = null
        }
      }

      const closeStream = (flushQueued: boolean) => {
        if (closed) {
          return
        }
        if (flushQueued) {
          clearFlushTimer()
          flushQueuedChunk()
        }
        closed = true
        clearQueuedFlush()
        unsubscribe()
        controller.close()
      }

      const writeChunkToStream = (chunk: UIMessageChunk, terminal: boolean) => {
        if (closed) {
          return
        }
        controller.enqueue({ kind: 'chunk', chunk })
        if (terminal) {
          closeStream(false)
        }
      }

      const flushQueuedChunk = () => {
        flushTimer = null
        const chunk = queuedChunk
        queuedChunk = null
        if (chunk) {
          writeChunkToStream(chunk, false)
        }
      }

      const scheduleFlush = () => {
        flushTimer ??= setTimeout(flushQueuedChunk, 0)
      }

      const writeChunk = (chunk: UIMessageChunk, terminal: boolean) => {
        if (closed) {
          return
        }
        if (terminal) {
          clearFlushTimer()
          flushQueuedChunk()
          writeChunkToStream(chunk, true)
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

      for (const chunk of input.replayChunks) {
        const terminal = isTerminalUIMessageChunk(chunk)
        writeChunk(chunk, terminal)
        if (terminal) {
          return
        }
      }
      clearFlushTimer()
      flushQueuedChunk()
      controller.enqueue({ kind: 'replay-end' })

      if (input.terminal || input.shouldCloseWithoutSubscriber) {
        closeStream(true)
        return
      }

      unsubscribe = input.subscribe((chunk, terminal) => writeChunk(chunk, terminal))
    },
    cancel: () => {
      closed = true
      clearQueuedFlush()
      unsubscribe()
    },
  })

  return encodeChunkStreamAsSse(chunkStream)
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
        controller.enqueue({ kind: 'chunk', chunk })
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
