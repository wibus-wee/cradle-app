import type { UIMessageStreamTarget } from '@cradleapp/ai-sdk'
import {
  applyUIMessageChunk,
  createUIMessageStreamState,
  finalizeUIMessageStreamState,
  flushUIMessageStreamState,
  flushUIMessageStreamToolInputs,
} from '@cradleapp/ai-sdk'
import type { UIMessage, UIMessageChunk } from 'ai'
import { uiMessageChunkSchema } from 'ai'

import type { CradleResponse } from '@/lib/transport/types'

type UIMessageChunkValidationResult
  = | { success: true, value: UIMessageChunk }
    | { success: false, error: Error }

interface UIMessageChunkValidator {
  validate: (
    value: unknown,
  ) => UIMessageChunkValidationResult | PromiseLike<UIMessageChunkValidationResult>
}

interface ConsumeChatMessageStreamOptions {
  messageId: string
  onMessage: (message: UIMessage) => void
  response: CradleResponse
}

const STREAM_RENDER_INTERVAL_MS = 125

export async function consumeChatMessageStream({
  messageId,
  onMessage,
  response,
}: ConsumeChatMessageStreamOptions): Promise<void> {
  const target: UIMessageStreamTarget = {
    message: {
      id: messageId,
      role: 'assistant',
      parts: [],
    },
    state: createUIMessageStreamState(),
  }
  const reader = createUIMessageChunkStream(response).getReader()
  const renderUpdates = createStreamMessageEmitter(target, onMessage)

  try {
    while (true) {
      const next = await reader.read()
      if (next.done) {
        break
      }
      const chunk = next.value
      if (chunk.type === 'error') {
        throw new Error(chunk.errorText)
      }
      applyUIMessageChunk(target, chunk)
      flushUIMessageStreamState(target)
      if (chunk.type === 'tool-input-delta') {
        await flushUIMessageStreamToolInputs(target)
      }
      renderUpdates.request()
    }
    finalizeUIMessageStreamState(target)
    renderUpdates.flush()
  }
  finally {
    renderUpdates.cancel()
    reader.releaseLock()
  }
}

function createStreamMessageEmitter(
  target: UIMessageStreamTarget,
  onMessage: (message: UIMessage) => void,
) {
  let lastEmittedAt = 0
  let pending = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (!pending) {
      return
    }
    pending = false
    lastEmittedAt = Date.now()
    onMessage(structuredClone(target.message))
  }

  const cancel = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    pending = false
  }

  const request = () => {
    pending = true
    const remaining = STREAM_RENDER_INTERVAL_MS - (Date.now() - lastEmittedAt)
    if (remaining <= 0) {
      flush()
      return
    }
    if (timer === null) {
      timer = setTimeout(flush, remaining)
    }
  }

  return { cancel, flush, request }
}

export function createUIMessageChunkStream(response: CradleResponse): ReadableStream<UIMessageChunk> {
  if (!response.body) {
    throw new Error('Chat stream has no response body.')
  }

  const schema = uiMessageChunkSchema() as UIMessageChunkValidator
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  return new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      while (true) {
        const frame = readCompleteFrame()
        if (frame !== null) {
          const data = readSseData(frame)
          if (data === null) {
            continue
          }
          if (data === '[DONE]') {
            controller.close()
            await reader.cancel().catch(() => undefined)
            return
          }

          const result = await schema.validate(JSON.parse(data))
          if (!result.success) {
            throw result.error
          }
          controller.enqueue(result.value)
          return
        }

        const next = await reader.read()
        if (next.done) {
          buffer += decoder.decode()
          const finalFrame = buffer.trim()
          buffer = ''
          if (finalFrame) {
            const data = readSseData(finalFrame)
            if (data && data !== '[DONE]') {
              const result = await schema.validate(JSON.parse(data))
              if (!result.success) {
                throw result.error
              }
              controller.enqueue(result.value)
              return
            }
          }
          controller.close()
          return
        }
        buffer += decoder.decode(next.value, { stream: true })
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined)
    },
  })

  function readCompleteFrame(): string | null {
    const normalized = buffer.replace(/\r\n/g, '\n')
    const boundary = normalized.indexOf('\n\n')
    if (boundary === -1) {
      return null
    }
    const frame = normalized.slice(0, boundary)
    buffer = normalized.slice(boundary + 2)
    return frame
  }
}

function readSseData(frame: string): string | null {
  const data = frame
    .split('\n')
    .filter(line => line.startsWith('data:'))
    .map((line) => {
      const value = line.slice('data:'.length)
      return value.startsWith(' ') ? value.slice(1) : value
    })
  return data.length > 0 ? data.join('\n') : null
}
