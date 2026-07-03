import type { FileUIPart, UIMessage } from 'ai'

import { useRendererChatStore } from '~/store/renderer-chat'

import type { ChatRuntimeSettingsPatch, ChatThinkingEffort } from '../chat/commands/chat-response-command'
import { startSideConversationResponse } from '../chat/commands/chat-response-command'
import type { ChatContextPart } from '../chat/context/chat-context-parts'
import { toOrderedUserMessageParts } from '../chat/context/chat-context-parts'
import { ChatStreamingHandler } from '../chat/transport/chat-streaming-handler'
import { buildUIMessageChunkStreamFromResponse } from '../chat/transport/sse-chat-transport'

export interface SubmitSideConversationMessageInput {
  sideConversationId: string
  text: string
  files?: FileUIPart[]
  contextParts?: ChatContextPart[]
  modelId?: string
  thinkingEffort?: ChatThinkingEffort | null | undefined
  runtimeSettings?: ChatRuntimeSettingsPatch
}

export function buildSideConversationViewId(sideConversationId: string): string {
  return `side:${sideConversationId}`
}

export async function submitSideConversationMessage(input: SubmitSideConversationMessageInput): Promise<void> {
  const text = input.text.trim()
  const files = input.files ?? []
  const contextParts = input.contextParts ?? []
  if (!text && files.length === 0 && contextParts.length === 0) {
    return
  }

  const viewSessionId = buildSideConversationViewId(input.sideConversationId)
  const userMessageId = `side-user-${Date.now()}`
  const userParts = toOrderedUserMessageParts(text, contextParts, input.text) as UIMessage['parts']
  userParts.push(...files)
  useRendererChatStore.getState().appendMessage(viewSessionId, {
    id: userMessageId,
    role: 'user',
    parts: userParts,
  })

  const assistantMessageId = `side-assistant-${Date.now()}`
  const controller = new AbortController()
  const handler = new ChatStreamingHandler(
    viewSessionId,
    assistantMessageId,
    performance.now(),
    {
      mode: 'local',
      useStoredMessageSnapshot: false,
      store: useRendererChatStore,
      emitSettledEvents: false,
    },
  )
  handler.start(controller)

  try {
    const response = await startSideConversationResponse({
      sideConversationId: input.sideConversationId,
      body: {
        text,
        files,
        contextParts,
        modelId: input.modelId,
        thinkingEffort: input.thinkingEffort === null ? undefined : input.thinkingEffort,
        runtimeSettings: input.runtimeSettings,
      },
      signal: controller.signal,
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Failed to start side response: ${response.status} ${body}`)
    }
    const runId = response.headers.get('x-cradle-run-id')
    if (runId) {
      useRendererChatStore.getState().setRunDisplayId(assistantMessageId, runId)
    }
    await handler.consume(buildUIMessageChunkStreamFromResponse(response, viewSessionId))
    handler.finish()
  }
  catch (error) {
    if (!controller.signal.aborted) {
      handler.fail(error instanceof Error ? error.message : 'Side response failed')
    }
  }
}
