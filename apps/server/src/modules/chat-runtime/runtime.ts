import type { BackendRun } from '@cradle/db'
import { backendRuns } from '@cradle/db'
import type { FileUIPart, UIMessage, UIMessageChunk } from 'ai'
import { eq } from 'drizzle-orm'

import { db } from '../../infra'
import { createChildLogger } from '../../logging/logger'
import { createDedupeKey, OBSERVABILITY_CODES } from '../observability/contract'
import * as Observability from '../observability/service'
import { isAppFeatureFlagEnabled } from '../preferences/service'
import {
  readDurableProviderRuntimeBinding,
  readReusableDurableProviderRuntimeBinding,
} from '../provider-runtime/service'
import { releaseSideConversationsByParentSessionId } from '../provider-runtime/side-conversation-registry'
import * as SessionService from '../session/service'
import { getRuntimeRegistry } from './chat-runtime-provider-registry'
import { invokeCodexAppServer } from './codex/host'
import type { ChatContextPart } from './context-parts'
import type { ChatRuntimeRecoveryResult } from './es/recovery'
import { recoverChatRuntimeProjections, recoverChatRuntimeSession } from './es/recovery'
import { resolveSessionSystemPrompt } from './harness/turn-context'
import type { ExecuteBangCommandInput } from './interaction/bang-command-execution'
import {
  executeBangCommand as executeBangCommandFromInteraction,
} from './interaction/bang-command-execution'
import {
  recordRuntimeInteractionEventToSessionEvents,
  setRuntimeInteractionEventRecorder,
} from './interaction/event-recorder'
import type { QuickQuestionInput } from './interaction/quick-question'
import {
  streamQuickQuestion as streamQuickQuestionFromInteraction,
} from './interaction/quick-question'
import { submitSessionSteerTurn as submitSessionSteerTurnFromInteraction } from './interaction/steer-turn'
import type { ActiveRunLifecycleDeps } from './lifecycle/cancel'
import {
  abortAllRuns as abortAllRunsFromLifecycle,
  abortRun as abortRunFromLifecycle,
  cancelSession as cancelSessionFromLifecycle,
  completeTerminalPersistedActiveRunForSession as completeTerminalPersistedActiveRunForSessionFromLifecycle,
} from './lifecycle/cancel'
import type { RollbackLastTurnDto, RollbackLastTurnOptions } from './lifecycle/rollback'
import {
  rollbackLastTurn as rollbackLastTurnFromLifecycle,
  rollbackTurns as rollbackTurnsFromLifecycle,
} from './lifecycle/rollback'
import { setRuntimeUserInputPublisher } from './pending-user-input'
import {
  cancelSessionQueueItem as cancelSessionQueueItemFromQueueApi,
  enqueueSessionQueueItem as enqueueSessionQueueItemFromQueueApi,
  listSessionQueueItems as listSessionQueueItemsFromQueueApi,
  reorderSessionQueueItems as reorderSessionQueueItemsFromQueueApi,
  updateSessionQueueItem as updateSessionQueueItemFromQueueApi,
} from './queue/api'
import type { QueueDrainDeps } from './queue/drain'
import { scheduleSessionQueueDrain } from './queue/drain'
import type {
  ChatSessionQueueItemDto,
  EnqueueSessionQueueItemInput,
  SessionSteerTurnDto,
  SubmitSessionSteerTurnInput,
  UpdateSessionQueueItemInput,
} from './queue/session-queue'
import { listPendingQueueRows } from './queue/session-queue'
import { createActiveRunReleaseController } from './run/active-run-release'
import {
  finalizeActiveRunSnapshot,
  recordActiveRunSnapshotEvent,
  startActiveRunSnapshot,
} from './run/active-run-snapshot'
import { serializeChatError } from './run/errors'
import type { CreateRunInput, RunCoordinatorDeps } from './run/run-coordinator'
import {
  createRun as createRunFromCoordinator,
} from './run/run-coordinator'
import type { RuntimeGoalContinuationSchedulerDeps } from './run/runtime-goal-continuation'
import {
  scheduleRuntimeGoalContinuation,
} from './run/runtime-goal-continuation'
import { isTerminalUIMessageChunk } from './run/stream-chunks'
import { createTerminalRunFinalizer, terminalChunkForFence } from './run/terminal-finalizer'
import { createActiveTurnCompletionController } from './run/turn-completion'
import type { TurnExecutorDeps } from './run/turn-executor'
import { executeRun as executeRunWithDeps } from './run/turn-executor'
import type { ActiveRun } from './run-registry'
import { runRegistry } from './run-registry'
import type {
  ChatThinkingEffort,
  RuntimeGoalContinuationOptions,
  RuntimeSettingsPatch,
} from './runtime-provider-types'
import {
  assertProviderBoundRunContext,
  assertRunnableSession,
  assertRuntimeCompatibleTarget,
  assertStoredSession,
  isProviderTargetAvailable,
} from './runtime-session-context'
import { readSessionRuntimeSettings } from './runtime-settings'
import type { ChatRuntimeSessionStatusDto } from './runtime-status-api'
import {
  getRuntimeSessionStatus as getRuntimeSessionStatusFromStatusApi,
} from './runtime-status-api'
import type {
  ActiveParentRuntimeSession,
  CreateSideChatDeps,
  CreateSideChatInput,
  SideChatSessionDto,
} from './side-chat/create'
import { createSideChat as createSideChatSession } from './side-chat/create'
import type { StreamSideConversationResponseInput, StreamSideConversationResponseResult } from './side-chat/response'
import {
  streamSideConversationResponse as streamSideConversationResponseFromSideChat,
} from './side-chat/response'
import { createActiveRunStreamController } from './stream/active-run-stream'
import type { WaitForRunCompletionOptions } from './stream/live-run-streams'
import {
  openProviderThreadStream as openProviderThreadStreamFromLiveStreams,
  openRunEventStream,
  waitForRunCompletion as waitForRunCompletionFromLiveStreams,
} from './stream/live-run-streams'
import { normalizeRuntimeSessionTitle, reportRuntimeSessionTitle } from './title-service'
import { readFullSessionTranscript } from './transcript'
import {
  captureTurnCheckpointEnd,
  captureTurnCheckpointStart,
} from './turn-checkpoint-hooks'

