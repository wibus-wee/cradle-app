import type { UIMessage, UIMessageChunk } from 'ai'

import { createDedupeKey, OBSERVABILITY_CODES } from '../../observability/contract'
import * as Observability from '../../observability/service'
import { readDurableProviderRuntimeBinding } from '../../provider-runtime/service'
import { truncateSnapshotPayload } from '../message-snapshot-compaction'
import { publishProviderThreadEvent } from '../provider-threads/live-streams'
import type { ActiveRun } from '../run-registry'
import type {
  ChatRuntimeSettings,
  ChatThinkingEffort,
  RuntimeGoalContinuationOptions,
  RuntimeProviderTargetProfile,
} from '../runtime-provider-types'
import { attachBinding, isProviderTargetAvailable } from '../runtime-session-context'
import { providerThreadStreamStore } from '../stream/live-run-streams'
import { isChatStreamTraceEnabled, recordChatStreamTrace } from '../stream-trace'
import { reportRuntimeSessionTitle } from '../title-service'
import type { CradleTurnTranscript } from '../transcript'
import type { SerializedChatError } from './errors'
import { resolveTurnFailureObservabilityCode, serializeChatError } from './errors'
import type { TurnOutputDiagnostics } from './output-diagnostics'
import {
  accumulateDiagnostics,
  createTurnOutputDiagnostics,
  resolveTerminalChunkWithDiagnostics,
} from './output-diagnostics'
import type { ChatRuntimeProfile } from './profile'
import { recordChatRuntimeProfile, startChatRuntimeProfile } from './profile'
import { createProviderSyntheticTurnEventHandler } from './provider-synthetic-turn'
import type { RuntimeGoalContinuationScheduleInput } from './runtime-goal-continuation'
import {
  shouldScheduleRuntimeGoalContinuation,
  updateRuntimeGoalContinuationBackoff,
} from './runtime-goal-continuation'
import {
  readHarnessSnapshotPhase,
  shouldRecordHarnessSnapshotChunk,
  summarizeSnapshotChunk,
} from './snapshot-events'
import { isTerminalUIMessageChunk } from './stream-chunks'
import { terminalChunkForStatus } from './terminal-finalizer'
import {
  estimateRunUsageCost,
  insertRuntimeStepUsages,
  insertRunUsage,
  UNKNOWN_MODEL_ID,
} from './usage'

export interface ExecuteRunInput {
  message: UIMessage
  profile: RuntimeProviderTargetProfile | null
  modelId?: string | null
  thinkingEffort?: ChatThinkingEffort
  runtimeSettings?: ChatRuntimeSettings
  systemPrompt?: string
  transcript?: CradleTurnTranscript
  history?: UIMessage[]
  originalMessages?: UIMessage[]
  workspaceId?: string | null
  workspacePath?: string
  agentId?: string | null
}

export interface TurnExecutorDeps {
  stream: {
    flushPendingRunDelta: (activeRun: ActiveRun) => void
    publishRunStartChunk: (activeRun: ActiveRun) => void
    publishRuntimeChunk: (activeRun: ActiveRun, chunk: UIMessageChunk) => void
  }
  publishTerminalChunk: (
    activeRun: ActiveRun,
    chunk: UIMessageChunk,
    profile?: ChatRuntimeProfile,
  ) => Promise<boolean>
  recordSnapshotEvent: (
    activeRun: ActiveRun,
    input: {
      phase: string
      chunk?: UIMessageChunk
      modelId?: string | null
      usage?: {
        promptTokens: number
        completionTokens: number
        totalTokens: number
      }
      estimatedCostUsd?: number | null
      durationMs?: number | null
      payload?: Record<string, unknown>
    },
  ) => void
  finalizeSnapshot: (
    activeRun: ActiveRun,
    finalChunk: UIMessageChunk,
    input: {
      modelId: string | null
      diagnostics: TurnOutputDiagnostics
      profile: ChatRuntimeProfile
    },
  ) => void
  releaseActiveRun: (activeRun: ActiveRun) => void
  scheduleQueueDrain: (sessionId: string) => void
  scheduleRuntimeGoalContinuation: (input: RuntimeGoalContinuationScheduleInput) => void
  pendingQueueItemCount: (sessionId: string) => number
  /**
   * Generic goal-continuation degradation options (see `RuntimeGoalContinuation` on
   * `ChatRuntime`). Orchestrator code must not know which runtime kind, if any, actually
   * interprets `includeBlockedGoals` — that mapping lives entirely at the composition root.
   */
  readRuntimeGoalContinuationOptions: () => RuntimeGoalContinuationOptions
  warn: (message: string, payload: Record<string, unknown>) => void
  error: (message: string, payload: Record<string, unknown>) => void
}

interface RunStreamPumpResult {
  finalChunk: UIMessageChunk
  failurePayload: SerializedChatError['payload'] | undefined
}

