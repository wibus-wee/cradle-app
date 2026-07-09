import type { BackendRun } from '@cradle/db'
import { backendRuns, chatSessionQueueItems, sessions } from '@cradle/db'
import { and, desc, eq, sql } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import type { RuntimeKind } from '../provider-contracts/types'
import { readReusableDurableProviderRuntimeBinding } from '../provider-runtime/service'
import * as SessionService from '../session/service'
import { getRuntimeRegistry } from './chat-runtime-provider-registry'
import { listPendingRuntimeUserInputSummaries } from './pending-user-input'
import type { RuntimeGoalContinuationScheduleInput } from './run/runtime-goal-continuation'
import {
  hasContinuableRuntimeGoal,
} from './run/runtime-goal-continuation'
import type { ChatMessageStatus } from './run/stream-chunks'
import { readDeltaChunkTextLength } from './run/stream-chunks'
import type { ActiveRun } from './run-registry'
import { runRegistry } from './run-registry'
import type { RuntimeGoalContinuationOptions, RuntimeSettings } from './runtime-provider-types'
import { isProviderTargetAvailable } from './runtime-session-context'
import { getDefaultRuntimeSettings, readSessionRuntimeSettings } from './runtime-settings'

export interface ActiveRunSummary {
  runId: string
  sessionId: string
  messageId: string
  providerTargetKind: 'manual' | 'external' | null
  providerTargetId: string | null
  modelId: string | null
}

export interface ActiveRunReplayBufferSummary {
  runId: string
  chunkCount: number
  textDeltaCount: number
  reasoningDeltaCount: number
  toolInputDeltaCount: number
  toolOutputCount: number
  maxDeltaChars: number
}

export interface PendingRuntimeUserInputDto {
  sessionId: string
  runId: string
  requestId: string
  providerMethod: string
  toolCallId: string
  questionCount: number
  firstQuestion: string | null
  createdAt: number
  updatedAt: number
}

export type RuntimeSessionStatusKind
  = | 'idle'
    | 'pending'
    | 'streaming'
    | 'waitingForUserInput'
    | 'cancelling'

export interface RuntimeSessionRunDto {
  runId: string
  messageId: string | null
  status: ChatMessageStatus
  startedAt: number
  finishedAt: number | null
  modelId: string | null
  providerSessionId: string | null
  queueItemId: string | null
  runtimeSettings: RuntimeSettings
}

export interface ChatRuntimeSessionStatusDto {
  sessionId: string
  status: RuntimeSessionStatusKind
  runtimeKind: RuntimeKind
  providerTargetId: string | null
  providerSessionId: string | null
  modelId: string | null
  runtimeSettings: RuntimeSettings
  pendingQueueItemId: string | null
  hasActiveGoal: boolean
  supportsLastTurnRollback: boolean
  activeRun: RuntimeSessionRunDto | null
  latestRun: RuntimeSessionRunDto | null
  queue: {
    pending: number
    running: number
  }
}

export interface RuntimeSessionStatusDeps {
  releaseTerminalPersistedActiveRunForSession: (sessionId: string) => Promise<boolean>
  /**
   * Generic goal-continuation degradation options (see `RuntimeGoalContinuation` on
   * `ChatRuntime`). This orchestrator layer must not know which runtime kind, if any,
   * actually interprets `includeBlockedGoals` — that mapping lives at the composition root.
   */
  readRuntimeGoalContinuationOptions: () => RuntimeGoalContinuationOptions
  scheduleRuntimeGoalContinuation: (input: RuntimeGoalContinuationScheduleInput) => void
}

export function listActiveRunSummaries(): ActiveRunSummary[] {
  return runRegistry.listActiveRuns().map(toActiveRunSummary)
}

export function getActiveRunReplayBufferSummary(
  runId: string,
): ActiveRunReplayBufferSummary | null {
  const run = runRegistry.getActiveRun(runId)
  if (!run) {
    return null
  }
  return {
    runId,
    chunkCount: run.chunkBuffer.length,
    textDeltaCount: run.chunkBuffer.filter(chunk => chunk.type === 'text-delta').length,
    reasoningDeltaCount: run.chunkBuffer.filter(chunk => chunk.type === 'reasoning-delta').length,
    toolInputDeltaCount: run.chunkBuffer.filter(chunk => chunk.type === 'tool-input-delta')
      .length,
    toolOutputCount: run.chunkBuffer.filter(chunk => chunk.type === 'tool-output-available')
      .length,
    maxDeltaChars: run.chunkBuffer.reduce(
      (max, chunk) => Math.max(max, readDeltaChunkTextLength(chunk)),
      0,
    ),
  }
}

export function getActiveSessionRun(sessionId: string): ActiveRunSummary | null {
  const runId = runRegistry.getActiveRunIdForSession(sessionId)
  if (!runId) {
    return null
  }
  const run = runRegistry.getActiveRun(runId)
  return run ? toActiveRunSummary(run) : null
}

