import { randomUUID } from 'node:crypto'

import { stepUsage as stepUsageTable, usageLogs } from '@cradle/db'

import { currentUnixSeconds } from '../../../helpers/time'
import { db } from '../../../infra'
import { estimateCost } from '../../usage/pricing'
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
  sessionId: string
  messageId: string
  providerTargetId: string | null
  modelId: string | null
  usage: TokenUsage
}): void {
  db()
    .insert(usageLogs)
    .values({
      id: randomUUID(),
      sessionId: input.sessionId,
      messageId: input.messageId,
      providerTargetId: input.providerTargetId,
      modelId: input.modelId,
      promptTokens: input.usage.promptTokens,
      completionTokens: input.usage.completionTokens,
      totalTokens: input.usage.totalTokens,
      createdAt: currentUnixSeconds(),
    })
    .run()
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
  return input.steps.map((step) => {
    const modelId = step.modelId ?? input.fallbackModelId
    const estimatedCostUsd = estimateCost(modelId, step.usage)
    db()
      .insert(stepUsageTable)
      .values({
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
        createdAt: currentUnixSeconds(),
      })
      .run()
    return {
      stepNumber: step.stepNumber,
      stepType: step.stepType,
      modelId,
      usage: step.usage,
      estimatedCostUsd,
    }
  })
}
