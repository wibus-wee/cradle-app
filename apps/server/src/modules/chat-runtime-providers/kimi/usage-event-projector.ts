import { createHash } from 'node:crypto'

import type { RuntimeUsageEvent, TokenUsage } from '../../chat-runtime/runtime-provider-types'
import type { KimiNativeUsage, KimiSessionEvent } from './websocket/client'

export class KimiUsageEventProjector {
  private modelId: string | null
  private turnId: string | null = null

  constructor(
    private readonly providerSessionId: string,
    fallbackModelId: string | null | undefined,
  ) {
    this.modelId = fallbackModelId?.trim() || null
  }

  project(event: KimiSessionEvent): RuntimeUsageEvent | null {
    const payload = event.payload
    if (payload.type !== 'agent.status.updated') {
      return null
    }
    this.modelId = payload.model?.trim() || this.modelId
    if (payload.phase?.turnId !== undefined) {
      this.turnId = String(payload.phase.turnId)
    }
    const usage = payload.usage?.currentTurn
    const providerTotal = payload.usage?.total
    if (!usage || !this.turnId || !this.modelId) {
      return null
    }
    const tokenUsage = toTokenUsage(usage)
    if (tokenUsage.totalTokens <= 0) {
      return null
    }
    const providerThreadId = event.agent_id?.trim() || this.providerSessionId
    return {
      id: createKimiUsageEventId(providerThreadId, this.turnId),
      providerThreadId,
      providerTurnId: this.turnId,
      modelId: this.modelId,
      occurredAt: parseKimiTimestamp(event.timestamp),
      usage: tokenUsage,
      providerTotal: providerTotal ? toTokenUsage(providerTotal) : tokenUsage,
    }
  }
}

export function createKimiUsageEventId(providerThreadId: string, providerTurnId: string): string {
  return createHash('sha256')
    .update(['kimi', providerThreadId, providerTurnId].join(':'))
    .digest('hex')
}

function toTokenUsage(usage: KimiNativeUsage): TokenUsage {
  const promptTokens = usage.inputOther + usage.inputCacheRead + usage.inputCacheCreation
  return {
    promptTokens,
    completionTokens: usage.output,
    totalTokens: promptTokens + usage.output,
    cachedInputTokens: usage.inputCacheRead,
    cacheWriteInputTokens: usage.inputCacheCreation,
  }
}

function parseKimiTimestamp(timestamp: string): number {
  const occurredAt = Date.parse(timestamp)
  return Number.isFinite(occurredAt)
    ? Math.floor(occurredAt / 1000)
    : Math.floor(Date.now() / 1000)
}