export { reportRuntimeSessionTitle }
export { resolvePlanImplementationApproval } from './interaction/plan-implementation-approval'
export type { QuickQuestionInput } from './interaction/quick-question'
export type { RollbackLastTurnDto } from './lifecycle/rollback'
export type {
  ChatSessionContinuationMode,
  ChatSessionQueueItemDto,
  ChatSessionQueueMode,
  ChatSessionQueueStatus,
  EnqueueSessionQueueItemInput,
  PersistedThinkingEffort,
  SessionSteerTurnDto,
  SubmitSessionSteerTurnInput,
  UpdateSessionQueueItemInput,
} from './queue/session-queue'
export type {
  ActiveRunReplayBufferSummary,
  ActiveRunSummary,
  ChatRuntimeSessionStatusDto,
  PendingRuntimeUserInputDto,
  RuntimeSessionRunDto,
  RuntimeSessionStatusKind,
} from './runtime-status-api'
export {
  getActiveRunReplayBufferSummary,
  getActiveSessionRun,
  listActiveRunSummaries,
  listPendingRuntimeUserInputs,
} from './runtime-status-api'
export type { CreateSideChatInput, SideChatSessionDto } from './side-chat/create'

const chatLogger = createChildLogger({ module: 'chat-runtime' })

/**
 * Composition root is the one place allowed to know about concrete provider feature flags.
 * `continueBlockedCodexGoals` is Codex-specific today (it's the only runtime that implements
 * `ChatRuntime.goalContinuation` and interprets `includeBlockedGoals`), but every orchestrator
 * interface downstream (`TurnExecutorDeps`, `RuntimeSessionStatusDeps`) only ever sees the
 * generic `RuntimeGoalContinuationOptions` bag, never the flag name.
 */
function readRuntimeGoalContinuationOptions(): RuntimeGoalContinuationOptions {
  return {
    includeBlockedGoals: isAppFeatureFlagEnabled('continueBlockedCodexGoals'),
  }
}

