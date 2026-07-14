import { randomUUID } from 'node:crypto'

import type { FileUIPart, UIMessage } from 'ai'

import { AppError } from '../../../errors/app-error'
import type { RuntimeKind } from '../../provider-contracts/types'
import { getRuntimeRegistry } from '../chat-runtime-provider-registry'
import { resolveSessionSystemPrompt, resolveTurnContext } from '../context/turn-context'
import type { ChatContextPart } from '../context-parts'
import { cancelQueuedSessionItem } from '../es/commands'
import type { ChatSessionQueueMode } from '../queue/session-queue'
import type { ActiveRun, PendingRunState } from '../run-registry'
import { runRegistry } from '../run-registry'
import type {
  ChatThinkingEffort,
  RuntimeSettings,
  RuntimeSettingsPatch,
} from '../runtime-provider-types'
import {
  assertRuntimeCompatibleTarget,
  attachBinding,
  getSessionRunContext,
  readSessionRequestedModelId,
  readSessionRequestedThinkingEffort,
  resolveRuntimeSessionForContext,
} from '../runtime-session-context'
import { readSessionRuntimeSettings, resolveRunRuntimeSettings } from '../runtime-settings'
import { isChatStreamTraceEnabled, recordChatStreamTrace } from '../stream-trace'
import {
  createAssistantMessage,
  createUserMessage,
  projectLightOcrMessage,
  projectLightOcrMessages,
} from '../ui-message'
import { createFinalMessageProjectionState } from './final-message-projection'
import { cancelPendingRuntimeGoalContinuation } from './runtime-goal-continuation'
import { createDraftTurn, createDraftTurnFromUserMessage, startRun } from './turn-draft'
import type { ExecuteRunInput } from './turn-executor'

export interface CreateRunInput {
  sessionId: string
  text?: string
  files?: FileUIPart[]
  contextParts?: ChatContextPart[]
  messages?: UIMessage[]
  providerTargetId?: string
  modelId?: string | null
  thinkingEffort?: ChatThinkingEffort
  runtimeSettings?: RuntimeSettingsPatch
  runtimeSettingsOverride?: RuntimeSettings
  continuationMode?: ChatSessionQueueMode
  queueItemId?: string
  internalContinuation?: 'runtimeGoal'
}

export interface CreateRunResult {
  runId: string
  assistantMessageId: string
  userMessageId: string
}

export interface RunCoordinatorDeps {
  finalizeInterruptedPersistedStreamingSessionIfIdle: (sessionId: string) => Promise<void>
  startActiveRunSnapshot: (
    activeRun: ActiveRun,
    input: { workspaceId?: string | null, agentId?: string | null },
  ) => void
  startSnapshotTimer: (activeRun: ActiveRun) => void
  scheduleQueueDrain: (sessionId: string) => void
  executeRun: (activeRun: ActiveRun, input: ExecuteRunInput) => void
  warn: (message: string, payload: Record<string, unknown>) => void
}

