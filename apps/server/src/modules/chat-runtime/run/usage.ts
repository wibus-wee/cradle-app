import { randomUUID } from 'node:crypto'

import type { stepUsage as stepUsageTable } from '@cradle/db'

import { currentUnixSeconds } from '../../../helpers/time'
import { estimateCost } from '../../usage/pricing'
import { enqueueStepUsage, enqueueUsageLog } from '../../usage/write-behind'
import type { RuntimeStepUsage, TokenUsage } from '../runtime-provider-types'

export type RuntimeStepUsageInput = RuntimeStepUsage

/**
 * Sentinel used when the actual model for a usage record is unknown. Never
 * matches a real pricing table entry (see `estimateCost`), so cost estimation
 * correctly degrades to 0 instead of silently billing at some other model's
 * rate (e.g. a stand-in like `'gpt-4o'` would under- or over-estimate cost
 * for whatever model actually ran, and would mislabel the stored row).
 */
export const UNKNOWN_MODEL_ID = 'unknown'

export interface RecordedRuntimeStepUsage {
  stepNumber: number
  stepType: string
  modelId: string
  usage: TokenUsage
  estimatedCostUsd: number | null
}

export function insertRunUsage(input: {
  runId: string
  sessionId: string
  messageId: string
  providerTargetId: string | null
  modelId: string | null
  usage: TokenUsage
}): void {
  enqueueUsageLog({
    id: randomUUID(),
    runId: input.runId,
    sessionId: input.sessionId,
    messageId: input.messageId,
    providerTargetId: input.providerTargetId,
    modelId: input.modelId,
    promptTokens: input.usage.promptTokens,
    cachedInputTokens: input.usage.cachedInputTokens ?? 0,
    cacheWriteInputTokens: input.usage.cacheWriteInputTokens ?? 0,
    completionTokens: input.usage.completionTokens,
    reasoningOutputTokens: input.usage.reasoningOutputTokens ?? 0,
    totalTokens: input.usage.totalTokens,
    createdAt: currentUnixSeconds(),
  })
}

export function estimateRunUsageCost(modelId: string | null, usage: TokenUsage): number | null {
  return estimateCost(modelId ?? UNKNOWN_MODEL_ID, usage)
}

export function insertRuntimeStepUsages(input: {
  runId: string
  sessionId: string
  fallbackModelId: string
  steps: RuntimeStepUsageInput[]
}): RecordedRuntimeStepUsage[] {
  const createdAt = currentUnixSeconds()
  const rows = input.steps.map((step) => {
    const modelId = step.modelId ?? input.fallbackModelId
    const estimatedCostUsd = estimateCost(modelId, step.usage)
    return {
      recorded: {
        stepNumber: step.stepNumber,
        stepType: step.stepType,
        modelId,
        usage: step.usage,
        estimatedCostUsd,
      },
      row: {
        id: randomUUID(),
        runId: input.runId,
        sessionId: input.sessionId,
        stepNumber: step.stepNumber,
        stepType: step.stepType,
        modelId,
        promptTokens: step.usage.promptTokens,
        completionTokens: step.usage.completionTokens,
        totalTokens: step.usage.totalTokens,
        estimatedCostUsd,
        createdAt,
      } satisfies typeof stepUsageTable.$inferInsert,
    }
  })
  enqueueStepUsage(rows.map(entry => entry.row))
  return rows.map(entry => entry.recorded)
}