const activeRunStream = createActiveRunStreamController({
  handleStaleActiveRun: observeStaleActiveRunCompletion,
  error: (message, payload) => chatLogger.error(message, payload),
})
const {
  flushPendingRunDelta,
  publishRunStartChunk,
  publishRuntimeChunk,
  publishUIMessageChunk,
  startSnapshotTimer,
  stopPendingRunDeltaFlush,
  stopSnapshotTimer,
} = activeRunStream
export const flushAllActiveRunSnapshots = activeRunStream.flushAllActiveRunSnapshots
const activeRunReleaseController = createActiveRunReleaseController({
  stopSnapshotTimer,
  stopPendingRunDeltaFlush,
})
const terminalRunFinalizer = createTerminalRunFinalizer({
  stream: {
    publishRunStartChunk,
    flushPendingRunDelta,
    publishUIMessageChunk,
  },
  error: (message, payload) => chatLogger.error(message, payload),
})
const { persistTerminalChunk, publishTerminalNotification } = terminalRunFinalizer
const activeTurnCompletionController = createActiveTurnCompletionController({
  persistTerminalChunk,
  publishTerminalNotification,
  recoverTerminalPersistenceFailure: async (sessionId) => {
    await recoverChatRuntimeSession(sessionId)
  },
  releaseActiveRun: activeRun => activeRunReleaseController.releaseActiveRun(activeRun),
  performHandoff: (activeRun, handoff) => {
    if (handoff.kind === 'none') {
      return
    }
    if (handoff.kind === 'runtime-goal') {
      scheduleRuntimeGoalContinuation({
        sessionId: activeRun.sessionId,
        providerTargetId: handoff.providerTargetId,
        modelId: handoff.modelId,
        options: handoff.options,
      }, runtimeGoalContinuationDeps)
      return
    }
    scheduleSessionQueueDrain(activeRun.sessionId, queueDrainDeps)
  },
  recordTerminalPersistenceIncident: ({
    activeRun,
    source,
    terminalError,
    recoveryError,
  }) => {
    Observability.record({
      source: 'chat-engine',
      code: OBSERVABILITY_CODES.turnStreamFailed,
      severity: 'error',
      category: 'chat',
      message: 'Chat turn terminal persistence and recovery both failed',
      chatSessionId: activeRun.sessionId,
      runId: activeRun.runId,
      messageId: activeRun.messageId,
      dedupeKey: createDedupeKey({
        code: OBSERVABILITY_CODES.turnStreamFailed,
        chatSessionId: activeRun.sessionId,
        runId: activeRun.runId,
      }),
      attrs: {
        lifecycleStage: 'terminal-persistence-recovery',
        source,
        terminalError: terminalError instanceof Error ? terminalError.message : String(terminalError),
        recoveryError: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
      },
    })
  },
  warn: (message, payload) => chatLogger.warn(message, payload),
})
const { completeActiveTurn } = activeTurnCompletionController
const activeRunLifecycleDeps: ActiveRunLifecycleDeps = {
  readRun: getRun,
  completeActiveTurn,
  warn: (message, payload) => chatLogger.warn(message, payload),
}

function observeStaleActiveRunCompletion(activeRun: ActiveRun, fence: Parameters<typeof terminalChunkForFence>[0]): void {
  void completeActiveTurn(activeRun, {
    source: 'stale-fence',
    terminalChunk: terminalChunkForFence(fence),
  }).catch((error) => {
    chatLogger.error('stale chat run completion rejected', {
      error,
      sessionId: activeRun.sessionId,
      runId: activeRun.runId,
      fenceStatus: fence.status,
    })
  })
}

SessionService.onSessionArchived(releaseSideConversationsByParentSessionId)
SessionService.onSessionCleanup(releaseSideConversationsByParentSessionId)

