import type { BackendSessionBinding } from '@cradle/db'
import type { UIMessageChunk } from 'ai'

import { createChildLogger } from '../../../logging/logger'
import type {
  ChatRuntime,
  RuntimeGoalContinuationOptions,
} from '../runtime-provider-types'

const RUNTIME_GOAL_CONTINUATION_DELAY_MS = 250

const runtimeGoalContinuationLogger = createChildLogger({
  module: 'chat-runtime.runtime-goal-continuation',
})

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>()
const failureCounts = new Map<string, number>()

export interface RuntimeGoalContinuationRunContext {
  sessionId: string
  runtime: ChatRuntime
  cancelRequested: boolean
  internalContinuation?: 'runtimeGoal' | null
}

export interface RuntimeGoalContinuationDecisionInput {
  run: RuntimeGoalContinuationRunContext
  finalChunk: UIMessageChunk
  binding: BackendSessionBinding | undefined
  providerTargetAvailable: boolean
  pendingQueueItemCount: number
  options?: RuntimeGoalContinuationOptions
}

export interface RuntimeGoalContinuationSchedulerDeps {
  hasActiveOrPendingRun: (sessionId: string) => boolean
  pendingQueueItemCount: (sessionId: string) => number
  scheduleQueueDrain: (sessionId: string) => void
  readRuntimeBinding: (sessionId: string) => BackendSessionBinding | undefined
  readRuntime: (runtimeKind: string) => ChatRuntime | undefined
  isProviderTargetAvailable: (providerTargetId: string | null | undefined) => boolean
  createContinuationRun: (input: {
    sessionId: string
    providerTargetId?: string
    modelId?: string
  }) => Promise<void>
}

export interface RuntimeGoalContinuationScheduleInput {
  sessionId: string
  providerTargetId?: string
  modelId?: string
  options?: RuntimeGoalContinuationOptions
}

export function hasContinuableRuntimeGoal(input: {
  runtime: ChatRuntime | undefined
  binding:
    | Pick<BackendSessionBinding, 'backendStateSnapshot' | 'runtimeKind'>
    | null
    | undefined
  options?: RuntimeGoalContinuationOptions
}): boolean {
  if (!input.runtime?.goalContinuation || !input.binding) {
    return false
  }
  if (input.binding.runtimeKind !== input.runtime.runtimeKind) {
    return false
  }
  return input.runtime.goalContinuation.readContinuableGoal({
    providerStateSnapshot: input.binding.backendStateSnapshot,
    options: input.options,
  }) !== null
}

export function cancelPendingRuntimeGoalContinuation(sessionId: string): void {
  const timer = pendingTimers.get(sessionId)
  if (!timer) {
    return
  }
  clearTimeout(timer)
  pendingTimers.delete(sessionId)
}

export function updateRuntimeGoalContinuationBackoff(
  activeRun: Pick<RuntimeGoalContinuationRunContext, 'sessionId' | 'internalContinuation'>,
  finalChunk: UIMessageChunk,
): void {
  if (activeRun.internalContinuation !== 'runtimeGoal') {
    return
  }
  if (finalChunk.type === 'error') {
    failureCounts.set(activeRun.sessionId, (failureCounts.get(activeRun.sessionId) ?? 0) + 1)
    return
  }
  failureCounts.delete(activeRun.sessionId)
}

export function shouldScheduleRuntimeGoalContinuation(
  input: RuntimeGoalContinuationDecisionInput,
): boolean {
  if (input.run.cancelRequested || input.finalChunk.type === 'abort') {
    return false
  }
  if (!hasContinuableRuntimeGoal({
    runtime: input.run.runtime,
    binding: input.binding,
    options: input.options,
  })) {
    return false
  }
  if (!input.providerTargetAvailable) {
    return false
  }
  if (input.pendingQueueItemCount > 0) {
    return false
  }
  return true
}

export function scheduleRuntimeGoalContinuation(
  input: RuntimeGoalContinuationScheduleInput,
  deps: RuntimeGoalContinuationSchedulerDeps,
): void {
  if (pendingTimers.has(input.sessionId)) {
    return
  }

  const failureCount = failureCounts.get(input.sessionId) ?? 0
  const delayMs = Math.min(
    RUNTIME_GOAL_CONTINUATION_DELAY_MS * 2 ** Math.min(failureCount, 7),
    30_000,
  )

  const timer = setTimeout(() => {
    pendingTimers.delete(input.sessionId)
    void startScheduledRuntimeGoalContinuation(input, deps)
  }, delayMs)
  pendingTimers.set(input.sessionId, timer)
}

async function startScheduledRuntimeGoalContinuation(
  input: RuntimeGoalContinuationScheduleInput,
  deps: RuntimeGoalContinuationSchedulerDeps,
): Promise<void> {
  if (deps.hasActiveOrPendingRun(input.sessionId)) {
    return
  }
  if (deps.pendingQueueItemCount(input.sessionId) > 0) {
    deps.scheduleQueueDrain(input.sessionId)
    return
  }
  const binding = deps.readRuntimeBinding(input.sessionId)
  const runtime = binding ? deps.readRuntime(binding.runtimeKind) : undefined
  if (!hasContinuableRuntimeGoal({
    runtime,
    binding,
    options: input.options,
  })) {
    return
  }
  if (!deps.isProviderTargetAvailable(input.providerTargetId ?? binding?.providerTargetId)) {
    return
  }

  try {
    await deps.createContinuationRun({
      sessionId: input.sessionId,
      providerTargetId: input.providerTargetId,
      modelId: input.modelId,
    })
  }
  catch (error) {
    failureCounts.set(input.sessionId, (failureCounts.get(input.sessionId) ?? 0) + 1)
    runtimeGoalContinuationLogger.warn('failed to start runtime goal continuation run', {
      error,
      sessionId: input.sessionId,
    })
    const latestBinding = deps.readRuntimeBinding(input.sessionId)
    const latestRuntime = latestBinding ? deps.readRuntime(latestBinding.runtimeKind) : undefined
    if (
      !deps.hasActiveOrPendingRun(input.sessionId)
      && hasContinuableRuntimeGoal({
        runtime: latestRuntime,
        binding: latestBinding,
        options: input.options,
      })
      && deps.isProviderTargetAvailable(input.providerTargetId ?? latestBinding?.providerTargetId)
      && deps.pendingQueueItemCount(input.sessionId) === 0
    ) {
      scheduleRuntimeGoalContinuation(input, deps)
    }
  }
}
