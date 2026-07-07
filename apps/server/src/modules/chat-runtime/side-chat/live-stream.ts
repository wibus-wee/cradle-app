import type { UIMessage, UIMessageChunk } from 'ai'

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
  ChatRuntimeSettings,
  ChatThinkingEffort,
  RuntimeProviderTargetProfile,
  RuntimeSession,
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
  runtimeSettings: ChatRuntimeSettings
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

  return new ReadableStream<Uint8Array>({
    async start(streamController) {
      let terminalPublished = false
      const publish = (chunk: UIMessageChunk, terminal = isTerminalUIMessageChunk(chunk)) => {
        if (terminalPublished) {
          return
        }
        streamController.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
        if (terminal) {
          terminalPublished = true
          streamController.enqueue(encoder.encode('data: [DONE]\n\n'))
        }
      }

      try {
        publish({ type: 'start', messageId: input.responseMessageId }, false)
        const sideProjection = createSideMessageProjection(input.responseMessageId)
        let completed = false
        for await (const chunk of input.runtime.streamTurn({
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
        })) {
          if (controller.signal.aborted) {
            publish({ type: 'abort', reason: 'user' }, true)
            break
          }
          if (chunk.type === 'start') {
            continue
          }
          projectFinalMessageChunk(sideProjection, chunk)
          if (isTerminalUIMessageChunk(chunk)) {
            completed = chunk.type === 'finish'
          }
          publish(chunk)
        }
        if (!terminalPublished) {
          publish({ type: 'finish', finishReason: 'stop' }, true)
          completed = true
        }
        flushFinalMessageProjection(sideProjection)
        if (completed) {
          input.onComplete?.(sideProjection.finalMessage)
        }
      }
 catch (error) {
        if (controller.signal.aborted) {
          publish({ type: 'abort', reason: 'user' }, true)
        }
 else {
          publish({ type: 'error', errorText: serializeChatError(error).text }, true)
        }
      }
 finally {
        streamController.close()
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