function publishRunChunk(runId: string, chunk: UIMessageChunk): void {
  const activeRun = runRegistry.getActiveRun(runId)
  if (!activeRun || activeRun.terminalStatus) {
    return
  }
  publishUIMessageChunk(activeRun, chunk, isTerminalUIMessageChunk(chunk))
  recordActiveRunSnapshotEvent(activeRun, {
    phase: 'runtime_user_input',
    chunk,
  })
}

setRuntimeUserInputPublisher(publishRunChunk)
setRuntimeInteractionEventRecorder(recordRuntimeInteractionEventToSessionEvents)

const sideChatDeps: CreateSideChatDeps = {
  getParentSession: parentSessionId => assertStoredSession(parentSessionId),
  getParentContext: (parentSessionId, providerTargetId) =>
    assertProviderBoundRunContext(
      assertRuntimeCompatibleTarget(assertRunnableSession(parentSessionId), providerTargetId),
      'Side conversation',
    ),
  getRuntime: runtimeKind => getRuntimeRegistry().get(runtimeKind),
  getActiveParentRuntimeSession: (parentSessionId): ActiveParentRuntimeSession | undefined => {
    const activeRunId = runRegistry.getActiveRunIdForSession(parentSessionId)
    const activeRun = activeRunId ? runRegistry.getActiveRun(activeRunId) : undefined
    return activeRun?.providerTargetId
      ? {
          providerTargetId: activeRun.providerTargetId,
          runtimeSession: activeRun.runtimeSession,
          modelId: activeRun.modelId,
        }
      : undefined
  },
  readReusableBinding: input =>
    readReusableDurableProviderRuntimeBinding({
      chatSessionId: input.parentSessionId,
      providerTargetId: input.providerTargetId,
      runtimeKind: input.runtimeKind,
    }),
  readTranscript: parentSessionId => readFullSessionTranscript(parentSessionId),
  resolveSystemPrompt: session => resolveSessionSystemPrompt(session),
  normalizeTitle: title => normalizeRuntimeSessionTitle(title),
}
const queueDrainDeps: QueueDrainDeps = {
  hasActiveOrPendingRun: sessionId =>
    runRegistry.hasActiveRunForSession(sessionId)
    || runRegistry.hasPendingRun(sessionId)
    || runRegistry.hasSessionMaintenance(sessionId),
  readSessionRuntimeSettings: (sessionId) => {
    const session = assertStoredSession(sessionId)
    const runtimeKind = session.runtimeKind ?? 'standard'
    return readSessionRuntimeSettings(runtimeKind, session.configJson)
  },
  createQueuedRun: async (input) => {
    const run = await createRun({
      sessionId: input.sessionId,
      text: input.text,
      files: input.files,
      contextParts: input.contextParts,
      providerTargetId: input.providerTargetId,
      modelId: input.modelId,
      thinkingEffort: input.thinkingEffort,
      runtimeSettingsOverride: input.runtimeSettings,
      continuationMode: 'queue',
      queueItemId: input.queueItemId,
    })
    return { runId: run.runId }
  },
  serializeError: error => serializeChatError(error),
}
const runtimeGoalContinuationDeps: RuntimeGoalContinuationSchedulerDeps = {
  hasActiveOrPendingRun: sessionId =>
    runRegistry.hasActiveRunForSession(sessionId)
    || runRegistry.hasPendingRun(sessionId)
    || runRegistry.hasSessionMaintenance(sessionId),
  pendingQueueItemCount: sessionId => listPendingQueueRows(sessionId).length,
  scheduleQueueDrain: sessionId => scheduleSessionQueueDrain(sessionId, queueDrainDeps),
  readRuntimeBinding: readDurableProviderRuntimeBinding,
  readRuntime: runtimeKind => getRuntimeRegistry().get(runtimeKind),
  isProviderTargetAvailable: providerTargetId => isProviderTargetAvailable(providerTargetId),
  createContinuationRun: async (input) => {
    await createRun({
      sessionId: input.sessionId,
      providerTargetId: input.providerTargetId,
      modelId: input.modelId,
      internalContinuation: 'runtimeGoal',
    })
  },
  resumeBlockedGoal: async (input) => {
    const binding = readDurableProviderRuntimeBinding(input.sessionId)
    if (!binding?.backendSessionId) {
      throw new Error('Blocked Codex goal cannot be resumed without a provider session.')
    }
    await invokeCodexAppServer({
      sessionId: input.sessionId,
      providerTargetId: input.providerTargetId ?? binding.providerTargetId ?? undefined,
      modelId: input.modelId,
      method: 'thread/goal/set',
      params: {
        threadId: binding.backendSessionId,
        status: 'active',
      },
    })
  },
}
const turnExecutorDeps: TurnExecutorDeps = {
  captureTurnCheckpointStart: async (input) => {
    await captureTurnCheckpointStart(input)
  },
  captureTurnCheckpointEnd: async (input) => {
    await captureTurnCheckpointEnd(input)
  },
  stream: {
    flushPendingRunDelta,
    publishRunStartChunk,
    publishRuntimeChunk,
  },
  completeActiveTurn,
  recordSnapshotEvent: recordActiveRunSnapshotEvent,
  finalizeSnapshot: finalizeActiveRunSnapshot,
  pendingQueueItemCount: sessionId => listPendingQueueRows(sessionId).length,
  readRuntimeGoalContinuationOptions,
  warn: (message, payload) => chatLogger.warn(message, payload),
  error: (message, payload) => chatLogger.error(message, payload),
}
const runCoordinatorDeps: RunCoordinatorDeps = {
  startActiveRunSnapshot,
  startSnapshotTimer,
  scheduleQueueDrain: sessionId => scheduleSessionQueueDrain(sessionId, queueDrainDeps),
  executeRun: (activeRun, input) => {
    return executeRunWithDeps(activeRun, input, turnExecutorDeps)
  },
  warn: (message, payload) => chatLogger.warn(message, payload),
}