export async function executeRun(
  activeRun: ActiveRun,
  input: ExecuteRunInput,
  deps: TurnExecutorDeps,
): Promise<void> {
  const diagnostics = createTurnOutputDiagnostics()
  const profile = startChatRuntimeProfile()
  let released = false

  const releaseAndDrain = (): void => {
    if (released) {
      return
    }
    released = true
    deps.releaseActiveRun(activeRun)
    deps.scheduleQueueDrain(activeRun.sessionId)
  }

  try {
    const { finalChunk, failurePayload } = await pumpRuntimeStream(
      activeRun,
      input,
      diagnostics,
      profile,
      deps,
    )
    const { actualModelId, shouldFinalizeDiagnostics } = await persistRunTerminalAndUsage(
      activeRun,
      finalChunk,
      failurePayload,
      diagnostics,
      profile,
      deps,
    )
    completeRun(
      activeRun,
      finalChunk,
      diagnostics,
      profile,
      actualModelId,
      shouldFinalizeDiagnostics,
      deps,
    )
  }
  finally {
    releaseAndDrain()
  }
}

async function pumpRuntimeStream(
  activeRun: ActiveRun,
  input: ExecuteRunInput,
  diagnostics: TurnOutputDiagnostics,
  profile: ChatRuntimeProfile,
  deps: TurnExecutorDeps,
): Promise<RunStreamPumpResult> {
  let finalChunk: UIMessageChunk = { type: 'finish', finishReason: 'stop' }
  let failurePayload: SerializedChatError['payload'] | undefined
  const onProviderSyntheticTurnEvent = createProviderSyntheticTurnEventHandler(activeRun)

  try {
    for await (const chunk of activeRun.runtime.streamTurn({
      runId: activeRun.runId,
      runtimeSession: activeRun.runtimeSession,
      profile: input.profile,
      message: input.message,
      responseMessageId: activeRun.messageId,
      modelId: input.modelId,
      transcript: input.transcript,
      workspaceId: input.workspaceId,
      workspacePath: input.workspacePath,
      agentId: input.agentId,
      providerOptions:
        input.thinkingEffort || input.runtimeSettings
          ? {
              ...(input.thinkingEffort ? { thinkingEffort: input.thinkingEffort } : {}),
              ...(input.runtimeSettings ? { runtimeSettings: input.runtimeSettings } : {}),
            }
          : undefined,
      systemPrompt: input.systemPrompt,
      history: input.history,
      originalMessages: input.originalMessages,
      reportSessionTitle: (title) => {
        void reportRuntimeSessionTitle({ sessionId: activeRun.sessionId, title }).catch((error) => {
          deps.warn('failed to persist runtime session title event', {
            error,
            sessionId: activeRun.sessionId,
          })
        })
      },
      onProviderThreadEvent: event =>
        publishProviderThreadEvent({
          store: providerThreadStreamStore,
          sessionId: activeRun.sessionId,
          event,
          isTerminalChunk: isTerminalUIMessageChunk,
        }),
      onProviderSyntheticTurnEvent,
    })) {
      if (activeRun.terminalStatus) {
        break
      }
      if (isChatStreamTraceEnabled()) {
        recordChatStreamTrace({
          chatSessionId: activeRun.sessionId,
          runId: activeRun.runId,
          messageId: activeRun.messageId,
          runtimeKind: activeRun.runtimeSession.runtimeKind,
          providerSessionId: activeRun.runtimeSession.providerSessionId,
          phase: 'runtime_chunk',
          payload: chunk,
        })
      }
      accumulateDiagnostics(diagnostics, chunk)
      if (isTokenDeltaChunk(chunk) && !activeRun.firstTokenDeltaSnapshotRecorded) {
        activeRun.firstTokenDeltaSnapshotRecorded = true
        deps.recordSnapshotEvent(activeRun, {
          phase: 'model_first_token_delta',
          chunk,
        })
      }
      if (chunk.type === 'text-delta' && !activeRun.firstTextDeltaSnapshotRecorded) {
        activeRun.firstTextDeltaSnapshotRecorded = true
        deps.recordSnapshotEvent(activeRun, {
          phase: 'model_text_first_delta',
          chunk,
        })
      }
      if (shouldRecordHarnessSnapshotChunk(chunk)) {
        deps.recordSnapshotEvent(activeRun, {
          phase: readHarnessSnapshotPhase(chunk),
          chunk,
        })
      }
      if (isTerminalUIMessageChunk(chunk)) {
        finalChunk = chunk
        break
      }

      if (chunk.type === 'start' && activeRun.startChunkPublished) {
        continue
      }
      if (chunk.type !== 'start') {
        deps.stream.publishRunStartChunk(activeRun)
      }
      deps.stream.publishRuntimeChunk(activeRun, chunk)
    }

    deps.stream.flushPendingRunDelta(activeRun)
    // If `activeRun.terminalStatus` is already set here, the loop above hit
    // `if (activeRun.terminalStatus) break` before the runtime produced (or
    // we processed) a real terminal chunk for *this* turn — a concurrent
    // cancel/abort flow already decided the outcome. Trust that outcome
    // instead of running the stale default `finalChunk` (still
    // `{ type: 'finish', ... }`) through empty-output validation, which
    // would otherwise mislabel an early-cancelled turn as a failure.
    finalChunk = activeRun.terminalStatus
      ? terminalChunkForStatus(activeRun.terminalStatus)
      : resolveTerminalChunkWithDiagnostics(finalChunk, diagnostics, {
          allowEmptyAssistantOutput: isRuntimeGoalNoOutputCommandTurn(activeRun, input.message),
        })
    deps.recordSnapshotEvent(activeRun, {
      phase: 'stream_finished',
      chunk: finalChunk,
      payload: {
        terminalChunk: summarizeSnapshotChunk(finalChunk, truncateSnapshotPayload),
        diagnostics,
      },
    })
    profile.streamFinishedAtMs = performance.now()
  }
 catch (error) {
    deps.stream.flushPendingRunDelta(activeRun)
    profile.streamFinishedAtMs = performance.now()
    if (isAbortError(error, activeRun)) {
      finalChunk = { type: 'abort', reason: 'user' }
    }
 else {
      const serializedError = serializeChatError(error)
      failurePayload = serializedError.payload
      finalChunk = { type: 'error', errorText: serializedError.text }
    }
    deps.recordSnapshotEvent(activeRun, {
      phase: 'stream_failed',
      chunk: finalChunk,
      payload: {
        terminalChunk: summarizeSnapshotChunk(finalChunk, truncateSnapshotPayload),
        diagnostics,
        ...(failurePayload ? { payload: failurePayload } : {}),
      },
    })
  }

  return { finalChunk, failurePayload }
}