export async function createRun(
  input: CreateRunInput,
  deps: RunCoordinatorDeps,
): Promise<CreateRunResult> {
  await deps.finalizeInterruptedPersistedStreamingSessionIfIdle(input.sessionId)
  if (
    runRegistry.hasActiveRunForSession(input.sessionId)
    || runRegistry.hasPendingRun(input.sessionId)
  ) {
    throw new AppError({
      code: 'chat_run_in_progress',
      status: 409,
      message: 'Chat session already has an active run',
      details: { sessionId: input.sessionId },
    })
  }
  const maintenanceKind = runRegistry.getSessionMaintenance(input.sessionId)
  if (maintenanceKind) {
    throw new AppError({
      code: 'chat_session_maintenance_in_progress',
      status: 409,
      message: 'Chat session is completing an exclusive maintenance operation',
      details: { sessionId: input.sessionId, maintenanceKind },
    })
  }
  if (input.internalContinuation !== 'runtimeGoal') {
    cancelPendingRuntimeGoalContinuation(input.sessionId)
  }
  const pendingState: PendingRunState = { cancelled: false, queueItemId: input.queueItemId }
  runRegistry.setPendingRun(input.sessionId, pendingState)

  try {
    const userText = input.text ?? ''
    const files = input.files ?? []
    const contextParts = input.contextParts ?? []
    const requestMessages = input.messages
    const lastRequestMessage = requestMessages?.at(-1)
    if (
      !input.internalContinuation
      && !requestMessages
      && !userText.trim()
      && files.length === 0
      && contextParts.length === 0
    ) {
      throw new AppError({
        code: 'chat_message_empty',
        status: 400,
        message: 'Chat message requires text or at least one file attachment',
        details: { sessionId: input.sessionId },
      })
    }
    if (requestMessages && !lastRequestMessage) {
      throw new AppError({
        code: 'chat_message_empty',
        status: 400,
        message: 'Chat message history cannot be empty',
        details: { sessionId: input.sessionId },
      })
    }
    if (
      lastRequestMessage
      && lastRequestMessage.role !== 'user'
      && lastRequestMessage.role !== 'assistant'
    ) {
      throw new AppError({
        code: 'chat_message_invalid',
        status: 400,
        message: 'Chat message history must end with a user or assistant message',
        details: {
          sessionId: input.sessionId,
          role: lastRequestMessage.role,
        },
      })
    }

    const requestedProviderTargetId = input.providerTargetId
    const context = getSessionRunContext(input.sessionId, {
      providerTargetId: requestedProviderTargetId,
    })
    if (!context) {
      throw new AppError({
        code: 'chat_session_not_found',
        status: 404,
        message: 'Chat session not found',
        details: { sessionId: input.sessionId },
      })
    }
    assertRuntimeCompatibleTarget(context, requestedProviderTargetId)
    if (context.profile && !context.profile.enabled) {
      throw new AppError({
        code: 'chat_provider_target_not_available',
        status: 409,
        message: 'Provider target is disabled',
        details: {
          providerTargetId: context.providerTarget?.id ?? null,
        },
      })
    }

    const registry = getRuntimeRegistry()
    const runtimeKind: RuntimeKind = context.session.runtimeKind ?? 'standard'
    const runtime = registry.get(runtimeKind)
    if (!runtime) {
      throw new AppError({
        code: 'chat_runtime_not_available',
        status: 501,
        message: `Runtime is not available: ${runtimeKind}`,
      })
    }
    const runtimeRequestMessages = requestMessages

    const sessionRuntimeSettings = readSessionRuntimeSettings(
      runtimeKind,
      context.session.configJson,
    )
    const runtimeSettings = input.runtimeSettingsOverride
      ? { ...input.runtimeSettingsOverride }
      : resolveRunRuntimeSettings(runtimeKind, sessionRuntimeSettings, input.runtimeSettings)
    const requestedModelId
      = input.modelId !== undefined
        ? input.modelId
        : readSessionRequestedModelId({
            session: context.session,
            requestedProviderTargetId,
          })
    const requestedThinkingEffort
      = input.thinkingEffort
        ?? readSessionRequestedThinkingEffort({
        session: context.session,
        requestedProviderTargetId,
      })

    const runtimeGoalContinuation
      = input.internalContinuation === 'runtimeGoal' ? runtime.goalContinuation : undefined
    if (input.internalContinuation === 'runtimeGoal' && !runtimeGoalContinuation) {
      throw new AppError({
        code: 'chat_runtime_goal_continuation_not_supported',
        status: 501,
        message: 'Runtime does not support goal continuation',
        details: { sessionId: input.sessionId, runtimeKind },
      })
    }

    const draft
      = input.internalContinuation === 'runtimeGoal'
        ? {
            userMessageId: '',
            assistantMessageId: randomUUID(),
            userMessage: runtimeGoalContinuation!.annotateContinuationMessage({
              message: createUserMessage(randomUUID(), runtimeGoalContinuation!.continuationPrompt),
            }),
          }
        : lastRequestMessage?.role === 'assistant'
          ? {
              userMessageId: '',
              assistantMessageId: lastRequestMessage.id,
              userMessage: lastRequestMessage,
            }
          : lastRequestMessage?.role === 'user'
            ? await createDraftTurnFromUserMessage({
                sessionId: input.sessionId,
                userMessage: lastRequestMessage,
                continuation: input.continuationMode
                  ? { mode: input.continuationMode, queueItemId: input.queueItemId }
                  : undefined,
              })
            : await createDraftTurn({
                sessionId: input.sessionId,
                userText,
                files,
                contextParts,
                goalContinuation: runtime.goalContinuation,
                continuation: input.continuationMode
                  ? { mode: input.continuationMode, queueItemId: input.queueItemId }
                  : undefined,
              })

    const runtimeResolution = await resolveRuntimeSessionForContext({
      sessionId: input.sessionId,
      context,
      runtimeKind,
      runtime,
      modelId: requestedModelId,
      requestedProviderTargetId,
    })
    const runtimeSession = runtimeResolution.runtimeSession

    if (pendingState.cancelled) {
      if (input.queueItemId) {
        await cancelQueuedSessionItem(input.sessionId, input.queueItemId)
      }
      try {
        await runtime.cancelTurn({ runtimeSession, profile: context.profile })
      }
 catch (error) {
        deps.warn('runtime turn cancellation failed before chat run was created', {
          error,
          sessionId: input.sessionId,
          queueItemId: input.queueItemId,
        })
      }
      throw new AppError({
        code: 'chat_run_cancelled',
        status: 409,
        message: 'Chat run was cancelled before it started',
        details: { sessionId: input.sessionId, queueItemId: input.queueItemId },
      })
    }

    attachBinding({
      sessionId: input.sessionId,
      providerTargetId: context.providerTarget?.id ?? null,
      runtimeKind: runtimeSession.runtimeKind,
      runtimeSession,
      requestedModelId: runtimeResolution.requestedModelId,
    })

    const run = await startRun({
      sessionId: input.sessionId,
      messageId: draft.assistantMessageId,
      origin: input.internalContinuation ? 'system' : 'user',
      assistantMessage:
        lastRequestMessage?.role === 'assistant'
          ? lastRequestMessage
          : createAssistantMessage(draft.assistantMessageId),
      queueItemId: input.queueItemId ?? null,
    })
    const activeRun: ActiveRun = {
      runId: run.id,
      sessionId: input.sessionId,
      messageId: draft.assistantMessageId,
      providerTargetKind: context.providerTarget?.kind ?? null,
      providerTargetId: context.providerTarget?.id ?? null,
      runtime,
      runtimeSession,
      modelId: runtimeResolution.requestedModelId,
      chunkBuffer: [],
      chunkBufferIndexByKey: new Map(),
      chunkBufferDroppedCount: 0,
      pendingDeltaChunk: null,
      pendingDeltaFlushTimer: null,
      snapshotTimer: null,
      finalMessage:
        lastRequestMessage?.role === 'assistant'
          ? lastRequestMessage
          : createAssistantMessage(draft.assistantMessageId),
      finalProjection: createFinalMessageProjectionState(),
      firstTokenDeltaSnapshotRecorded: false,
      firstTextDeltaSnapshotRecorded: false,
      lastStreamingSnapshotMessageJson: null,
      pendingStreamingSnapshotMessageJson: null,
      queueItemId: input.queueItemId,
      runtimeSettings,
      internalContinuation: input.internalContinuation,
      runSnapshotId: null,
      runSnapshotSeq: 0,
      snapshotEventIdByCoalesceKey: new Map(),
      runSnapshotTruncatedEventId: null,
      runSnapshotDroppedEventCount: 0,
    }
    runRegistry.setActiveRun(run.id, activeRun)
    deps.startActiveRunSnapshot(activeRun, {
      workspaceId: context.session.workspaceId,
      agentId: context.session.agentId,
    })
    deps.startSnapshotTimer(activeRun)
    runRegistry.setActiveRunIdForSession(input.sessionId, run.id)
    if (isChatStreamTraceEnabled()) {
      recordChatStreamTrace({
        chatSessionId: activeRun.sessionId,
        runId: activeRun.runId,
        messageId: activeRun.messageId,
        runtimeKind: activeRun.runtimeSession.runtimeKind,
        providerSessionId: activeRun.runtimeSession.providerSessionId,
        phase: 'run_started',
        payload: {
          providerTargetId: activeRun.providerTargetId,
          modelId: activeRun.modelId,
          queueItemId: activeRun.queueItemId ?? null,
          runtimeSettings: activeRun.runtimeSettings,
        },
      })
    }
    runRegistry.deletePendingRun(input.sessionId)

    const turnContext = requestMessages
      ? {
          systemPrompt: resolveSessionSystemPrompt(context.session),
          history: requestMessages.slice(0, -1),
        }
      : resolveTurnContext({
          sessionId: input.sessionId,
          draftMessageId: draft.assistantMessageId,
          draftUserMessageId: draft.userMessageId,
        })

    deps.executeRun(activeRun, {
      message: projectLightOcrMessage(draft.userMessage),
      profile: context.profile,
      modelId:
        requestedModelId !== undefined
          ? requestedModelId
          : (runtimeResolution.requestedModelId ?? undefined),
      thinkingEffort: requestedThinkingEffort,
      runtimeSettings,
      systemPrompt: turnContext.systemPrompt,
      transcript: turnContext.transcript,
      history: turnContext.history?.length
        ? projectLightOcrMessages(turnContext.history)
        : undefined,
      originalMessages: projectLightOcrMessages(runtimeRequestMessages),
      workspaceId: context.session.workspaceId,
      workspacePath: context.workspacePath,
      agentId: context.session.agentId,
    })

    return {
      runId: run.id,
      assistantMessageId: draft.assistantMessageId,
      userMessageId: draft.userMessageId,
    }
  }
 catch (error) {
    const pending = runRegistry.getPendingRun(input.sessionId)
    runRegistry.deletePendingRun(input.sessionId)
    const cancelledClaimedQueueItem = Boolean(
      input.queueItemId
      && pending?.cancelled
      && error instanceof AppError
      && error.code === 'chat_run_cancelled',
    )
    if (!cancelledClaimedQueueItem) {
      deps.scheduleQueueDrain(input.sessionId)
    }
    throw error
  }
}
