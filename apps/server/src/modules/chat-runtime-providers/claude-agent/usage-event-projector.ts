import { createHash } from 'node:crypto'

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'

import type { RuntimeUsageEvent, TokenUsage } from '../../chat-runtime/runtime-provider-types'

export class ClaudeUsageEventProjectionError extends Error {}

type ClaudeAssistantUsage = {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

type ClaudeAssistantMessage = {
  id?: string
  model?: string
  usage?: ClaudeAssistantUsage
}

type ClaudeAssistantSdkMessage = {
  type: 'assistant'
  session_id?: string
  parent_tool_use_id?: string
  message?: ClaudeAssistantMessage
}

export function projectClaudeAssistantUsageEvent(input: {
  message: SDKMessage
  fallbackModelId: string | null | undefined
  occurredAt?: number
}): RuntimeUsageEvent | null {
  if (input.message.type !== 'assistant') {
    return null
  }

  const message = input.message as ClaudeAssistantSdkMessage
  const providerSessionId = message.session_id?.trim()
  const providerTurnId = message.message?.id?.trim()
  const modelId = message.message?.model?.trim() || input.fallbackModelId?.trim()
  const usage = message.message?.usage
  if (!usage) {
    return null
  }
  if (!providerSessionId || !providerTurnId || !modelId) {
    throw new ClaudeUsageEventProjectionError(
      'Claude assistant usage is missing provider session, message, or model identity.',
    )
  }

  const tokenUsage = toTokenUsage(usage)
  if (tokenUsage.totalTokens <= 0) {
    throw new ClaudeUsageEventProjectionError('Claude assistant usage does not contain a positive model-call total.')
  }

  const providerThreadId = message.parent_tool_use_id?.trim() || providerSessionId
  return {
    id: createClaudeUsageEventId(providerSessionId, providerThreadId, providerTurnId),
    providerThreadId,
    providerTurnId,
    modelId,
    occurredAt: input.occurredAt ?? Math.floor(Date.now() / 1000),
    usage: tokenUsage,
    providerTotal: tokenUsage,
  }
}

export function createClaudeUsageEventId(
  providerSessionId: string,
  providerThreadId: string,
  providerTurnId: string,
): string {
  return createHash('sha256')
    .update(['claude-agent', providerSessionId, providerThreadId, providerTurnId].join(':'))
    .digest('hex')
}

function toTokenUsage(usage: ClaudeAssistantUsage): TokenUsage {
  const promptTokens = usage.input_tokens ?? 0
  const completionTokens = usage.output_tokens ?? 0
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    cachedInputTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteInputTokens: usage.cache_creation_input_tokens ?? 0,
  }
}