async function persistRunTerminalAndUsage(
  activeRun: ActiveRun,
  finalChunk: UIMessageChunk,
  failurePayload: SerializedChatError['payload'] | undefined,
  diagnostics: TurnOutputDiagnostics,
  profile: ChatRuntimeProfile,
  deps: TurnExecutorDeps,
): Promise<{ actualModelId: string | null, shouldFinalizeDiagnostics: boolean }> {
  let actualModelId = activeRun.modelId
  try {
    if (!activeRun.cancelRequested) {
      const finalized = await deps.publishTerminalChunk(activeRun, finalChunk, profile)
      if (!finalized) {
        return { actualModelId, shouldFinalizeDiagnostics: false }
      }

      const finalFailureText = finalChunk.type === 'error' ? finalChunk.errorText : null

      if (finalFailureText) {
        const observabilityCode = resolveTurnFailureObservabilityCode(finalChunk)
        Observability.record({
          source: 'chat-engine',
          code: observabilityCode,
          severity: 'error',
          category: 'chat',
          message: finalFailureText,
          chatSessionId: activeRun.sessionId,
          runId: activeRun.runId,
          messageId: activeRun.messageId,
          dedupeKey:
            observabilityCode === OBSERVABILITY_CODES.chatEmptyOutputCompletion
              ? createDedupeKey({
                  code: observabilityCode,
                  chatSessionId: activeRun.sessionId,
                  runId: null,
                })
              : undefined,
          attrs: {
            providerTargetId: activeRun.providerTargetId,
            runtimeKind: activeRun.runtimeSession.runtimeKind,
            providerSessionId: activeRun.runtimeSession.providerSessionId,
            diagnostics,
            ...(failurePayload ? { payload: failurePayload } : {}),
          },
        })
      }

      const usage = activeRun.runtime?.totalUsage ?? activeRun.runtime?.lastUsage
      actualModelId = activeRun.runtime?.lastModelId ?? activeRun.modelId
      if (usage) {
        insertRunUsage({
          sessionId: activeRun.sessionId,
          messageId: activeRun.messageId,
          providerTargetId: activeRun.providerTargetId,
          modelId: actualModelId,
          usage,
        })
        deps.recordSnapshotEvent(activeRun, {
          phase: 'usage',
          modelId: actualModelId,
          usage,
          estimatedCostUsd: estimateRunUsageCost(actualModelId, usage),
          payload: {
            source: activeRun.runtime?.totalUsage ? 'runtime.totalUsage' : 'runtime.lastUsage',
          },
        })
      }

      const steps = activeRun.runtime.lastStepUsages ?? []
      if (steps.length > 0) {
        const fallbackModelId = actualModelId ?? UNKNOWN_MODEL_ID
        const recordedSteps = insertRuntimeStepUsages({
          runId: activeRun.runId,
          sessionId: activeRun.sessionId,
          fallbackModelId,
          steps,
        })
        for (const step of recordedSteps) {
          deps.recordSnapshotEvent(activeRun, {
            phase: 'step_usage',
            modelId: step.modelId,
            usage: step.usage,
            estimatedCostUsd: step.estimatedCostUsd,
            payload: {
              stepNumber: step.stepNumber,
              stepType: step.stepType,
            },
          })
        }
      }
    }
  }
 catch (error) {
    deps.error('failed to persist run finalization (session may have been deleted)', {
      error,
    })
  }
  return { actualModelId, shouldFinalizeDiagnostics: true }
}