export async function getRuntimeSessionStatus(
  sessionId: string,
  deps: RuntimeSessionStatusDeps,
): Promise<ChatRuntimeSessionStatusDto> {
  const session = db().select().from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!session) {
    throw new AppError({
      code: 'chat_session_not_found',
      status: 404,
      message: 'Chat session not found',
      details: { sessionId },
    })
  }

  await deps.releaseTerminalPersistedActiveRunForSession(sessionId)

  const binding = session.providerTargetId
    ? readReusableDurableProviderRuntimeBinding({
        chatSessionId: sessionId,
        providerTargetId: session.providerTargetId,
        runtimeKind: session.runtimeKind as RuntimeKind,
      })
    : undefined
  const activeRunId = runRegistry.getActiveRunIdForSession(sessionId)
  const activeRun = activeRunId ? runRegistry.getActiveRun(activeRunId) : undefined
  const pendingState = runRegistry.getPendingRun(sessionId)
  const latestRun = db()
    .select()
    .from(backendRuns)
    .where(eq(backendRuns.chatSessionId, sessionId))
    .orderBy(desc(backendRuns.startedAt), desc(sql`backend_runs.rowid`))
    .get()
  const queueRows = db()
    .select({
      status: chatSessionQueueItems.status,
    })
    .from(chatSessionQueueItems)
    .where(
      and(eq(chatSessionQueueItems.sessionId, sessionId), eq(chatSessionQueueItems.mode, 'queue')),
    )
    .all()
  const queue = queueRows.reduce(
    (counts, row) => {
      if (row.status === 'pending') {
        return { ...counts, pending: counts.pending + 1 }
      }
      if (row.status === 'running') {
        return { ...counts, running: counts.running + 1 }
      }
      return counts
    },
    { pending: 0, running: 0 },
  )

  const runtimeKind
    = activeRun?.runtimeSession.runtimeKind
      ?? (binding?.runtimeKind as RuntimeKind | undefined)
      ?? session.runtimeKind
  const providerTargetId
    = activeRun?.providerTargetId ?? binding?.providerTargetId ?? session.providerTargetId
  const providerSessionId
    = activeRun?.runtimeSession.providerSessionId ?? binding?.backendSessionId ?? null
  const modelId
    = activeRun?.modelId
      ?? SessionService.readSessionModelPreference(session.configJson)
      ?? binding?.requestedModelId
      ?? null
  const runtimeSettings
    = activeRun?.runtimeSettings ?? readSessionRuntimeSettings(runtimeKind, session.configJson)
  const pendingUserInputs = activeRun
    ? listPendingRuntimeUserInputSummaries({ sessionId, runId: activeRun.runId })
    : []
  const providerTargetAvailable = activeRun ? true : isProviderTargetAvailable(providerTargetId)
  const goalContinuationOptions = deps.readRuntimeGoalContinuationOptions()
  const runtime = binding ? getRuntimeRegistry().get(binding.runtimeKind) : undefined
  const hasActiveGoal
    = hasContinuableRuntimeGoal({
      runtime,
      binding,
      options: goalContinuationOptions,
    }) && providerTargetAvailable
  const status: RuntimeSessionStatusKind = activeRun
    ? activeRun.cancelRequested
      ? 'cancelling'
      : pendingUserInputs.length > 0
        ? 'waitingForUserInput'
        : 'streaming'
    : pendingState
      ? 'pending'
      : 'idle'
  if (status === 'idle' && hasActiveGoal && binding && queue.pending === 0 && queue.running === 0) {
    deps.scheduleRuntimeGoalContinuation({
      sessionId,
      providerTargetId: providerTargetId ?? undefined,
      modelId: modelId ?? undefined,
      options: goalContinuationOptions,
    })
  }

  return {
    sessionId,
    status,
    runtimeKind,
    providerTargetId,
    providerSessionId,
    modelId,
    runtimeSettings,
    pendingQueueItemId: pendingState?.queueItemId ?? null,
    hasActiveGoal,
    supportsLastTurnRollback:
      getRuntimeRegistry().get(runtimeKind)?.capabilities.supportsLastTurnRollback ?? false,
    activeRun: activeRun
      ? toRuntimeSessionRunDto(activeRun, getRun(activeRun.runId), { runtimeSettings })
      : null,
    latestRun: latestRun
      ? toRuntimeSessionRunDto(null, latestRun, {
          modelId,
          providerSessionId: binding?.backendSessionId ?? null,
          runtimeSettings,
        })
      : null,
    queue,
  }
}

export function listPendingRuntimeUserInputs(): PendingRuntimeUserInputDto[] {
  return listPendingRuntimeUserInputSummaries()
}

function getRun(runId: string): BackendRun | undefined {
  return db().select().from(backendRuns).where(eq(backendRuns.id, runId)).get()
}

function toActiveRunSummary(run: ActiveRun): ActiveRunSummary {
  return {
    runId: run.runId,
    sessionId: run.sessionId,
    messageId: run.messageId,
    providerTargetKind: run.providerTargetKind,
    providerTargetId: run.providerTargetId,
    modelId: run.modelId,
  }
}

function toRuntimeSessionRunDto(
  activeRun: ActiveRun | null,
  run: BackendRun | undefined,
  fallback: {
    modelId?: string | null
    providerSessionId?: string | null
    runtimeSettings?: RuntimeSettings
  } = {},
): RuntimeSessionRunDto {
  const runtimeKind = activeRun?.runtimeSession.runtimeKind ?? 'standard'
  return {
    runId: activeRun?.runId ?? run?.id ?? '',
    messageId: activeRun?.messageId ?? run?.messageId ?? null,
    status:
      activeRun?.terminalStatus ?? (run?.status as ChatMessageStatus | undefined) ?? 'streaming',
    startedAt: run?.startedAt ?? currentUnixSeconds(),
    finishedAt: run?.finishedAt ?? null,
    modelId: activeRun?.modelId ?? fallback.modelId ?? null,
    providerSessionId:
      activeRun?.runtimeSession.providerSessionId ?? fallback.providerSessionId ?? null,
    queueItemId: activeRun?.queueItemId ?? null,
    runtimeSettings:
      activeRun?.runtimeSettings ?? fallback.runtimeSettings ?? getDefaultRuntimeSettings(runtimeKind),
  }
}
