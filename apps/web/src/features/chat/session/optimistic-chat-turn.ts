import type { QueryClient } from '@tanstack/react-query'
import type { FileUIPart, UIMessage } from 'ai'

import {
  getChatSessionsBySessionIdMessagesQueryKey,
  getSessionsByIdQueryKey,
} from '~/api-gen/@tanstack/react-query.gen'
import type { RuntimeKind } from '~/features/agent-runtime/types'
import { useChatStore } from '~/store/chat'
import { runtimeUiSlotStatesQueryKey } from '../capabilities/chat-capabilities'
import { ChatResponseRequestBody, ChatRuntimeSettingsPatch } from '../commands/chat-response-command'
import { runtimeSettingsQueryKey } from '../commands/runtime-settings-command'
import { ChatContextPart, toOrderedUserMessageParts } from '../context/chat-context-parts'
import { startChatResponseStream } from '../transport/chat-stream-transport'
import { ChatStreamingHandler } from '../transport/chat-streaming-handler'


interface OptimisticUserMessageInput {
  messageId: string
  text: string
  sourceText?: string
  files?: FileUIPart[]
  contextParts?: ChatContextPart[]
  runtimeKind?: RuntimeKind | null
}

interface StartOptimisticChatResponseInput {
  sessionId: string
  body: {
    text: string
    files?: FileUIPart[]
    contextParts?: ChatContextPart[]
    providerTargetId?: string
    modelId?: string | null
    thinkingEffort?: ChatResponseRequestBody['thinkingEffort']
    runtimeSettings?: ChatRuntimeSettingsPatch
  }
  runtimeKind?: RuntimeKind | null
  queryClient?: QueryClient
  onAccepted?: () => void
  onError?: (error: unknown) => void
  onSettled?: (result: { aborted: boolean, status: 'complete' | 'error' }) => void
}

export function readCodexGoalCommandObjective(text: string): string | null {
  const normalized = text.trimStart()
  if (!normalized.startsWith('/goal')) {
    return null
  }
  const nextChar = normalized.charAt('/goal'.length)
  if (nextChar && nextChar !== ' ' && nextChar !== '\t') {
    return null
  }
  const objective = normalized.slice('/goal'.length).trim()
  return objective.length > 0 ? objective : null
}

export function buildOptimisticUserMessage({
  messageId,
  text,
  sourceText = text,
  files = [],
  contextParts = [],
  runtimeKind,
}: OptimisticUserMessageInput): UIMessage {
  const trimmedText = text.trim()
  const goalObjective = runtimeKind === 'codex'
    ? readCodexGoalCommandObjective(trimmedText)
    : null
  const optimisticText = goalObjective ?? trimmedText
  const userParts = toOrderedUserMessageParts(optimisticText, contextParts, sourceText) as UIMessage['parts']
  userParts.push(...files)

  const message: UIMessage = {
    id: messageId,
    role: 'user',
    parts: userParts,
  }

  return goalObjective
    ? annotateCodexGoalMessage(message, goalObjective)
    : message
}

export function startOptimisticChatResponse({
  sessionId,
  body,
  runtimeKind,
  queryClient,
  onAccepted,
  onError,
  onSettled,
}: StartOptimisticChatResponseInput): AbortController {
  const startedAt = Date.now()
  const controller = new AbortController()
  const userMessageId = `user-${startedAt}`
  const assistantMessageId = `assistant-${startedAt}`
  const requestStartedAtMs = performance.now()

  useChatStore.getState().appendMessage(sessionId, buildOptimisticUserMessage({
    messageId: userMessageId,
    text: body.text,
    files: body.files ?? [],
    contextParts: body.contextParts ?? [],
    runtimeKind,
  }))

  const handler = new ChatStreamingHandler(sessionId, assistantMessageId, requestStartedAtMs)
  handler.start(controller)

  void (async () => {
    let status: 'complete' | 'error' = 'complete'
    try {
      const transport = await startChatResponseStream({
        sessionId,
        body,
        signal: controller.signal,
      })

      if (transport.runId) {
        useChatStore.getState().setRunDisplayId(assistantMessageId, transport.runId)
      }
      onAccepted?.()

      await handler.consume(transport.stream)
      handler.finish()
    }
    catch (error) {
      if (isAbortError(error)) {
        handler.finish()
      }
      else {
        status = 'error'
        handler.fail(error instanceof Error ? error.message : 'Stream failed')
        onError?.(error)
      }
    }
    finally {
      const aborted = controller.signal.aborted
      handler.dispose()
      const currentPassiveStatus = useChatStore.getState().sessionMetaMap.get(sessionId)?.passiveStatus
      useChatStore.getState().setSessionMeta(sessionId, {
        locallyDriving: false,
        localDriverMessageId: undefined,
        passiveStatus: currentPassiveStatus === 'streaming' ? 'streaming' : 'idle',
      })
      if (!aborted) {
        refreshChatResponseQueries(queryClient, sessionId)
      }
      onSettled?.({ aborted, status })
    }
  })()

  return controller
}

function annotateCodexGoalMessage(message: UIMessage, objective: string): UIMessage {
  const metadata = message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata)
    ? message.metadata as Record<string, unknown>
    : {}
  const cradleMetadata = metadata.cradle && typeof metadata.cradle === 'object' && !Array.isArray(metadata.cradle)
    ? metadata.cradle as Record<string, unknown>
    : {}
  return {
    ...message,
    metadata: {
      ...metadata,
      cradle: {
        ...cradleMetadata,
        goal: { objective },
      },
    },
  } as UIMessage
}

function refreshChatResponseQueries(queryClient: QueryClient | undefined, sessionId: string): void {
  if (!queryClient) {
    return
  }
  void queryClient.invalidateQueries({
    queryKey: getChatSessionsBySessionIdMessagesQueryKey({ path: { sessionId } }),
  })
  void queryClient.invalidateQueries({
    queryKey: getSessionsByIdQueryKey({ path: { id: sessionId } }),
  })
  void queryClient.invalidateQueries({ queryKey: runtimeUiSlotStatesQueryKey(sessionId) })
  void queryClient.invalidateQueries({ queryKey: runtimeSettingsQueryKey(sessionId) })
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
