import { createHash } from 'node:crypto'

import type { RuntimeUsageEvent, TokenUsage } from '../../chat-runtime/runtime-provider-types'
import type { CodexAppServerMessage } from './app-server/client'
import type { ModelReroutedNotification } from './app-server-protocol/v2/ModelReroutedNotification'
import type { ThreadTokenUsageUpdatedNotification } from './app-server-protocol/v2/ThreadTokenUsageUpdatedNotification'
import type { TokenUsageBreakdown } from './app-server-protocol/v2/TokenUsageBreakdown'

export class CodexUsageEventProjectionError extends Error {}

export class CodexUsageEventProjector {
  private readonly modelByTurn = new Map<string, string>()

  constructor(
    private readonly initialModelId: string | null,
    private readonly readOccurredAt: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  project(notification: CodexAppServerMessage): RuntimeUsageEvent | null {
    if (notification.method === 'model/rerouted') {
      this.captureModelReroute(notification.params as ModelReroutedNotification)
      return null
    }
    if (notification.method !== 'thread/tokenUsage/updated') {
      return null
    }
    return this.projectTokenUsage(notification.params as ThreadTokenUsageUpdatedNotification)
  }

  private captureModelReroute(params: ModelReroutedNotification): void {
    if (!params.threadId || !params.turnId || !params.toModel) {
      throw new CodexUsageEventProjectionError('Codex model reroute is missing thread, turn, or model identity.')
    }
    this.modelByTurn.set(turnKey(params.threadId, params.turnId), params.toModel)
  }

  private projectTokenUsage(params: ThreadTokenUsageUpdatedNotification): RuntimeUsageEvent {
    if (!params.threadId || !params.turnId) {
      throw new CodexUsageEventProjectionError('Codex token usage is missing thread or turn identity.')
    }
    const modelId = this.modelByTurn.get(turnKey(params.threadId, params.turnId)) ?? this.initialModelId
    if (!modelId) {
      throw new CodexUsageEventProjectionError('Codex token usage is missing an effective model.')
    }
    return createCodexRuntimeUsageEvent({
      threadId: params.threadId,
      turnId: params.turnId,
      modelId,
      occurredAt: this.readOccurredAt(),
      last: params.tokenUsage.last,
      total: params.tokenUsage.total,
    })
  }
}

export function createCodexRuntimeUsageEvent(input: {
  threadId: string
  turnId: string
  modelId: string
  occurredAt: number
  last: TokenUsageBreakdown
  total: TokenUsageBreakdown
}): RuntimeUsageEvent {
  const usage = toTokenUsage(input.last)
  if (usage.totalTokens <= 0) {
    throw new CodexUsageEventProjectionError('Codex token usage does not contain a positive model-call total.')
  }
  return {
    id: createCodexUsageEventId(input.threadId, input.turnId, input.total),
    providerThreadId: input.threadId,
    providerTurnId: input.turnId,
    modelId: input.modelId,
    occurredAt: input.occurredAt,
    usage,
    providerTotal: toTokenUsage(input.total),
  }
}

export function createCodexUsageEventId(
  threadId: string,
  turnId: string,
  total: TokenUsageBreakdown,
): string {
  const fingerprint = [
    'codex',
    threadId,
    turnId,
    total.inputTokens,
    total.cachedInputTokens,
    total.cacheWriteInputTokens,
    total.outputTokens,
    total.reasoningOutputTokens,
    total.totalTokens,
  ].join(':')
  return createHash('sha256').update(fingerprint).digest('hex')
}

function toTokenUsage(usage: TokenUsageBreakdown): TokenUsage {
  return {
    promptTokens: usage.inputTokens,
    completionTokens: usage.outputTokens,
    totalTokens: usage.totalTokens || usage.inputTokens + usage.outputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    cacheWriteInputTokens: usage.cacheWriteInputTokens,
    reasoningOutputTokens: usage.reasoningOutputTokens,
  }
}

function turnKey(threadId: string, turnId: string): string {
  return `${threadId}:${turnId}`
}