function completeRun(
  activeRun: ActiveRun,
  finalChunk: UIMessageChunk,
  diagnostics: TurnOutputDiagnostics,
  profile: ChatRuntimeProfile,
  actualModelId: string | null,
  shouldFinalizeDiagnostics: boolean,
  deps: TurnExecutorDeps,
): void {
  try {
    attachBinding({
      sessionId: activeRun.sessionId,
      providerTargetId: activeRun.providerTargetId,
      runtimeKind: activeRun.runtimeSession.runtimeKind,
      runtimeSession: activeRun.runtimeSession,
      requestedModelId: actualModelId,
    })
  }
 catch {
    // session may have been deleted during the run
  }
  updateRuntimeGoalContinuationBackoff(
    {
      sessionId: activeRun.sessionId,
      internalContinuation: activeRun.internalContinuation,
    },
    finalChunk,
  )
  const binding = readDurableProviderRuntimeBinding(activeRun.sessionId)
  const shouldContinueRuntimeGoal = shouldScheduleRuntimeGoalContinuation({
    run: {
      sessionId: activeRun.sessionId,
      runtime: activeRun.runtime,
      cancelRequested: activeRun.cancelRequested === true,
      internalContinuation: activeRun.internalContinuation,
    },
    finalChunk,
    binding,
    providerTargetAvailable: Boolean(
      binding && isProviderTargetAvailable(binding.providerTargetId),
    ),
    pendingQueueItemCount: deps.pendingQueueItemCount(activeRun.sessionId),
    options: deps.readRuntimeGoalContinuationOptions(),
  })
  if (shouldFinalizeDiagnostics) {
    deps.finalizeSnapshot(activeRun, finalChunk, {
      modelId: actualModelId,
      diagnostics,
      profile,
    })
  }
  recordChatRuntimeProfile({
    run: {
      sessionId: activeRun.sessionId,
      runId: activeRun.runId,
      messageId: activeRun.messageId,
      runtimeKind: activeRun.runtimeSession.runtimeKind,
      providerTargetId: activeRun.providerTargetId,
      modelId: activeRun.modelId,
      terminalStatus: activeRun.terminalStatus,
      replayChunkCount: activeRun.chunkBuffer.length,
      finalPartCount: activeRun.finalMessage.parts.length,
    },
    diagnostics,
    profile,
  })
  if (shouldContinueRuntimeGoal) {
    if (!activeRun.providerTargetId) {
      return
    }
    deps.scheduleRuntimeGoalContinuation({
      sessionId: activeRun.sessionId,
      providerTargetId: activeRun.providerTargetId,
      modelId: actualModelId ?? undefined,
      options: deps.readRuntimeGoalContinuationOptions(),
    })
  }
}

function isTokenDeltaChunk(chunk: UIMessageChunk): boolean {
  return chunk.type === 'text-delta'
    || chunk.type === 'reasoning-delta'
    || chunk.type === 'tool-input-delta'
}

/**
 * Whether `error` represents a cancellation we ourselves requested, not a real
 * provider/network failure. Trusts our own `cancelRequested` flag (set before
 * `runtime.cancelTurn()` is invoked) rather than sniffing the error message —
 * matching on substrings like "aborted" would misclassify legitimate failures
 * (e.g. "stream aborted by remote", proxy disconnects) as user cancellation
 * and silently drop their failure payload/observability record.
 */
function isAbortError(error: unknown, activeRun: ActiveRun): boolean {
  if (activeRun.cancelRequested) {
    return true
  }
  return isNamedAbortError(error)
}

function isNamedAbortError(error: unknown): boolean {
  return (
    typeof error === 'object'
    && error !== null
    && 'name' in error
    && (error as { name?: unknown }).name === 'AbortError'
  )
}

function isRuntimeGoalNoOutputCommandTurn(activeRun: ActiveRun, message: UIMessage): boolean {
  const goalContinuation = activeRun.runtime.goalContinuation
  if (!goalContinuation) {
    return false
  }
  if (activeRun.internalContinuation === 'runtimeGoal') {
    return true
  }
  return goalContinuation.allowsEmptyResponse({ message })
}
