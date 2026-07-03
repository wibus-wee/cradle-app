import { randomUUID } from 'node:crypto'

import type { FileUIPart } from 'ai'

import { AppError } from '../../../errors/app-error'
import { readProviderStateSnapshot } from '../../chat-runtime-providers/provider-state-snapshot'
import {
  appendSideConversationHistory,
  readSideConversation
} from '../../provider-runtime/side-conversation-registry'
import { getRuntimeRegistry } from '../chat-runtime-provider-registry'
import { resolveSessionSystemPrompt } from '../context/turn-context'
import type { ChatContextPart } from '../context-parts'
import type { ChatRuntimeSettingsPatch, ChatThinkingEffort } from '../runtime-provider-types'
import {
  mergeRuntimeSettings,
  normalizeRuntimeSettingsPatch,
  readSessionRuntimeSettings
} from '../runtime-settings'
import {
  assertProviderBoundRunContext,
  assertRunnableSession,
  assertRuntimeCompatibleTarget
} from '../runtime-session-context'
import { createUserMessage } from '../ui-message'
import { createLiveSideConversationStream } from './live-stream'

export interface StreamSideConversationResponseInput {
  sideConversationId: string
  text?: string
  files?: FileUIPart[]
  contextParts?: ChatContextPart[]
  modelId?: string | null
  thinkingEffort?: ChatThinkingEffort
  runtimeSettings?: ChatRuntimeSettingsPatch
}

export interface StreamSideConversationResponseResult {
  runId: string
  assistantMessageId: string
  userMessageId: string
  stream: ReadableStream<Uint8Array>
}

export async function streamSideConversationResponse(
  input: StreamSideConversationResponseInput
): Promise<StreamSideConversationResponseResult> {
  const record = readSideConversation(input.sideConversationId)
  if (!record) {
    throw new AppError({
      code: 'side_chat_expired',
      status: 410,
      message: 'Side conversation is no longer attached to its live provider thread',
      details: { sideConversationId: input.sideConversationId }
    })
  }
  const parentContext = assertProviderBoundRunContext(
    assertRuntimeCompatibleTarget(assertRunnableSession(record.parentSessionId)),
    'Side conversation'
  )
  if (parentContext.providerTarget.id !== record.providerTargetId) {
    throw new AppError({
      code: 'side_chat_provider_target_changed',
      status: 409,
      message: 'Parent session provider target changed after the side conversation was created',
      details: {
        sideConversationId: input.sideConversationId,
        parentSessionId: record.parentSessionId,
        providerTargetId: parentContext.providerTarget.id,
        sideProviderTargetId: record.providerTargetId
      }
    })
  }
  const runtime = getRuntimeRegistry().get(record.runtimeKind)
  if (!runtime) {
    throw new AppError({
      code: 'chat_runtime_not_available',
      status: 501,
      message: `Runtime is not available: ${record.runtimeKind}`
    })
  }

  const userText = input.text ?? ''
  const files = input.files ?? []
  const contextParts = input.contextParts ?? []
  if (!userText.trim() && files.length === 0 && contextParts.length === 0) {
    throw new AppError({
      code: 'chat_message_empty',
      status: 400,
      message: 'Side conversation message requires text, context, or at least one file attachment',
      details: { sideConversationId: input.sideConversationId }
    })
  }

  const runId = randomUUID()
  const assistantMessageId = randomUUID()
  const userMessageId = randomUUID()
  const parentRuntimeSettings = readSessionRuntimeSettings(parentContext.session.configJson)
  const runtimeSettings = mergeRuntimeSettings(
    parentRuntimeSettings,
    normalizeRuntimeSettingsPatch(input.runtimeSettings)
  )
  const message = createUserMessage(userMessageId, userText, files, contextParts)
  const modelId =
    input.modelId ??
    record.requestedModelId ??
    readProviderStateSnapshot(record.runtimeSession.providerStateSnapshot).models.currentModelId ??
    undefined
  return {
    runId,
    assistantMessageId,
    userMessageId,
    stream: createLiveSideConversationStream({
      runId,
      runtime,
      runtimeSession: record.runtimeSession,
      profile: parentContext.profile,
      message,
      responseMessageId: assistantMessageId,
      modelId,
      thinkingEffort: input.thinkingEffort,
      runtimeSettings,
      systemPrompt: resolveSessionSystemPrompt(parentContext.session),
      history: record.history,
      onComplete: (assistantMessage) =>
        appendSideConversationHistory(input.sideConversationId, [message, assistantMessage]),
      workspaceId: parentContext.session.workspaceId,
      workspacePath: parentContext.workspacePath,
      agentId: parentContext.session.agentId
    })
  }
}
