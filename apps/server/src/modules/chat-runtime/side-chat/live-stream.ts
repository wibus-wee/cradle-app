import type { UIMessage, UIMessageChunk } from 'ai'

import { projectChatChunkForClient } from '../client-message-projection'
import { serializeChatError } from '../run/errors'
import type { FinalMessageProjectionRun } from '../run/final-message-projection'
import {
  createFinalMessageProjectionState,
  flushFinalMessageProjection,
  projectFinalMessageChunk,
} from '../run/final-message-projection'
import { isTerminalUIMessageChunk } from '../run/stream-chunks'
import type {
  ChatRuntime,
  ChatThinkingEffort,
  RuntimeProviderTargetProfile,
  RuntimeSession,
  RuntimeSettings,
} from '../runtime-provider-types'
import { createAssistantMessage } from '../ui-message'

export interface LiveSideConversationStreamInput {
  runId: string
  runtime: ChatRuntime
  runtimeSession: RuntimeSession
  profile: RuntimeProviderTargetProfile
  message: UIMessage
  responseMessageId: string
  modelId?: string
  thinkingEffort?: ChatThinkingEffort
  runtimeSettings: RuntimeSettings
  systemPrompt?: string
  history?: UIMessage[]
  onComplete?: (assistantMessage: UIMessage) => void
  workspaceId?: string | null
  workspacePath?: string
  agentId?: string | null
}

export function createLiveSideConversationStream(
  input: LiveSideConversationStreamInput,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const controller = new AbortController()

  let iterator: AsyncIterator<UIMessageChunk> | null = null
  const sideProjection = createSideMessageProjection(input.responseMessageId)
  let terminalPublished = false
  let completed = false
  let finished = false

  const encodeFrame = (chunk: UIMessageChunk): Uint8Array => {
    return encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)
  }

  /**
   * Pull-driven consumption keeps memory bounded when the consumer stalls:
   * the provider iterable is only advanced when the client actually reads,
   * so nothing accumulates server-side. Side effects (projection, completion
   * persistence) stay tied to consumed chunks exactly as before.
   */
  return new ReadableStream<Uint8Array>({
    async pull(streamController) {
      if (finished || terminalPublished) {
        return
      }
      const finishWithoutFlush = () => {
        if (finished) {
          return
        }
        finished = true
        try {
          streamController.close()
        }
        catch {
        }
      }
      try {
        if (!iterator) {
          streamController.enqueue(encodeFrame({ type: 'start', messageId: input.responseMessageId }))
          iterator = input.runtime.streamTurn({
            runId: input.runId,
            runtimeSession: input.runtimeSession,
            profile: input.profile,
            message: input.message,
            responseMessageId: input.responseMessageId,
            modelId: input.modelId,
            history: input.history,
            workspaceId: input.workspaceId,
            workspacePath: input.workspacePath,
            agentId: input.agentId,
            providerOptions:
              input.thinkingEffort || input.runtimeSettings
                ? {
                    ...(input.thinkingEffort ? { thinkingEffort: input.thinkingEffort } : {}),
                    runtimeSettings: input.runtimeSettings,
                  }
                : undefined,
            systemPrompt: input.systemPrompt,
          })[Symbol.asyncIterator]()
        }

        if (controller.signal.aborted) {
          terminalPublished = true
          streamController.enqueue(encodeFrame({ type: 'abort', reason: 'user' } as UIMessageChunk))
          streamController.enqueue(encoder.encode('data: [DONE]\n\n'))
          finishWithoutFlush()
          return
        }

        const { value: chunk, done } = await iterator.next()
        if (finished || terminalPublished) {
          return
        }
        if (done) {
          terminalPublished = true
          completed = true
          streamController.enqueue(encodeFrame({ type: 'finish', finishReason: 'stop' }))
          streamController.enqueue(encoder.encode('data: [DONE]\n\n'))
          flushFinalMessageProjection(sideProjection)
          input.onComplete?.(sideProjection.finalMessage)
          finishWithoutFlush()
          return
        }
        if (chunk.type === 'start') {
          // Provider start frames are folded into our synthetic start frame;
          // returning without enqueueing triggers the next pull.
          return
        }
        projectFinalMessageChunk(sideProjection, chunk)
        const terminal = isTerminalUIMessageChunk(chunk)
        if (terminal) {
          terminalPublished = true
          completed = chunk.type === 'finish'
        }
        const clientChunk = projectChatChunkForClient(chunk)
        if (clientChunk) {
          streamController.enqueue(encodeFrame(clientChunk))
        }
        if (terminal) {
          streamController.enqueue(encoder.encode('data: [DONE]\n\n'))
          flushFinalMessageProjection(sideProjection)
          if (completed) {
            input.onComplete?.(sideProjection.finalMessage)
          }
          finishWithoutFlush()
        }
      }
      catch (error) {
        terminalPublished = true
        if (controller.signal.aborted) {
          streamController.enqueue(encodeFrame({ type: 'abort', reason: 'user' } as UIMessageChunk))
        }
        else {
          streamController.enqueue(encodeFrame({ type: 'error', errorText: serializeChatError(error).text }))
        }
        streamController.enqueue(encoder.encode('data: [DONE]\n\n'))
        finishWithoutFlush()
      }
    },
    async cancel() {
      controller.abort()
      try {
        await input.runtime.cancelTurn({
          runtimeSession: input.runtimeSession,
          profile: input.profile,
        })
      }
      catch {
        /* best-effort live side cancellation */
      }
    },
  })
}

function createSideMessageProjection(messageId: string): FinalMessageProjectionRun {
  return {
    finalMessage: createAssistantMessage(messageId),
    finalProjection: createFinalMessageProjectionState(),
  }
}