function getRun(runId: string): BackendRun | undefined {
  return db().select().from(backendRuns).where(eq(backendRuns.id, runId)).get()
}

export async function getRuntimeSessionStatus(
  sessionId: string,
): Promise<ChatRuntimeSessionStatusDto> {
  return getRuntimeSessionStatusFromStatusApi(sessionId, {
    completeTerminalPersistedActiveRunForSession,
    readRuntimeGoalContinuationOptions,
    scheduleRuntimeGoalContinuation: input =>
      scheduleRuntimeGoalContinuation(input, runtimeGoalContinuationDeps),
  })
}

export async function createSideChat(input: CreateSideChatInput): Promise<SideChatSessionDto> {
  return createSideChatSession(input, sideChatDeps)
}

export async function executeBangCommand(input: ExecuteBangCommandInput) {
  return executeBangCommandFromInteraction(input)
}

// ── public runtime API ──

export async function rollbackLastTurn(
  sessionId: string,
  options: RollbackLastTurnOptions = {},
): Promise<RollbackLastTurnDto> {
  return rollbackLastTurnFromLifecycle(sessionId, {
    scheduleSessionQueueDrain: sessionId => scheduleSessionQueueDrain(sessionId, queueDrainDeps),
  }, options)
}

export async function rollbackTurns(
  sessionId: string,
  numTurns: number,
  options: RollbackLastTurnOptions = {},
): Promise<RollbackLastTurnDto> {
  return rollbackTurnsFromLifecycle(sessionId, numTurns, {
    scheduleSessionQueueDrain: sessionId => scheduleSessionQueueDrain(sessionId, queueDrainDeps),
  }, options)
}

export async function createRun(input: CreateRunInput) {
  return createRunFromCoordinator(input, runCoordinatorDeps)
}

/**
 * Single endpoint: create run + return SSE stream.
 * POST /chat/sessions/:sessionId/response → SSE
 */
export async function streamResponse(input: {
  sessionId: string
  text?: string
  files?: FileUIPart[]
  contextParts?: ChatContextPart[]
  messages?: UIMessage[]
  providerTargetId?: string
  modelId?: string | null
  thinkingEffort?: ChatThinkingEffort
  runtimeSettings?: RuntimeSettingsPatch
}): Promise<{
  runId: string
  assistantMessageId: string
  userMessageId: string
  stream: ReadableStream<Uint8Array>
}> {
  const result = await createRun(input)
  return {
    ...result,
    stream: openRunEventStream(result.runId),
  }
}

