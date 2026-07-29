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
  response: Response
}

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
      onMessage(structuredClone(target.message))
    }
    finalizeUIMessageStreamState(target)
    onMessage(structuredClone(target.message))
  }
  finally {
    reader.releaseLock()
  }
}

export function createUIMessageChunkStream(response: Response): ReadableStream<UIMessageChunk> {
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