export async function streamSideConversationResponse(
  input: StreamSideConversationResponseInput,
): Promise<StreamSideConversationResponseResult> {
  return streamSideConversationResponseFromSideChat(input)
}

export async function streamQuickQuestion(
  input: QuickQuestionInput,
): Promise<ReadableStream<Uint8Array>> {
  return streamQuickQuestionFromInteraction(input)
}

export async function openSessionRunStream(sessionId: string): Promise<ReadableStream<Uint8Array>> {
  assertStoredSession(sessionId)
  await completeTerminalPersistedActiveRunForSession(sessionId)

  const runId = runRegistry.getActiveRunIdForSession(sessionId)
  if (!runId) {
    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.close()
      },
    })
  }

  return openRunEventStream(runId)
}

export async function abortRun(runId: string): Promise<void> {
  return abortRunFromLifecycle(runId, activeRunLifecycleDeps)
}

/**
 * Cancel the active run for a session (if any).
 * POST /chat/sessions/:sessionId/cancel
 */
export async function cancelSession(sessionId: string): Promise<void> {
  return cancelSessionFromLifecycle(sessionId, activeRunLifecycleDeps)
}

export async function abortAllRuns(): Promise<void> {
  return abortAllRunsFromLifecycle(activeRunLifecycleDeps)
}

export function openProviderThreadStream(
  sessionId: string,
  threadId: string,
): ReadableStream<Uint8Array> {
  assertStoredSession(sessionId)
  return openProviderThreadStreamFromLiveStreams(sessionId, threadId)
}

export function waitForRunCompletion(
  runId: string,
  options?: WaitForRunCompletionOptions,
): Promise<BackendRun> {
  return waitForRunCompletionFromLiveStreams(runId, options)
}

export function listSessionQueueItems(sessionId: string): ChatSessionQueueItemDto[] {
  return listSessionQueueItemsFromQueueApi(sessionId)
}

export async function enqueueSessionQueueItem(
  input: EnqueueSessionQueueItemInput,
): Promise<ChatSessionQueueItemDto> {
  return enqueueSessionQueueItemFromQueueApi(input, {
    scheduleSessionQueueDrain: sessionId => scheduleSessionQueueDrain(sessionId, queueDrainDeps),
  })
}

export async function submitSessionSteerTurn(
  input: SubmitSessionSteerTurnInput,
): Promise<SessionSteerTurnDto> {
  return submitSessionSteerTurnFromInteraction(input, {
    scheduleSessionQueueDrain: sessionId => scheduleSessionQueueDrain(sessionId, queueDrainDeps),
    warn: (message, payload) => chatLogger.warn(message, payload),
  })
}

export async function cancelSessionQueueItem(
  sessionId: string,
  queueItemId: string,
): Promise<ChatSessionQueueItemDto> {
  return cancelSessionQueueItemFromQueueApi(sessionId, queueItemId)
}

export async function reorderSessionQueueItems(
  sessionId: string,
  queueItemIds: string[],
): Promise<ChatSessionQueueItemDto[]> {
  return reorderSessionQueueItemsFromQueueApi(sessionId, queueItemIds)
}

export async function updateSessionQueueItem(
  input: UpdateSessionQueueItemInput,
): Promise<ChatSessionQueueItemDto> {
  return updateSessionQueueItemFromQueueApi(input)
}

export async function recoverPersistedRunProjections(): Promise<ChatRuntimeRecoveryResult> {
  const recovered = await recoverChatRuntimeProjections()
  const recoveredCount
    = recovered.interruptedRunsFinalized
      + recovered.terminalFactsProjected
      + recovered.terminalProjectionDriftsRepaired

  if (recoveredCount > 0) {
    chatLogger.warn('recovered persisted run projections', { recovered })
  }

  return recovered
}

async function completeTerminalPersistedActiveRunForSession(sessionId: string): Promise<boolean> {
  return completeTerminalPersistedActiveRunForSessionFromLifecycle(sessionId, activeRunLifecycleDeps)
}
