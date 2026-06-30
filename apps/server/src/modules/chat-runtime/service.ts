import { randomUUID } from 'node:crypto'

import type { BackendRun, Session } from '@cradle/db'
import { backendRuns, chatSessionQueueItems, messages, sessions } from '@cradle/db'
import type { FileUIPart, UIMessage, UIMessageChunk } from 'ai'
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { readPositiveIntegerEnv } from '../../helpers/env'
import { readObjectRecord } from '../../helpers/json-record'
import { currentUnixSeconds } from '../../helpers/time'
import { db } from '../../infra'
import { createChildLogger } from '../../logging/logger'
import { readBuiltinToolCallInputPayload } from '../chat-runtime-providers/tools/tool-call-payload'
import { readProviderStateSnapshot } from '../chat-runtime-providers/provider-state-snapshot'
import * as ModelRegistry from '../model-registry/service'
import { createDedupeKey, OBSERVABILITY_CODES } from '../observability/contract'
import * as Observability from '../observability/service'
import { isAppFeatureFlagEnabled } from '../preferences/service'
import type { RuntimeKind } from '../provider-contracts/types'
import {
  readDurableProviderRuntimeBinding,
  readReusableDurableProviderRuntimeBinding
} from '../provider-runtime/service'
import {
  appendSideConversationHistory,
  readSideConversation,
  releaseSideConversationsByParentSessionId
} from '../provider-runtime/side-conversation-registry'
import * as SessionService from '../session/service'
import type { BangCommandExecutionResult } from './bang-command'
import { executeLocalBangCommand, persistBangCommandMessages } from './bang-command'
import { getRuntimeRegistry } from './chat-runtime-provider-registry'
import type { ChatTurnContext } from './context/turn-context'
import { resolveSessionSystemPrompt, resolveTurnContext } from './context/turn-context'
import type { ChatContextPart } from './context-parts'
import {
  annotateCodexGoalContinuationMessage,
  annotateGoalMessage,
  createAssistantMessage,
  createUserMessage,
  extractMessageText,
  isCodexGoalContinuationMessage,
  normalizeMessageSnapshot,
  parseStoredMessageSnapshot as parseTrustedStoredMessageSnapshot,
  readGoalMessageObjective
} from './ui-message'
import {
  appendPendingRuntimeUserInputSlotStates,
  rejectPendingUserInputsForRun,
  setRuntimeUserInputPublisher
} from './pending-user-input'
import { rejectPendingToolApprovalsForRun, submitRuntimeToolApprovalIfPending } from './pending-tool-approval'
import {
  createProviderThreadStreamStore,
  providerThreadStreamKey,
  publishProviderThreadEvent
} from './provider-threads/live-streams'
import { appendRunSnapshotEvent, finalizeRunSnapshot, startRunSnapshot } from './run-snapshot'
import type {
  FinalMessageProjectionRun,
  FinalMessageProjectionState
} from './run/final-message-projection'
import {
  cancelPendingCodexGoalContinuation,
  hasContinuableCodexGoal,
  scheduleCodexGoalContinuation,
  shouldScheduleCodexGoalContinuation,
  updateCodexGoalContinuationBackoff
} from './run/codex-goal-continuation'
import type { CodexGoalContinuationSchedulerDeps } from './run/codex-goal-continuation'
import {
  isCodexCompactCommandText,
  isCodexGoalCommandText,
  readCodexGoalCommandObjective
} from './run/codex-commands'
import {
  accumulateDiagnostics,
  createTurnOutputDiagnostics,
  resolveTerminalChunkWithDiagnostics
} from './run/output-diagnostics'
import type { TurnOutputDiagnostics } from './run/output-diagnostics'
import { recordChatRuntimeProfile, startChatRuntimeProfile } from './run/profile'
import type { ChatRuntimeProfile } from './run/profile'
import { estimateRunUsageCost, insertRunUsage, insertRuntimeStepUsages } from './run/usage'
import type { RuntimeStepUsageInput } from './run/usage'
import {
  createFinalMessageProjectionState,
  finalizeFinalMessageProjection,
  flushFinalMessageProjection,
  flushProjectedToolInputs,
  projectFinalMessageChunk
} from './run/final-message-projection'
import {
  type ChatMessageStatus,
  isTerminalUIMessageChunk,
  mergeBufferedStreamChunk,
  mergeRuntimeDeltaChunk,
  readDeltaChunkTextLength,
  readReplayCoalesceKey,
  readRunDeltaCoalesceKey,
  readTerminalStatus
} from './run/stream-chunks'
import { readRunWriteFence, type RunWriteFence } from './run/run-write-fence'
import {
  finalizeActiveRunSnapshot as finalizeRunSnapshotEvent,
  readChunkTraceToolCallId,
  readHarnessSnapshotPhase,
  recordActiveRunSnapshotEvent as appendActiveRunSnapshotEvent,
  shouldRecordHarnessSnapshotChunk,
  summarizeSnapshotChunk
} from './run/snapshot-events'
import type { ChunkSubscriber } from './stream/subscriber-registry'
import { createSubscriberRegistry } from './stream/subscriber-registry'
import { openBufferedChunkStream, openDirectChunkStream } from './stream/sse'
import type {
  ChatRuntime,
  ChatRuntimeSettings,
  ChatRuntimeSettingsPatch,
  ChatThinkingEffort,
  GenerateSessionTitleInput,
  ProviderSyntheticTurnEvent,
  ProviderThreadEvent,
  ProviderThreadListInput,
  ProviderThreadListResult,
  ProviderThreadReadResult,
  ProviderThreadSourceKind,
  ProviderThreadTurnsResult,
  RuntimeContextUsage,
  RuntimePresentationCapabilities,
  RuntimeProviderTargetProfile,
  RuntimeSession,
  RuntimeUiSlotState,
  TokenUsage
} from './runtime-provider-types'
import { ProviderRuntimeError, createEmptyRuntimePresentation } from './runtime-provider-types'
import {
  areRuntimeSettingsEqual,
  DEFAULT_RUNTIME_SETTINGS,
  mergeRuntimeSettings,
  normalizeRuntimeAccessMode,
  normalizeRuntimeInteractionMode,
  normalizeRuntimeSettingsPatch,
  readSessionRuntimeSettings,
  writeSessionRuntimeSettingsConfigJson
} from './runtime-settings'
import type {
  ChatSessionContinuationMode,
  ChatSessionQueueItemDto,
  ChatSessionQueueMode,
  ChatSessionQueueStatus,
  EnqueueSessionQueueItemInput,
  PersistedThinkingEffort,
  SessionSteerTurnDto,
  SubmitSessionSteerTurnInput,
  UpdateSessionQueueItemInput
} from './queue/session-queue'
import { scheduleSessionQueueDrain } from './queue/drain'
import type { QueueDrainDeps } from './queue/drain'
import {
  compareQueueRows,
  listPendingQueueRows,
  readPersistedThinkingEffort,
  serializeQueueContextParts,
  serializeQueueFiles,
  toQueueItemDto
} from './queue/session-queue'
import type { SerializedChatError } from './run/errors'
import {
  createSessionTitleGenerationError,
  resolveTurnFailureObservabilityCode,
  serializeChatError
} from './run/errors'
import { isChatStreamTraceEnabled, recordChatStreamTrace } from './stream-trace'
import { createSideChat as createSideChatSession } from './side-chat/create'
import type {
  ActiveParentRuntimeSession,
  CreateSideChatDeps,
  CreateSideChatInput,
  SideChatSessionDto
} from './side-chat/create'
import { createLiveSideConversationStream } from './side-chat/live-stream'
import type { CradleTurnTranscript } from './transcript'
import { readFullSessionTranscript } from './transcript'
import {
  abortProjectedStreamingRun,
  cancelQueuedSessionItem,
  commitLastTurnRolledBack,
  commitSessionEvents,
  normalizeSessionQueuePositions,
  recordQueuePositions,
  recoverChatRuntimeProjections,
  recoverChatRuntimeSession,
  readRunStopReason,
  readRunTerminalEventType,
  type ChatRuntimeRecoveryResult
} from './es/commands'
import type { ResolvedRuntimeSessionContext, SessionRunContext } from './runtime-session-context'
import {
  assertRunnableSession,
  assertRuntimeCompatibleTarget,
  assertStoredSession,
  attachBinding,
  buildRuntimeProviderInput,
  getSessionRunContext,
  isProviderTargetAvailable,
  readSessionRequestedModelId,
  readSessionRequestedThinkingEffort,
  resolveExistingRuntimeSessionForContext,
  resolveRuntimeSessionContext,
  resolveRuntimeSessionForContext
} from './runtime-session-context'
import { runRegistry } from './run-registry'
import type { PendingRunState } from './run-registry'
import {
  normalizeRuntimeSessionTitle,
  regenerateSessionTitle,
  reportRuntimeSessionTitle
} from './title-service'
export { regenerateSessionTitle, reportRuntimeSessionTitle }
import { getSessionRuntimeSettings, updateSessionRuntimeSettings } from './runtime-settings-api'
export { getSessionRuntimeSettings, updateSessionRuntimeSettings }
export type { ChatRuntimeSettingsDto } from './runtime-settings-api'
import {
  getCapabilities,
  getUiSlotStates,
  deleteProviderThread,
  listBackgroundTerminals,
  listProviderThreadTurns,
  listProviderThreads,
  readContextUsage,
  readProviderThread,
  terminateBackgroundTerminal
} from './capabilities-api'
export {
  getCapabilities,
  getUiSlotStates,
  deleteProviderThread,
  listBackgroundTerminals,
  listProviderThreadTurns,
  listProviderThreads,
  readContextUsage,
  readProviderThread,
  terminateBackgroundTerminal
}
export type { ChatSessionContextUsageDto } from './capabilities-api'

export type { CreateSideChatInput, SideChatSessionDto } from './side-chat/create'
export type {
  ChatSessionContinuationMode,
  ChatSessionQueueItemDto,
  ChatSessionQueueMode,
  ChatSessionQueueStatus,
  EnqueueSessionQueueItemInput,
  PersistedThinkingEffort,
  SessionSteerTurnDto,
  SubmitSessionSteerTurnInput,
  UpdateSessionQueueItemInput
} from './queue/session-queue'

const chatLogger = createChildLogger({ module: 'chat-runtime' })
const DEFAULT_STORED_MESSAGE_TEXT_MAX_CHARS = 256_000
const DEFAULT_STORED_MESSAGE_REASONING_MAX_CHARS = 64_000
const DEFAULT_STORED_TOOL_PAYLOAD_MAX_CHARS = 128_000

function shouldContinueBlockedCodexGoals(): boolean {
  return isAppFeatureFlagEnabled('continueBlockedCodexGoals')
}
const DEFAULT_STORED_MESSAGE_REPAIR_MIN_CHARS = 512 * 1024
const DEFAULT_RUN_DELTA_FLUSH_MS = 16
const DEFAULT_RUN_DELTA_FLUSH_CHARS = 8_192
const DEFAULT_SNAPSHOT_INTERVAL_MS = 10_000
const CODEX_GOAL_CONTINUATION_PROMPT = '[internal] Continue the active Codex goal.'

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
    chunk
  })
}

setRuntimeUserInputPublisher(publishRunChunk)

// ── types ──

type TerminalChatMessageStatus = Exclude<ChatMessageStatus, 'streaming'>
export interface ChatMessageSnapshotRow {
  messageId: string
  role: 'user' | 'assistant'
  status: ChatMessageStatus
  errorText?: string
  content: string
  message: Omit<UIMessage, 'role'> & { role: 'user' | 'assistant' }
  parentMessageId: string | null
  parentToolCallId: string | null
  taskId: string | null
  depth: number
}

export interface ActiveRun {
  runId: string
  sessionId: string
  messageId: string
  providerTargetKind: 'manual' | 'external' | null
  providerTargetId: string | null
  runtime: ChatRuntime
  runtimeSession: RuntimeSession
  modelId: string | null
  chunkBuffer: UIMessageChunk[]
  chunkBufferIndexByKey: Map<string, number>
  pendingDeltaChunk: UIMessageChunk | null
  pendingDeltaFlushTimer: StreamFlushTimer | null
  snapshotTimer: ReturnType<typeof setInterval> | null
  finalMessage: UIMessage
  finalProjection: FinalMessageProjectionState
  startChunkPublished?: boolean
  firstTextDeltaSnapshotRecorded?: boolean
  terminalStatus?: TerminalChatMessageStatus
  cancelRequested?: boolean
  queueItemId?: string
  runtimeSettings: ChatRuntimeSettings
  internalContinuation?: 'codexGoal'
  runSnapshotId?: string | null
  runSnapshotSeq: number
}

interface ProviderSyntheticTurnState extends FinalMessageProjectionRun {
  providerTurnId: string
  providerThreadId: string | null
  runId: string | null
  sessionId: string
  messageId: string
  runtimeSession: RuntimeSession
  providerTargetId: string | null
  modelId: string | null
  terminalStatus?: TerminalChatMessageStatus
}

type MutableToolPart = Extract<UIMessage['parts'][number], { toolCallId: string }>
type MutableApprovalToolPart = MutableToolPart & {
  approval?: {
    id?: unknown
    approved?: unknown
    reason?: unknown
  }
  input?: unknown
  state?: string
  toolName?: string
  type: string
}

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

export interface CompletedChatRunDto {
  runId: string
  sessionId: string
  sessionTitle: string
  messageId: string | null
  responseBody: string | null
  messagePreview: string | null
  startedAt: number
  finishedAt: number
}

export interface CompletedChatRunsDto {
  runs: CompletedChatRunDto[]
}

export type RuntimeSessionStatusKind = 'idle' | 'pending' | 'streaming' | 'cancelling'

export interface RuntimeSessionRunDto {
  runId: string
  messageId: string | null
  status: ChatMessageStatus
  startedAt: number
  finishedAt: number | null
  modelId: string | null
  providerSessionId: string | null
  queueItemId: string | null
  runtimeSettings: ChatRuntimeSettings
}

export interface ChatRuntimeSessionStatusDto {
  sessionId: string
  status: RuntimeSessionStatusKind
  runtimeKind: RuntimeKind
  providerTargetId: string | null
  providerSessionId: string | null
  modelId: string | null
  runtimeSettings: ChatRuntimeSettings
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

export interface RollbackLastTurnDto {
  ok: true
  sessionId: string
  messageIds: string[]
  providerRuntimeKind: string
  providerSessionId: string | null
  providerRolledBackTurns: number
  fileChangesReverted: false
}

type StreamFlushTimer = ReturnType<typeof setTimeout>

export interface QuickQuestionInput {
  sessionId: string
  question: string
}

type ProviderBoundSessionRunContext = SessionRunContext & {
  profile: RuntimeProviderTargetProfile
  providerTarget: { id: string; kind: 'manual' | 'external' }
}

function assertProviderBoundRunContext(
  context: SessionRunContext,
  operation: string
): ProviderBoundSessionRunContext {
  if (context.profile && context.providerTarget) {
    return context as ProviderBoundSessionRunContext
  }
  throw new AppError({
    code: 'chat_provider_target_required',
    status: 409,
    message: `${operation} requires a provider target bound runtime`,
    details: {
      sessionId: context.session.id,
      runtimeKind: context.session.runtimeKind ?? 'standard'
    }
  })
}

// ── in-memory run state ──

const runSubscribers = createSubscriberRegistry()
const providerThreadStreamStore = createProviderThreadStreamStore()
const messageInsertOrder = sql`messages.rowid`
const sideChatDeps: CreateSideChatDeps = {
  getParentSession: (parentSessionId) => assertStoredSession(parentSessionId),
  getParentContext: (parentSessionId, providerTargetId) =>
    assertProviderBoundRunContext(
      assertRuntimeCompatibleTarget(assertRunnableSession(parentSessionId), providerTargetId),
      'Side conversation'
    ),
  getRuntime: (runtimeKind) => getRuntimeRegistry().get(runtimeKind),
  getActiveParentRuntimeSession: (parentSessionId): ActiveParentRuntimeSession | undefined => {
    const activeRunId = runRegistry.getActiveRunIdForSession(parentSessionId)
    const activeRun = activeRunId ? runRegistry.getActiveRun(activeRunId) : undefined
    return activeRun?.providerTargetId
      ? {
          providerTargetId: activeRun.providerTargetId,
          runtimeSession: activeRun.runtimeSession,
          modelId: activeRun.modelId
        }
      : undefined
  },
  readReusableBinding: (input) =>
    readReusableDurableProviderRuntimeBinding({
      chatSessionId: input.parentSessionId,
      providerTargetId: input.providerTargetId,
      runtimeKind: input.runtimeKind
    }),
  readTranscript: (parentSessionId) => readFullSessionTranscript(parentSessionId),
  resolveSystemPrompt: (session) => resolveSessionSystemPrompt(session),
  normalizeTitle: (title) => normalizeRuntimeSessionTitle(title)
}
const queueDrainDeps: QueueDrainDeps = {
  hasActiveOrPendingRun: (sessionId) =>
    runRegistry.hasActiveRunForSession(sessionId) || runRegistry.hasPendingRun(sessionId),
  readSessionRuntimeSettings: (sessionId) => {
    const session = assertStoredSession(sessionId)
    return readSessionRuntimeSettings(session.configJson)
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
      runtimeSettings: input.runtimeSettings,
      continuationMode: 'queue',
      queueItemId: input.queueItemId
    })
    return { runId: run.runId }
  },
  serializeError: (error) => serializeChatError(error)
}
const codexGoalContinuationDeps: CodexGoalContinuationSchedulerDeps = {
  hasActiveOrPendingRun: (sessionId) =>
    runRegistry.hasActiveRunForSession(sessionId) || runRegistry.hasPendingRun(sessionId),
  pendingQueueItemCount: (sessionId) => listPendingQueueRows(sessionId).length,
  scheduleQueueDrain: (sessionId) => scheduleSessionQueueDrain(sessionId, queueDrainDeps),
  readRuntimeBinding: readDurableProviderRuntimeBinding,
  isProviderTargetAvailable: (providerTargetId) => isProviderTargetAvailable(providerTargetId),
  createContinuationRun: async (input) => {
    await createRun({
      sessionId: input.sessionId,
      providerTargetId: input.providerTargetId,
      modelId: input.modelId,
      internalContinuation: 'codexGoal'
    })
  }
}

function truncateJsonPayload(value: unknown, maxChars: number): unknown {
  if (value === undefined || value === null) {
    return value
  }

  try {
    const json = JSON.stringify(value)
    if (json.length <= maxChars) {
      return value
    }
    return {
      type: 'cradle.truncated-json-payload.v1',
      originalChars: json.length,
      preview: json.slice(0, maxChars)
    }
  } catch {
    const text = String(value)
    if (text.length <= maxChars) {
      return text
    }
    return {
      type: 'cradle.truncated-text-payload.v1',
      originalChars: text.length,
      preview: text.slice(0, maxChars)
    }
  }
}

function truncateSnapshotPayload(value: unknown): unknown {
  return truncateJsonPayload(
    value,
    readPositiveIntegerEnv(
      'CRADLE_CHAT_STORED_TOOL_PAYLOAD_MAX_CHARS',
      DEFAULT_STORED_TOOL_PAYLOAD_MAX_CHARS
    )
  )
}

function annotateContinuationMessage(
  message: UIMessage,
  continuation: {
    mode: ChatSessionContinuationMode
    queueItemId?: string
    sourceMessageId?: string
    splitParts?: UIMessage['parts']
  } | null
): UIMessage {
  if (!continuation) {
    return message
  }

  const currentMetadata = readObjectRecord((message as { metadata?: unknown }).metadata)
  const currentCradleMetadata = readObjectRecord(currentMetadata.cradle)

  return {
    ...message,
    metadata: {
      ...currentMetadata,
      cradle: {
        ...currentCradleMetadata,
        continuation: {
          mode: continuation.mode,
          ...(continuation.queueItemId ? { queueItemId: continuation.queueItemId } : {}),
          ...(continuation.sourceMessageId
            ? { sourceMessageId: continuation.sourceMessageId }
            : {}),
          ...(continuation.splitParts !== undefined ? { splitParts: continuation.splitParts } : {})
        }
      }
    }
  } as UIMessage
}

async function createDraftTurn(input: {
  sessionId: string
  runtimeKind: RuntimeKind
  userText: string
  files: FileUIPart[]
  contextParts: ChatContextPart[]
  continuation?: { mode: ChatSessionContinuationMode; queueItemId?: string }
}): Promise<{
  userMessageId: string
  assistantMessageId: string
  userMessage: UIMessage
}> {
  const userMessageId = randomUUID()
  const assistantMessageId = randomUUID()
  const now = currentUnixSeconds()
  const goalObjective =
    input.runtimeKind === 'codex' ? readCodexGoalCommandObjective(input.userText) : null
  const userText = goalObjective ?? input.userText
  const userMessage = annotateContinuationMessage(
    goalObjective
      ? annotateGoalMessage(
          createUserMessage(userMessageId, userText, input.files, input.contextParts),
          goalObjective
        )
      : createUserMessage(userMessageId, userText, input.files, input.contextParts),
    input.continuation ?? null
  )
  const userContent = extractMessageText(userMessage)

  await commitSessionEvents(input.sessionId, [
    {
      type: 'UserMessageAppended',
      payload: {
        message: {
          id: userMessageId,
          sessionId: input.sessionId,
          parentMessageId: null,
          parentToolCallId: null,
          taskId: null,
          depth: 0,
          role: 'user',
          status: 'complete',
          content: userContent,
          messageJson: JSON.stringify(userMessage),
          createdAt: now,
          updatedAt: now
        }
      }
    }
  ])

  return { userMessageId, assistantMessageId, userMessage }
}

async function createDraftTurnFromUserMessage(input: {
  sessionId: string
  userMessage: UIMessage
  continuation?: { mode: ChatSessionContinuationMode; queueItemId?: string }
}): Promise<{
  userMessageId: string
  assistantMessageId: string
  userMessage: UIMessage
}> {
  const assistantMessageId = randomUUID()
  const now = currentUnixSeconds()
  const userMessage = annotateContinuationMessage(input.userMessage, input.continuation ?? null)

  await commitSessionEvents(input.sessionId, [
    {
      type: 'UserMessageAppended',
      payload: {
        message: {
          id: userMessage.id,
          sessionId: input.sessionId,
          parentMessageId: null,
          parentToolCallId: null,
          taskId: null,
          depth: 0,
          role: 'user',
          status: 'complete',
          content: extractMessageText(userMessage),
          messageJson: JSON.stringify(userMessage),
          createdAt: now,
          updatedAt: now
        }
      }
    }
  ])

  return { userMessageId: userMessage.id, assistantMessageId, userMessage }
}

async function insertCompletedUserMessage(input: {
  sessionId: string
  message: UIMessage
  parentMessageId?: string | null
}): Promise<void> {
  const now = currentUnixSeconds()
  await commitSessionEvents(input.sessionId, [
    {
      type: 'SteerApplied',
      payload: {
        message: {
          id: input.message.id,
          sessionId: input.sessionId,
          parentMessageId: input.parentMessageId ?? null,
          parentToolCallId: null,
          taskId: null,
          depth: 0,
          role: 'user',
          status: 'complete',
          content: extractMessageText(input.message),
          messageJson: JSON.stringify(input.message),
          createdAt: now,
          updatedAt: now
        }
      }
    }
  ])
}

async function startRun(input: {
  sessionId: string
  messageId: string
  origin: 'user' | 'issue-agent' | 'system'
  assistantMessage: UIMessage
  assistantMessageProjection?: 'insert' | 'update'
  queueItemId?: string | null
}): Promise<BackendRun> {
  const binding = readDurableProviderRuntimeBinding(input.sessionId)
  const now = currentUnixSeconds()
  const run: BackendRun = {
    id: randomUUID(),
    bindingId: binding?.id ?? null,
    chatSessionId: input.sessionId,
    messageId: input.messageId,
    origin: input.origin,
    status: 'streaming',
    stopReason: null,
    errorText: null,
    startedAt: now,
    finishedAt: null
  }
  await commitSessionEvents(input.sessionId, [
    {
      type: 'RunStarted',
      payload: {
        run,
        assistantMessage: {
          id: input.messageId,
          sessionId: input.sessionId,
          parentMessageId: null,
          parentToolCallId: null,
          taskId: null,
          depth: 0,
          role: 'assistant',
          status: 'streaming',
          content: extractMessageText(input.assistantMessage),
          messageJson: JSON.stringify(input.assistantMessage),
          errorText: null,
          createdAt: now,
          updatedAt: now
        },
        assistantMessageProjection: input.assistantMessageProjection ?? 'insert',
        queueItemId: input.queueItemId ?? null
      }
    }
  ])
  return run
}

function createProviderSyntheticTurnEventHandler(
  activeRun: ActiveRun
): (event: ProviderSyntheticTurnEvent) => Promise<void> {
  const syntheticTurns = new Map<string, ProviderSyntheticTurnState>()

  return async (event) => {
    if (event.chunks.length === 0) {
      return
    }

    if (event.providerThreadId) {
      publishProviderThreadEvent({
        store: providerThreadStreamStore,
        sessionId: activeRun.sessionId,
        event: {
          providerThreadId: event.providerThreadId,
          providerTurnId: event.providerTurnId,
          notification: { type: 'providerSyntheticTurn' },
          chunks: event.chunks
        },
        isTerminalChunk: isTerminalUIMessageChunk
      })
    }

    let syntheticTurn = syntheticTurns.get(event.providerTurnId)
    try {
      if (!syntheticTurn) {
        syntheticTurn = startProviderSyntheticTurn(activeRun, event)
        syntheticTurns.set(event.providerTurnId, syntheticTurn)
      }

      for (const chunk of event.chunks) {
        await applyProviderSyntheticTurnChunk(syntheticTurn, chunk)
        if (syntheticTurn.terminalStatus) {
          syntheticTurns.delete(event.providerTurnId)
          break
        }
      }
    } catch (error) {
      if (syntheticTurn && !syntheticTurn.terminalStatus) {
        syntheticTurns.delete(event.providerTurnId)
        await finalizeProviderSyntheticTurn(
          syntheticTurn,
          'failed',
          error instanceof Error ? error.message : String(error),
          { type: 'error', errorText: error instanceof Error ? error.message : String(error) }
        )
      }
      throw error
    }
  }
}

function startProviderSyntheticTurn(
  parentRun: ActiveRun,
  event: ProviderSyntheticTurnEvent
): ProviderSyntheticTurnState {
  const messageId = randomUUID()
  const assistantMessage = createAssistantMessage(messageId)

  return {
    providerTurnId: event.providerTurnId,
    providerThreadId: event.providerThreadId ?? null,
    runId: null,
    sessionId: parentRun.sessionId,
    messageId,
    runtimeSession: parentRun.runtimeSession,
    providerTargetId: parentRun.providerTargetId,
    modelId: parentRun.modelId,
    finalMessage: assistantMessage,
    finalProjection: createFinalMessageProjectionState()
  }
}

async function applyProviderSyntheticTurnChunk(
  syntheticTurn: ProviderSyntheticTurnState,
  chunk: UIMessageChunk
): Promise<void> {
  if (syntheticTurn.terminalStatus) {
    return
  }

  if (!isTerminalUIMessageChunk(chunk)) {
    projectFinalMessageChunk(syntheticTurn, chunk)
    return
  }

  await finalizeProviderSyntheticTurn(
    syntheticTurn,
    readTerminalStatus(chunk),
    chunk.type === 'error' ? chunk.errorText : null,
    chunk
  )
}

async function finalizeProviderSyntheticTurn(
  syntheticTurn: ProviderSyntheticTurnState,
  status: TerminalChatMessageStatus,
  errorText: string | null,
  terminalChunk: UIMessageChunk
): Promise<void> {
  if (syntheticTurn.terminalStatus) {
    return
  }
  syntheticTurn.terminalStatus = status
  projectFinalMessageChunk(syntheticTurn, terminalChunk)
  finalizeFinalMessageProjection(syntheticTurn)
  await flushProjectedToolInputs(syntheticTurn)

  const bindingId = recordProviderSyntheticTurnBindingId(syntheticTurn)
  const now = currentUnixSeconds()
  const message = compactStoredMessageSnapshot(normalizeMessageSnapshot(syntheticTurn.finalMessage))
  const messageJson = JSON.stringify(message)
  const run: BackendRun = {
    id: randomUUID(),
    bindingId: bindingId ?? null,
    chatSessionId: syntheticTurn.sessionId,
    messageId: syntheticTurn.messageId,
    origin: 'system',
    status: 'streaming',
    stopReason: null,
    errorText: null,
    startedAt: now,
    finishedAt: null
  }
  syntheticTurn.runId = run.id
  await commitSessionEvents(syntheticTurn.sessionId, [
    {
      type: 'RunStarted',
      payload: {
        run,
        assistantMessage: {
          id: syntheticTurn.messageId,
          sessionId: syntheticTurn.sessionId,
          parentMessageId: null,
          parentToolCallId: null,
          taskId: null,
          depth: 0,
          role: 'assistant',
          status: 'streaming',
          content: extractMessageText(message),
          messageJson,
          errorText: null,
          createdAt: now,
          updatedAt: now
        },
        assistantMessageProjection: 'insert',
        queueItemId: null
      }
    },
    {
      type: 'AssistantMessageCompleted',
      payload: {
        message: {
          id: syntheticTurn.messageId,
          sessionId: syntheticTurn.sessionId,
          content: extractMessageText(message),
          messageJson,
          status,
          errorText,
          updatedAt: now
        }
      }
    },
    {
      type: readRunTerminalEventType(status),
      payload: {
        runId: run.id,
        sessionId: syntheticTurn.sessionId,
        queueItemId: null,
        ...(bindingId !== undefined ? { bindingId } : {}),
        status,
        stopReason: readRunStopReason(status),
        errorText,
        finishedAt: now
      }
    }
  ])
}

function recordProviderSyntheticTurnBindingId(
  syntheticTurn: ProviderSyntheticTurnState
): string | undefined {
  try {
    return attachBinding({
      sessionId: syntheticTurn.sessionId,
      providerTargetId: syntheticTurn.providerTargetId,
      runtimeKind: syntheticTurn.runtimeSession.runtimeKind,
      runtimeSession: syntheticTurn.runtimeSession,
      requestedModelId: syntheticTurn.modelId
    })?.id
  } catch {
    return undefined
  }
}

function getRun(runId: string): BackendRun | undefined {
  return db().select().from(backendRuns).where(eq(backendRuns.id, runId)).get()
}

export function listCompletedRuns(input: {
  since?: number | null
  limit?: number | null
}): CompletedChatRunsDto {
  const since = Math.max(0, Math.floor(input.since ?? 0))
  const limit = Math.min(Math.max(Math.floor(input.limit ?? 50), 1), 200)
  const rows = db()
    .select({
      runId: backendRuns.id,
      sessionId: backendRuns.chatSessionId,
      sessionTitle: sessions.title,
      messageId: backendRuns.messageId,
      messageContent: messages.content,
      startedAt: backendRuns.startedAt,
      finishedAt: backendRuns.finishedAt
    })
    .from(backendRuns)
    .innerJoin(sessions, eq(sessions.id, backendRuns.chatSessionId))
    .leftJoin(messages, eq(messages.id, backendRuns.messageId))
    .where(
      and(
        eq(backendRuns.status, 'complete'),
        sql`${backendRuns.finishedAt} IS NOT NULL`,
        sql`${backendRuns.finishedAt} > ${since}`
      )
    )
    .orderBy(desc(backendRuns.finishedAt), desc(backendRuns.startedAt))
    .limit(limit)
    .all()

  return {
    runs: rows
      .filter((row) => row.finishedAt !== null)
      .map((row) => ({
        runId: row.runId,
        sessionId: row.sessionId,
        sessionTitle: row.sessionTitle,
        messageId: row.messageId,
        responseBody: row.messageContent || null,
        messagePreview: row.messageContent ? row.messageContent.slice(0, 200) : null,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt ?? row.startedAt
      }))
  }
}

export function listActiveRunSummaries(): ActiveRunSummary[] {
  return runRegistry.listActiveRuns().map((run) => ({
    runId: run.runId,
    sessionId: run.sessionId,
    messageId: run.messageId,
    providerTargetKind: run.providerTargetKind,
    providerTargetId: run.providerTargetId,
    modelId: run.modelId
  }))
}

export function getActiveRunReplayBufferSummary(
  runId: string
): ActiveRunReplayBufferSummary | null {
  const run = runRegistry.getActiveRun(runId)
  if (!run) {
    return null
  }
  return {
    runId,
    chunkCount: run.chunkBuffer.length,
    textDeltaCount: run.chunkBuffer.filter((chunk) => chunk.type === 'text-delta').length,
    reasoningDeltaCount: run.chunkBuffer.filter((chunk) => chunk.type === 'reasoning-delta').length,
    toolInputDeltaCount: run.chunkBuffer.filter((chunk) => chunk.type === 'tool-input-delta')
      .length,
    toolOutputCount: run.chunkBuffer.filter((chunk) => chunk.type === 'tool-output-available')
      .length,
    maxDeltaChars: run.chunkBuffer.reduce(
      (max, chunk) => Math.max(max, readDeltaChunkTextLength(chunk)),
      0
    )
  }
}

export function getActiveSessionRun(sessionId: string): ActiveRunSummary | null {
  const runId = runRegistry.getActiveRunIdForSession(sessionId)
  if (!runId) {
    return null
  }
  const run = runRegistry.getActiveRun(runId)
  return run
    ? {
        runId: run.runId,
        sessionId: run.sessionId,
        messageId: run.messageId,
        providerTargetKind: run.providerTargetKind,
        providerTargetId: run.providerTargetId,
        modelId: run.modelId
      }
    : null
}

export async function getRuntimeSessionStatus(
  sessionId: string
): Promise<ChatRuntimeSessionStatusDto> {
  const session = db().select().from(sessions).where(eq(sessions.id, sessionId)).get()
  if (!session) {
    throw new AppError({
      code: 'chat_session_not_found',
      status: 404,
      message: 'Chat session not found',
      details: { sessionId }
    })
  }

  await releaseTerminalPersistedActiveRunForSession(sessionId)

  const binding = session.providerTargetId
    ? readReusableDurableProviderRuntimeBinding({
        chatSessionId: sessionId,
        providerTargetId: session.providerTargetId,
        runtimeKind: session.runtimeKind as RuntimeKind
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
      status: chatSessionQueueItems.status
    })
    .from(chatSessionQueueItems)
    .where(
      and(eq(chatSessionQueueItems.sessionId, sessionId), eq(chatSessionQueueItems.mode, 'queue'))
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
    { pending: 0, running: 0 }
  )

  const runtimeKind =
    activeRun?.runtimeSession.runtimeKind ??
    (binding?.runtimeKind as RuntimeKind | undefined) ??
    session.runtimeKind
  const providerTargetId =
    activeRun?.providerTargetId ?? binding?.providerTargetId ?? session.providerTargetId
  const providerSessionId =
    activeRun?.runtimeSession.providerSessionId ?? binding?.backendSessionId ?? null
  const modelId =
    activeRun?.modelId ?? SessionService.readSessionModelPreference(session.configJson) ?? binding?.requestedModelId ?? null
  const runtimeSettings =
    activeRun?.runtimeSettings ?? readSessionRuntimeSettings(session.configJson)
  const providerTargetAvailable = activeRun ? true : isProviderTargetAvailable(providerTargetId)
  const hasActiveGoal =
    binding?.runtimeKind === 'codex' &&
    hasContinuableCodexGoal(binding.backendStateSnapshot, {
      continueBlockedGoals: shouldContinueBlockedCodexGoals()
    }) &&
    providerTargetAvailable
  const status: RuntimeSessionStatusKind = activeRun
    ? activeRun.cancelRequested
      ? 'cancelling'
      : 'streaming'
    : pendingState
      ? 'pending'
      : 'idle'
  if (status === 'idle' && hasActiveGoal && binding && queue.pending === 0 && queue.running === 0) {
    scheduleCodexGoalContinuation(
      {
        sessionId,
        providerTargetId: providerTargetId ?? undefined,
        modelId: modelId ?? undefined,
        continueBlockedGoals: shouldContinueBlockedCodexGoals()
      },
      codexGoalContinuationDeps
    )
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
          runtimeSettings
        })
      : null,
    queue
  }
}

function toRuntimeSessionRunDto(
  activeRun: ActiveRun | null,
  run: BackendRun | undefined,
  fallback: {
    modelId?: string | null
    providerSessionId?: string | null
    runtimeSettings?: ChatRuntimeSettings
  } = {}
): RuntimeSessionRunDto {
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
      activeRun?.runtimeSettings ?? fallback.runtimeSettings ?? DEFAULT_RUNTIME_SETTINGS
  }
}

function persistMessageSnapshot(input: {
  sessionId: string
  messageId: string
  message: UIMessage
  messageStatus: ChatMessageStatus
  errorText: string | null
}): { messageJsonBytes: number } {
  const now = currentUnixSeconds()
  const message = compactStoredMessageSnapshot(normalizeMessageSnapshot(input.message))
  const messageJson = JSON.stringify(message)
  db().transaction((tx) => {
    tx.update(messages)
      .set({
        content: extractMessageText(message),
        messageJson,
        status: input.messageStatus,
        errorText: input.errorText,
        updatedAt: now
      })
      .where(and(eq(messages.id, input.messageId), eq(messages.sessionId, input.sessionId)))
      .run()

    tx.update(sessions).set({ updatedAt: now }).where(eq(sessions.id, input.sessionId)).run()
  })
  return { messageJsonBytes: Buffer.byteLength(messageJson) }
}

function compactStoredMessageSnapshotForRead(input: {
  row: typeof messages.$inferSelect
  message: ChatMessageSnapshotRow['message']
}): ChatMessageSnapshotRow['message'] {
  const repairMinChars = readPositiveIntegerEnv(
    'CRADLE_CHAT_STORED_MESSAGE_REPAIR_MIN_CHARS',
    DEFAULT_STORED_MESSAGE_REPAIR_MIN_CHARS
  )
  if (input.row.messageJson.length < repairMinChars) {
    return input.message
  }

  const compactedMessage = compactStoredMessageSnapshot(input.message)
  if (compactedMessage === input.message) {
    return input.message
  }

  const compactedJson = JSON.stringify(compactedMessage)
  if (compactedJson.length >= input.row.messageJson.length) {
    return input.message
  }

  return compactedMessage as ChatMessageSnapshotRow['message']
}

function compactStoredMessageSnapshot(message: UIMessage): UIMessage {
  const textLimit = readPositiveIntegerEnv(
    'CRADLE_CHAT_STORED_TEXT_MAX_CHARS',
    DEFAULT_STORED_MESSAGE_TEXT_MAX_CHARS
  )
  const reasoningLimit = readPositiveIntegerEnv(
    'CRADLE_CHAT_STORED_REASONING_MAX_CHARS',
    DEFAULT_STORED_MESSAGE_REASONING_MAX_CHARS
  )
  const toolPayloadLimit = readPositiveIntegerEnv(
    'CRADLE_CHAT_STORED_TOOL_PAYLOAD_MAX_CHARS',
    DEFAULT_STORED_TOOL_PAYLOAD_MAX_CHARS
  )
  let changed = false
  let remainingText = textLimit
  let remainingReasoning = reasoningLimit

  const parts = message.parts.map((part) => {
    if (part.type === 'text') {
      const nextText =
        part.text.length <= remainingText ? part.text : part.text.slice(0, remainingText)
      remainingText = Math.max(0, remainingText - nextText.length)
      if (nextText !== part.text) {
        changed = true
        return {
          ...part,
          text: nextText,
          providerMetadata: {
            ...readObjectRecord((part as { providerMetadata?: unknown }).providerMetadata),
            cradle: {
              ...readObjectRecord(
                readObjectRecord((part as { providerMetadata?: unknown }).providerMetadata).cradle
              ),
              truncated: true,
              originalChars: part.text.length
            }
          }
        } as UIMessage['parts'][number]
      }
      return part
    }

    if (part.type === 'reasoning') {
      const nextText =
        part.text.length <= remainingReasoning ? part.text : part.text.slice(0, remainingReasoning)
      remainingReasoning = Math.max(0, remainingReasoning - nextText.length)
      if (nextText !== part.text) {
        changed = true
        return {
          ...part,
          text: nextText,
          providerMetadata: {
            ...readObjectRecord((part as { providerMetadata?: unknown }).providerMetadata),
            cradle: {
              ...readObjectRecord(
                readObjectRecord((part as { providerMetadata?: unknown }).providerMetadata).cradle
              ),
              truncated: true,
              originalChars: part.text.length
            }
          }
        } as UIMessage['parts'][number]
      }
      return part
    }

    if ('toolCallId' in part && (part.type === 'dynamic-tool' || part.type.startsWith('tool-'))) {
      let nextPart = part as Record<string, unknown>
      if ('input' in nextPart) {
        const inputPayload = truncateJsonPayload(nextPart.input, toolPayloadLimit)
        if (inputPayload !== nextPart.input) {
          changed = true
          nextPart = { ...nextPart, input: inputPayload }
        }
      }
      if ('output' in nextPart) {
        const outputPayload = truncateJsonPayload(nextPart.output, toolPayloadLimit)
        if (outputPayload !== nextPart.output) {
          changed = true
          nextPart = { ...nextPart, output: outputPayload }
        }
      }
      return nextPart as UIMessage['parts'][number]
    }

    return part
  })

  return changed ? { ...message, parts } : message
}

function normalizeBangCommandOrThrow(commandText: string): string {
  const command = commandText.trim()
  if (!command) {
    throw new AppError({
      code: 'chat_bang_command_empty',
      status: 400,
      message: 'Bang command must not be empty'
    })
  }
  if (command.includes('\n') || command.includes('\r')) {
    throw new AppError({
      code: 'chat_bang_command_multiline_unsupported',
      status: 400,
      message: 'Bang command must be a single line'
    })
  }
  return command
}

export async function createSideChat(input: CreateSideChatInput): Promise<SideChatSessionDto> {
  return createSideChatSession(input, sideChatDeps)
}

export async function executeBangCommand(input: {
  sessionId: string
  command: string
  signal?: AbortSignal
}): Promise<BangCommandExecutionResult> {
  const command = normalizeBangCommandOrThrow(input.command)
  const session = assertStoredSession(input.sessionId)
  const runtimeKind = session.runtimeKind ?? 'standard'

  if (runtimeKind !== 'codex') {
    return await executeLocalBangCommand({ ...input, command })
  }

  const context = assertProviderBoundRunContext(
    assertRuntimeCompatibleTarget(assertRunnableSession(input.sessionId)),
    'Codex bang command'
  )
  if (!context.profile.enabled) {
    throw new AppError({
      code: 'chat_provider_target_not_available',
      status: 409,
      message: 'Provider target is disabled',
      details: {
        providerTargetId: context.providerTarget.id
      }
    })
  }

  const activeRunId = runRegistry.getActiveRunIdForSession(input.sessionId)
  if (
    activeRunId &&
    runRegistry.getActiveRun(activeRunId)?.runtimeSession.runtimeKind === 'codex'
  ) {
    throw new AppError({
      code: 'chat_bang_command_runtime_busy',
      status: 409,
      message: 'Codex bang commands cannot run while a Codex response is streaming',
      details: { sessionId: input.sessionId }
    })
  }

  const runtime = getRuntimeRegistry().get('codex')
  if (!runtime?.capabilities.supportsShellExecution || !runtime.executeShellCommand) {
    throw new AppError({
      code: 'chat_runtime_shell_command_unavailable',
      status: 501,
      message: 'Codex runtime does not support shell command execution'
    })
  }

  const { runtimeSession, requestedModelId } = await resolveRuntimeSessionForContext({
    sessionId: input.sessionId,
    context,
    runtimeKind,
    runtime
  })

  const output = await runtime.executeShellCommand({
    runtimeSession,
    profile: context.profile,
    workspaceId: context.session.workspaceId,
    workspacePath: context.workspacePath,
    agentId: context.session.agentId,
    modelId: requestedModelId ?? undefined,
    command,
    signal: input.signal
  })

  attachBinding({
    sessionId: input.sessionId,
    providerTargetId: context.providerTarget.id,
    runtimeKind: runtimeSession.runtimeKind,
    runtimeSession,
    requestedModelId
  })

  return {
    ...output,
    ...(await persistBangCommandMessages({
      sessionId: input.sessionId,
      ...output
    }))
  }
}

// ── public service functions ──

export async function rollbackLastTurn(sessionId: string): Promise<RollbackLastTurnDto> {
  await finalizeInterruptedPersistedStreamingSessionIfIdle(sessionId)

  if (runRegistry.hasActiveRunForSession(sessionId) || runRegistry.hasPendingRun(sessionId)) {
    throw new AppError({
      code: 'chat_rollback_run_in_progress',
      status: 409,
      message: 'Chat session has an active or pending run',
      details: { sessionId }
    })
  }

  const queue = readBlockingQueueCounts(sessionId)
  if (queue.pending > 0 || queue.running > 0) {
    throw new AppError({
      code: 'chat_rollback_queue_in_progress',
      status: 409,
      message: 'Chat session has pending or running queue items',
      details: { sessionId, queue }
    })
  }

  const tailRows = readLastTopLevelUserTurnTail(sessionId)
  const streamingMessage = tailRows.find((row) => row.status === 'streaming')
  if (streamingMessage) {
    throw new AppError({
      code: 'chat_rollback_streaming_tail',
      status: 409,
      message: 'Cannot roll back a streaming chat turn',
      details: { sessionId, messageId: streamingMessage.id }
    })
  }

  const resolved = await resolveRuntimeSessionContext(sessionId)
  if (!resolved.runtime.capabilities.supportsLastTurnRollback || !resolved.runtime.rollbackLastTurn) {
    throw new AppError({
      code: 'chat_rollback_not_supported',
      status: 501,
      message: 'The current chat runtime does not support last-turn rollback',
      details: { sessionId, runtimeKind: resolved.runtimeKind }
    })
  }

  cancelPendingCodexGoalContinuation(sessionId)
  const providerResult = await resolved.runtime.rollbackLastTurn(buildRuntimeProviderInput(resolved))
  const messageIds = tailRows.map((row) => row.id)

  try {
    await commitLastTurnRolledBack({
      sessionId,
      messageIds,
      providerRuntimeKind: providerResult.runtimeKind,
      providerSessionId: providerResult.providerSessionId,
      providerRolledBackTurns: providerResult.rolledBackTurns,
      fileChangesReverted: providerResult.fileChangesReverted
    })
  } catch (error) {
    throw new AppError({
      code: 'chat_rollback_projection_failed',
      status: 500,
      message:
        'Provider rollback succeeded, but Cradle failed to record the transcript rollback. The session may need recovery.',
      details: {
        sessionId,
        messageIds,
        runtimeKind: providerResult.runtimeKind,
        providerSessionId: providerResult.providerSessionId,
        error: error instanceof Error ? error.message : String(error)
      }
    })
  }

  attachBinding({
    sessionId,
    providerTargetId: resolved.context.providerTarget?.id ?? null,
    runtimeKind: resolved.runtimeSession.runtimeKind,
    runtimeSession: resolved.runtimeSession,
    requestedModelId: resolved.modelId ?? null
  })

  return {
    ok: true,
    sessionId,
    messageIds,
    providerRuntimeKind: providerResult.runtimeKind,
    providerSessionId: providerResult.providerSessionId,
    providerRolledBackTurns: providerResult.rolledBackTurns,
    fileChangesReverted: providerResult.fileChangesReverted
  }
}

export async function getMessageGroups(sessionId: string): Promise<ChatMessageSnapshotRow[]> {
  assertStoredSession(sessionId)

  const rows = db()
    .select()
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(messages.createdAt, messageInsertOrder)
    .all()

  return rows.map((row) => {
    const role = row.role as 'user' | 'assistant'
    const parsedMessage = parseStoredMessageSnapshot(row, role)
    const message = compactStoredMessageSnapshotForRead({
      row,
      message: parsedMessage
    })
    if (message.id !== row.id || message.role !== role) {
      throw new AppError({
        code: 'chat_message_snapshot_invalid',
        status: 500,
        message: 'Stored chat message snapshot is invalid',
        details: {
          messageId: row.id,
          role,
          reason:
            message.id !== row.id
              ? 'message_json.id must match messages.id'
              : 'message_json.role must match messages.role'
        }
      })
    }

    return {
      messageId: row.id,
      role,
      status: row.status as ChatMessageStatus,
      errorText: row.errorText ?? undefined,
      content: extractMessageText(message),
      message,
      parentMessageId: row.parentMessageId,
      parentToolCallId: row.parentToolCallId,
      taskId: row.taskId,
      depth: row.depth
    }
  })
}

function readBlockingQueueCounts(sessionId: string): { pending: number; running: number } {
  const rows = db()
    .select({ status: chatSessionQueueItems.status })
    .from(chatSessionQueueItems)
    .where(
      and(eq(chatSessionQueueItems.sessionId, sessionId), eq(chatSessionQueueItems.mode, 'queue'))
    )
    .all()

  return rows.reduce(
    (counts, row) => {
      if (row.status === 'pending') {
        counts.pending += 1
      }
      if (row.status === 'running') {
        counts.running += 1
      }
      return counts
    },
    { pending: 0, running: 0 }
  )
}

function readLastTopLevelUserTurnTail(sessionId: string): (typeof messages.$inferSelect)[] {
  assertStoredSession(sessionId)
  const rows = db()
    .select()
    .from(messages)
    .where(and(eq(messages.sessionId, sessionId), isNull(messages.parentToolCallId)))
    .orderBy(messages.createdAt, messageInsertOrder)
    .all()

  let lastUserIndex = -1
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]
    if (row?.role === 'user' && row.status === 'complete') {
      lastUserIndex = index
      break
    }
  }

  if (lastUserIndex < 0) {
    throw new AppError({
      code: 'chat_rollback_no_turn',
      status: 409,
      message: 'Chat session has no completed user turn to roll back',
      details: { sessionId }
    })
  }

  return rows.slice(lastUserIndex)
}

export function resolvePlanImplementationApproval(input: {
  sessionId: string
  messageId: string
  approvalId: string
  approved: boolean
}): { message: UIMessage } {
  assertStoredSession(input.sessionId)
  if (!input.approvalId.startsWith('implement-plan:')) {
    throw new AppError({
      code: 'chat_plan_implementation_approval_invalid',
      status: 400,
      message: 'Plan implementation approval id is invalid',
      details: { approvalId: input.approvalId }
    })
  }

  const row = db()
    .select()
    .from(messages)
    .where(and(eq(messages.id, input.messageId), eq(messages.sessionId, input.sessionId)))
    .get()
  if (!row) {
    throw new AppError({
      code: 'chat_message_not_found',
      status: 404,
      message: 'Chat message was not found',
      details: {
        sessionId: input.sessionId,
        messageId: input.messageId
      }
    })
  }
  if (row.role !== 'assistant') {
    throw new AppError({
      code: 'chat_plan_implementation_approval_invalid',
      status: 400,
      message: 'Plan implementation approval must target an assistant message',
      details: {
        sessionId: input.sessionId,
        messageId: input.messageId,
        role: row.role
      }
    })
  }

  const message = parseStoredMessageSnapshot(row, 'assistant')
  const part = findPlanImplementationApprovalPart(message, input.approvalId)
  if (!part) {
    throw new AppError({
      code: 'chat_plan_implementation_approval_not_found',
      status: 404,
      message: 'Plan implementation approval was not found',
      details: {
        sessionId: input.sessionId,
        messageId: input.messageId,
        approvalId: input.approvalId
      }
    })
  }

  part.state = 'approval-responded'
  part.approval = {
    id: input.approvalId,
    approved: input.approved
  }
  submitRuntimeToolApprovalIfPending({
    sessionId: input.sessionId,
    requestId: input.approvalId,
    approved: input.approved,
    reason: input.approved
      ? 'User approved plan implementation.'
      : 'User denied plan implementation.',
  })
  persistMessageSnapshot({
    sessionId: input.sessionId,
    messageId: input.messageId,
    message,
    messageStatus: row.status as ChatMessageStatus,
    errorText: row.errorText
  })

  return { message }
}

function parseStoredMessageSnapshot(
  row: typeof messages.$inferSelect,
  role: 'user' | 'assistant'
): ChatMessageSnapshotRow['message'] {
  try {
    return parseTrustedStoredMessageSnapshot(row.messageJson) as ChatMessageSnapshotRow['message']
  } catch (error) {
    throw new AppError({
      code: 'chat_message_snapshot_invalid',
      status: 500,
      message: 'Stored chat message snapshot is invalid',
      details: {
        messageId: row.id,
        role,
        reason:
          error instanceof Error
            ? `Invalid UIMessage snapshot: ${error.message}`
            : 'Invalid UIMessage snapshot'
      }
    })
  }
}

function findPlanImplementationApprovalPart(
  message: UIMessage,
  approvalId: string
): MutableApprovalToolPart | null {
  for (const part of message.parts) {
    if (!isToolPartWithApproval(part, approvalId)) {
      continue
    }
    if (part.toolCallId !== approvalId) {
      continue
    }
    if (readToolPartApiName(part) !== 'plan_implementation') {
      continue
    }
    if (!readPlanImplementationContent(part)) {
      continue
    }
    return part
  }
  return null
}

function isToolPartWithApproval(
  part: UIMessage['parts'][number],
  approvalId: string
): part is MutableApprovalToolPart {
  if (!('toolCallId' in part) || typeof part.toolCallId !== 'string') {
    return false
  }
  if (part.type !== 'dynamic-tool' && !part.type.startsWith('tool-')) {
    return false
  }
  const approval = (part as MutableApprovalToolPart).approval
  return typeof approval?.id === 'string' && approval.id === approvalId
}

function readToolPartApiName(part: MutableApprovalToolPart): string | null {
  const inputPayload = readBuiltinToolCallInputPayload(part.input)
  if (inputPayload) {
    return inputPayload.apiName
  }
  if (typeof part.toolName === 'string') {
    return part.toolName
  }
  return part.type.startsWith('tool-') ? part.type.slice('tool-'.length) : null
}

function readPlanImplementationContent(part: MutableApprovalToolPart): string | null {
  const inputPayload = readBuiltinToolCallInputPayload(part.input)
  const args = readObjectRecord(inputPayload?.args ?? part.input)
  const planContent = args.planContent
  return typeof planContent === 'string' && planContent.trim().length > 0 ? planContent : null
}

export async function createRun(input: {
  sessionId: string
  text?: string
  files?: FileUIPart[]
  contextParts?: ChatContextPart[]
  messages?: UIMessage[]
  providerTargetId?: string
  modelId?: string | null
  thinkingEffort?: ChatThinkingEffort
  runtimeSettings?: ChatRuntimeSettingsPatch
  continuationMode?: ChatSessionQueueMode
  queueItemId?: string
  internalContinuation?: 'codexGoal'
}) {
  await finalizeInterruptedPersistedStreamingSessionIfIdle(input.sessionId)
  if (
    runRegistry.hasActiveRunForSession(input.sessionId) ||
    runRegistry.hasPendingRun(input.sessionId)
  ) {
    throw new AppError({
      code: 'chat_run_in_progress',
      status: 409,
      message: 'Chat session already has an active run',
      details: { sessionId: input.sessionId }
    })
  }
  if (input.internalContinuation !== 'codexGoal') {
    cancelPendingCodexGoalContinuation(input.sessionId)
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
      !input.internalContinuation &&
      !requestMessages &&
      !userText.trim() &&
      files.length === 0 &&
      contextParts.length === 0
    ) {
      throw new AppError({
        code: 'chat_message_empty',
        status: 400,
        message: 'Chat message requires text or at least one file attachment',
        details: { sessionId: input.sessionId }
      })
    }
    if (requestMessages && !lastRequestMessage) {
      throw new AppError({
        code: 'chat_message_empty',
        status: 400,
        message: 'Chat message history cannot be empty',
        details: { sessionId: input.sessionId }
      })
    }
    if (
      lastRequestMessage &&
      lastRequestMessage.role !== 'user' &&
      lastRequestMessage.role !== 'assistant'
    ) {
      throw new AppError({
        code: 'chat_message_invalid',
        status: 400,
        message: 'Chat message history must end with a user or assistant message',
        details: {
          sessionId: input.sessionId,
          role: lastRequestMessage.role
        }
      })
    }

    const requestedProviderTargetId = input.providerTargetId
    const context = getSessionRunContext(input.sessionId, {
      providerTargetId: requestedProviderTargetId
    })
    if (!context) {
      throw new AppError({
        code: 'chat_session_not_found',
        status: 404,
        message: 'Chat session not found',
        details: { sessionId: input.sessionId }
      })
    }
    assertRuntimeCompatibleTarget(context, requestedProviderTargetId)
    if (context.profile && !context.profile.enabled) {
      throw new AppError({
        code: 'chat_provider_target_not_available',
        status: 409,
        message: 'Provider target is disabled',
        details: {
          providerTargetId: context.providerTarget?.id ?? null
        }
      })
    }

    const registry = getRuntimeRegistry()
    const runtimeKind = context.session.runtimeKind ?? 'standard'
    const runtime = registry.get(runtimeKind)
    if (!runtime) {
      throw new AppError({
        code: 'chat_runtime_not_available',
        status: 501,
        message: `Runtime is not available: ${runtimeKind}`
      })
    }
    const runtimeRequestMessages = requestMessages

    const sessionRuntimeSettings = readSessionRuntimeSettings(context.session.configJson)
    const runtimeSettings = mergeRuntimeSettings(
      sessionRuntimeSettings,
      normalizeRuntimeSettingsPatch(input.runtimeSettings)
    )
    const requestedModelId =
      input.modelId !== undefined
        ? input.modelId
        : readSessionRequestedModelId({
            session: context.session,
            requestedProviderTargetId
          })
    const requestedThinkingEffort =
      input.thinkingEffort ??
      readSessionRequestedThinkingEffort({
        session: context.session,
        requestedProviderTargetId
      })
    const runtimeResolution = await resolveRuntimeSessionForContext({
      sessionId: input.sessionId,
      context,
      runtimeKind,
      runtime,
      modelId: requestedModelId,
      requestedProviderTargetId
    })
    const runtimeSession = runtimeResolution.runtimeSession

    if (pendingState.cancelled) {
      if (input.queueItemId) {
        await cancelQueuedSessionItem(input.sessionId, input.queueItemId)
      }
      try {
        await runtime.cancelTurn({ runtimeSession, profile: context.profile })
      } catch (error) {
        chatLogger.warn('runtime turn cancellation failed before chat run was created', {
          error,
          sessionId: input.sessionId,
          queueItemId: input.queueItemId
        })
      }
      throw new AppError({
        code: 'chat_run_cancelled',
        status: 409,
        message: 'Chat run was cancelled before it started',
        details: { sessionId: input.sessionId, queueItemId: input.queueItemId }
      })
    }

    attachBinding({
      sessionId: input.sessionId,
      providerTargetId: context.providerTarget?.id ?? null,
      runtimeKind: runtimeSession.runtimeKind,
      runtimeSession,
      requestedModelId: runtimeResolution.requestedModelId
    })

    const draft =
      input.internalContinuation === 'codexGoal'
        ? {
            userMessageId: '',
            assistantMessageId: randomUUID(),
            userMessage: annotateCodexGoalContinuationMessage(
              createUserMessage(randomUUID(), CODEX_GOAL_CONTINUATION_PROMPT)
            )
          }
        : lastRequestMessage?.role === 'assistant'
          ? {
              userMessageId: '',
              assistantMessageId: lastRequestMessage.id,
              userMessage: lastRequestMessage
            }
          : lastRequestMessage?.role === 'user'
            ? await createDraftTurnFromUserMessage({
                sessionId: input.sessionId,
                userMessage: lastRequestMessage,
                continuation: input.continuationMode
                  ? { mode: input.continuationMode, queueItemId: input.queueItemId }
                  : undefined
              })
            : await createDraftTurn({
                sessionId: input.sessionId,
                runtimeKind,
                userText,
                files,
                contextParts,
                continuation: input.continuationMode
                  ? { mode: input.continuationMode, queueItemId: input.queueItemId }
                  : undefined
              })

    const run = await startRun({
      sessionId: input.sessionId,
      messageId: draft.assistantMessageId,
      origin: input.internalContinuation ? 'system' : 'user',
      assistantMessage:
        lastRequestMessage?.role === 'assistant'
          ? lastRequestMessage
          : createAssistantMessage(draft.assistantMessageId),
      assistantMessageProjection: lastRequestMessage?.role === 'assistant' ? 'update' : 'insert',
      queueItemId: input.queueItemId ?? null
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
      pendingDeltaChunk: null,
      pendingDeltaFlushTimer: null,
      snapshotTimer: null,
      finalMessage:
        lastRequestMessage?.role === 'assistant'
          ? lastRequestMessage
          : createAssistantMessage(draft.assistantMessageId),
      finalProjection: createFinalMessageProjectionState(),
      firstTextDeltaSnapshotRecorded: false,
      queueItemId: input.queueItemId,
      runtimeSettings,
      internalContinuation: input.internalContinuation,
      runSnapshotId: null,
      runSnapshotSeq: 0
    }
    runRegistry.setActiveRun(run.id, activeRun)
    startActiveRunSnapshot(activeRun, {
      workspaceId: context.session.workspaceId,
      agentId: context.session.agentId
    })
    startSnapshotTimer(activeRun)
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
          runtimeSettings: activeRun.runtimeSettings
        }
      })
    }
    runRegistry.deletePendingRun(input.sessionId)

    const turnContext = requestMessages
      ? {
          systemPrompt: resolveSessionSystemPrompt(context.session),
          history: requestMessages.slice(0, -1)
        }
      : resolveTurnContext({
          sessionId: input.sessionId,
          draftMessageId: draft.assistantMessageId,
          draftUserMessageId: draft.userMessageId
        })

    void executeRun(activeRun, {
      message: draft.userMessage,
      profile: context.profile,
      modelId: requestedModelId !== undefined ? requestedModelId : runtimeResolution.requestedModelId ?? undefined,
      thinkingEffort: requestedThinkingEffort,
      runtimeSettings,
      systemPrompt: turnContext.systemPrompt,
      transcript: turnContext.transcript,
      history: turnContext.history?.length ? turnContext.history : undefined,
      originalMessages: runtimeRequestMessages,
      workspaceId: context.session.workspaceId,
      workspacePath: context.workspacePath,
      agentId: context.session.agentId
    })

    return {
      runId: run.id,
      assistantMessageId: draft.assistantMessageId,
      userMessageId: draft.userMessageId
    }
  } catch (error) {
    const pending = runRegistry.getPendingRun(input.sessionId)
    runRegistry.deletePendingRun(input.sessionId)
    const cancelledClaimedQueueItem = Boolean(
      input.queueItemId &&
      pending?.cancelled &&
      error instanceof AppError &&
      error.code === 'chat_run_cancelled'
    )
    if (!cancelledClaimedQueueItem) {
      scheduleSessionQueueDrain(input.sessionId, queueDrainDeps)
    }
    throw error
  }
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
  runtimeSettings?: ChatRuntimeSettingsPatch
}): Promise<{
  runId: string
  assistantMessageId: string
  userMessageId: string
  stream: ReadableStream<Uint8Array>
}> {
  const result = await createRun(input)
  return {
    ...result,
    stream: openRunEventStream(result.runId)
  }
}

export async function streamSideConversationResponse(input: {
  sideConversationId: string
  text?: string
  files?: FileUIPart[]
  contextParts?: ChatContextPart[]
  modelId?: string | null
  thinkingEffort?: ChatThinkingEffort
  runtimeSettings?: ChatRuntimeSettingsPatch
}): Promise<{
  runId: string
  assistantMessageId: string
  userMessageId: string
  stream: ReadableStream<Uint8Array>
}> {
  const record = readSideConversation(input.sideConversationId)
  if (!record) {
    throw new AppError({
      code: 'side_chat_expired',
      status: 410,
      message: 'Side conversation is no longer attached to its live provider thread',
      details: { sideConversationId: input.sideConversationId }
    })
  }
  const parentContext = assertProviderBoundRunContext(
    assertRuntimeCompatibleTarget(assertRunnableSession(record.parentSessionId)),
    'Side conversation'
  )
  if (parentContext.providerTarget.id !== record.providerTargetId) {
    throw new AppError({
      code: 'side_chat_provider_target_changed',
      status: 409,
      message: 'Parent session provider target changed after the side conversation was created',
      details: {
        sideConversationId: input.sideConversationId,
        parentSessionId: record.parentSessionId,
        providerTargetId: parentContext.providerTarget.id,
        sideProviderTargetId: record.providerTargetId
      }
    })
  }
  const runtime = getRuntimeRegistry().get(record.runtimeKind)
  if (!runtime) {
    throw new AppError({
      code: 'chat_runtime_not_available',
      status: 501,
      message: `Runtime is not available: ${record.runtimeKind}`
    })
  }

  const userText = input.text ?? ''
  const files = input.files ?? []
  const contextParts = input.contextParts ?? []
  if (!userText.trim() && files.length === 0 && contextParts.length === 0) {
    throw new AppError({
      code: 'chat_message_empty',
      status: 400,
      message: 'Side conversation message requires text, context, or at least one file attachment',
      details: { sideConversationId: input.sideConversationId }
    })
  }

  const runId = randomUUID()
  const assistantMessageId = randomUUID()
  const userMessageId = randomUUID()
  const parentRuntimeSettings = readSessionRuntimeSettings(parentContext.session.configJson)
  const runtimeSettings = mergeRuntimeSettings(
    parentRuntimeSettings,
    normalizeRuntimeSettingsPatch(input.runtimeSettings)
  )
  const message = createUserMessage(userMessageId, userText, files, contextParts)
  const modelId =
    input.modelId ??
    record.requestedModelId ??
    readProviderStateSnapshot(record.runtimeSession.providerStateSnapshot).models.currentModelId ??
    undefined
  return {
    runId,
    assistantMessageId,
    userMessageId,
    stream: createLiveSideConversationStream({
      runId,
      runtime,
      runtimeSession: record.runtimeSession,
      profile: parentContext.profile,
      message,
      responseMessageId: assistantMessageId,
      modelId,
      thinkingEffort: input.thinkingEffort,
      runtimeSettings,
      systemPrompt: resolveSessionSystemPrompt(parentContext.session),
      history: record.history,
      onComplete: (assistantMessage) =>
        appendSideConversationHistory(input.sideConversationId, [message, assistantMessage]),
      workspaceId: parentContext.session.workspaceId,
      workspacePath: parentContext.workspacePath,
      agentId: parentContext.session.agentId
    })
  }
}

export async function streamQuickQuestion(
  input: QuickQuestionInput
): Promise<ReadableStream<Uint8Array>> {
  const context = assertRuntimeCompatibleTarget(assertRunnableSession(input.sessionId))
  const runtimeKind = context.session.runtimeKind ?? 'standard'
  const runtime = getRuntimeRegistry().get(runtimeKind)

  if (!runtime) {
    throw new AppError({
      code: 'chat_runtime_not_available',
      status: 501,
      message: `Runtime is not available: ${runtimeKind}`
    })
  }

  if (!runtime.quickQuestion) {
    throw new AppError({
      code: 'quick_question_not_supported',
      status: 409,
      message: 'This provider does not support quick questions',
      details: { runtimeKind }
    })
  }

  const question = input.question.trim()
  if (!question) {
    throw new AppError({
      code: 'chat_message_empty',
      status: 400,
      message: 'Quick question requires non-empty text'
    })
  }

  const resolved = await resolveRuntimeSessionForContext({
    sessionId: input.sessionId,
    context,
    runtimeKind,
    runtime
  })

  // Read the full session transcript so the provider can reuse prompt cache.
  const transcript = await readFullSessionTranscript(input.sessionId)

  return openDirectChunkStream(
    runtime.quickQuestion({
      runtimeSession: resolved.runtimeSession,
      profile: context.profile,
      question,
      transcript,
      workspaceId: context.session.workspaceId,
      workspacePath: context.workspacePath
    })
  )
}

export async function openSessionRunStream(sessionId: string): Promise<ReadableStream<Uint8Array>> {
  assertStoredSession(sessionId)
  await releaseTerminalPersistedActiveRunForSession(sessionId)

  const runId = runRegistry.getActiveRunIdForSession(sessionId)
  if (!runId) {
    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.close()
      }
    })
  }

  return openRunEventStream(runId)
}

export async function abortRun(runId: string): Promise<void> {
  const active = runRegistry.getActiveRun(runId)
  if (!active) {
    const persistedRun = getRun(runId)
    if (!persistedRun) {
      throw new AppError({
        code: 'chat_run_not_found',
        status: 404,
        message: 'Chat run not found',
        details: { runId }
      })
    }
    await abortProjectedStreamingRun(persistedRun)
    return
  }

  await settleActiveRun(active, 'aborted', null)
  try {
    await requestRuntimeCancel(active)
  } finally {
    releaseActiveRun(active)
  }
}

/**
 * Cancel the active run for a session (if any).
 * POST /chat/sessions/:sessionId/cancel
 */
export async function cancelSession(sessionId: string): Promise<void> {
  if (await releaseTerminalPersistedActiveRunForSession(sessionId)) {
    return
  }
  const runId = runRegistry.getActiveRunIdForSession(sessionId)
  if (!runId) {
    const pendingState = runRegistry.getPendingRun(sessionId)
    if (pendingState) {
      pendingState.cancelled = true
      if (pendingState.queueItemId) {
        await cancelQueuedSessionItem(sessionId, pendingState.queueItemId)
        await normalizeSessionQueuePositions(sessionId)
      }
      return
    }
    const streamingRuns = db()
      .select()
      .from(backendRuns)
      .where(and(eq(backendRuns.chatSessionId, sessionId), eq(backendRuns.status, 'streaming')))
      .all()
    for (const run of streamingRuns) {
      await abortProjectedStreamingRun(run)
    }
    return
  }
  await abortRun(runId)
}

export async function abortAllRuns(): Promise<void> {
  const runIds = runRegistry.listActiveRunIds()
  for (const runId of runIds) {
    const active = runRegistry.getActiveRun(runId)
    if (!active) {
      continue
    }
    try {
      await settleActiveRun(active, 'aborted', null)
      await requestRuntimeCancel(active)
    } catch {
      /* best-effort */
    } finally {
      releaseActiveRun(active)
    }
  }
  runRegistry.clearAll()
}

function openRunEventStream(runId: string): ReadableStream<Uint8Array> {
  const run = getRun(runId)
  if (!run) {
    throw new AppError({
      code: 'chat_run_not_found',
      status: 404,
      message: 'Chat run not found',
      details: { runId }
    })
  }
  const active = runRegistry.getActiveRun(runId)

  return openBufferedChunkStream({
    replayChunks: active?.chunkBuffer ?? [],
    terminal: run.status !== 'streaming' || !active,
    coalesceMaxChars: readPositiveIntegerEnv(
      'CRADLE_CHAT_RUN_DELTA_FLUSH_CHARS',
      DEFAULT_RUN_DELTA_FLUSH_CHARS
    ),
    subscribe: (subscriber: ChunkSubscriber) => runSubscribers.subscribe(runId, subscriber)
  })
}

export function openProviderThreadStream(
  sessionId: string,
  threadId: string
): ReadableStream<Uint8Array> {
  assertStoredSession(sessionId)
  const key = providerThreadStreamKey(sessionId, threadId)
  const state = providerThreadStreamStore.streams.get(key)
  return openBufferedChunkStream({
    replayChunks: state?.chunks ?? [],
    terminal: state?.terminal,
    coalesceMaxChars: readPositiveIntegerEnv(
      'CRADLE_CHAT_RUN_DELTA_FLUSH_CHARS',
      DEFAULT_RUN_DELTA_FLUSH_CHARS
    ),
    subscribe: (subscriber: ChunkSubscriber) =>
      providerThreadStreamStore.subscribers.subscribe(key, subscriber)
  })
}

export function waitForRunCompletion(runId: string): Promise<BackendRun> {
  const run = getRun(runId)
  if (!run) {
    throw new AppError({
      code: 'chat_run_not_found',
      status: 404,
      message: 'Chat run not found',
      details: { runId }
    })
  }
  if (run.status !== 'streaming') {
    return Promise.resolve(run)
  }

  return new Promise((resolve) => {
    const unsubscribe = runSubscribers.subscribe(runId, (_event, terminal) => {
      if (!terminal) {
        return
      }
      resolve(getRun(runId) ?? run)
    })

    const latest = getRun(runId)
    if (latest && latest.status !== 'streaming') {
      unsubscribe()
      resolve(latest)
    }
  })
}

export function listSessionQueueItems(sessionId: string): ChatSessionQueueItemDto[] {
  const session = assertStoredSession(sessionId)
  const runtimeSettings = readSessionRuntimeSettings(session.configJson)
  return db()
    .select()
    .from(chatSessionQueueItems)
    .where(
      and(eq(chatSessionQueueItems.sessionId, sessionId), eq(chatSessionQueueItems.mode, 'queue'))
    )
    .all()
    .sort(compareQueueRows)
    .map((row) => toQueueItemDto(row, runtimeSettings))
}

export async function enqueueSessionQueueItem(
  input: EnqueueSessionQueueItemInput
): Promise<ChatSessionQueueItemDto> {
  await finalizeInterruptedPersistedStreamingSessionIfIdle(input.sessionId)
  const context = getSessionRunContext(input.sessionId, {
    providerTargetId: input.providerTargetId
  })
  if (!context) {
    throw new AppError({
      code: 'chat_session_not_found',
      status: 404,
      message: 'Chat session not found',
      details: { sessionId: input.sessionId }
    })
  }
  assertRuntimeCompatibleTarget(context, input.providerTargetId)

  const text = input.text?.trim() ?? ''
  const files = input.files ?? []
  const contextParts = input.contextParts ?? []
  if (!text && files.length === 0 && contextParts.length === 0) {
    throw new AppError({
      code: 'chat_queue_item_empty',
      status: 400,
      message: 'Chat queue item requires text, context, or at least one file attachment',
      details: { sessionId: input.sessionId }
    })
  }

  const pendingRows = listPendingQueueRows(input.sessionId)
  const position =
    pendingRows.reduce((maxPosition, row) => Math.max(maxPosition, row.position), 0) + 1
  const now = currentUnixSeconds()
  const baseRuntimeSettings = readSessionRuntimeSettings(context.session.configJson)
  const runtimeSettings = mergeRuntimeSettings(
    baseRuntimeSettings,
    normalizeRuntimeSettingsPatch(input.runtimeSettings)
  )
  const row = {
    id: randomUUID(),
    sessionId: input.sessionId,
    mode: 'queue' as const,
    status: 'pending' as const,
    text,
    filesJson: serializeQueueFiles(files),
    contextPartsJson: serializeQueueContextParts(contextParts),
    providerTargetId: input.providerTargetId?.trim() || null,
    modelId: input.modelId?.trim() || null,
    thinkingEffort: readPersistedThinkingEffort(input.thinkingEffort),
    permissionMode: null,
    runtimeAccessMode: runtimeSettings.accessMode,
    runtimeInteractionMode: runtimeSettings.interactionMode,
    position,
    sourceRunId: runRegistry.getActiveRunIdForSession(input.sessionId) ?? null,
    startedRunId: null,
    errorText: null,
    createdAt: now,
    updatedAt: now
  }
  await commitSessionEvents(input.sessionId, [
    {
      type: 'QueueItemEnqueued',
      payload: { item: row }
    }
  ])

  scheduleSessionQueueDrain(input.sessionId, queueDrainDeps)
  return toQueueItemDto(row, runtimeSettings)
}

export async function submitSessionSteerTurn(
  input: SubmitSessionSteerTurnInput
): Promise<SessionSteerTurnDto> {
  const text = input.text?.trim() ?? ''
  const files = input.files ?? []
  const contextParts = input.contextParts ?? []
  if (!text && files.length === 0 && contextParts.length === 0) {
    throw new AppError({
      code: 'chat_steer_empty',
      status: 400,
      message: 'Chat steer requires text, context, or at least one file attachment',
      details: { sessionId: input.sessionId }
    })
  }

  await finalizeInterruptedPersistedStreamingSessionIfIdle(input.sessionId)
  const runId = runRegistry.getActiveRunIdForSession(input.sessionId)
  if (!runId) {
    throw new AppError({
      code: 'chat_steer_no_active_run',
      status: 409,
      message: 'Chat steer requires an active run',
      details: { sessionId: input.sessionId }
    })
  }

  const activeRun = runRegistry.getActiveRun(runId)
  if (
    !activeRun?.runtime.capabilities.supportsSteerTurn ||
    !activeRun.runtime.steerTurn ||
    activeRun.terminalStatus
  ) {
    throw new AppError({
      code: 'chat_steer_not_supported',
      status: 409,
      message: 'Active chat run does not support live steering',
      details: { sessionId: input.sessionId, runId }
    })
  }

  const context = getSessionRunContext(input.sessionId, {
    providerTargetId: input.providerTargetId
  })
  if (!context) {
    throw new AppError({
      code: 'chat_session_not_found',
      status: 404,
      message: 'Chat session not found',
      details: { sessionId: input.sessionId }
    })
  }
  assertRuntimeCompatibleTarget(context, input.providerTargetId)

  const requestedProviderTargetId = input.providerTargetId?.trim() || null
  if (requestedProviderTargetId && requestedProviderTargetId !== activeRun.providerTargetId) {
    throw new AppError({
      code: 'chat_steer_context_mismatch',
      status: 409,
      message: 'Live steer request does not match the active run context',
      details: { sessionId: input.sessionId, runId }
    })
  }

  const sourceMessageId = activeRun.messageId
  const splitParts = structuredClone(activeRun.finalMessage.parts) as UIMessage['parts']
  const steerMessage = annotateContinuationMessage(
    createUserMessage(`steer-${randomUUID()}`, text, files, contextParts),
    { mode: 'steer', sourceMessageId, splitParts }
  )
  try {
    await activeRun.runtime.steerTurn({
      runtimeSession: activeRun.runtimeSession,
      profile: context.profile,
      message: steerMessage
    })
  } catch (error) {
    chatLogger.warn('runtime live steer failed', {
      error,
      sessionId: input.sessionId,
      runId,
      runtimeKind: activeRun.runtimeSession.runtimeKind
    })
    throw new AppError({
      code: 'chat_steer_rejected',
      status: 409,
      message: 'Runtime rejected live steer',
      details: { sessionId: input.sessionId, runId, error: serializeChatError(error).text }
    })
  }

  try {
    await insertCompletedUserMessage({
      sessionId: input.sessionId,
      message: steerMessage,
      parentMessageId: sourceMessageId
    })
  } catch (error) {
    chatLogger.warn('runtime live steer was applied but history persistence failed', {
      error,
      sessionId: input.sessionId,
      runId,
      runtimeKind: activeRun.runtimeSession.runtimeKind
    })
    throw error
  }

  return {
    ok: true,
    sessionId: input.sessionId,
    runId,
    sourceMessageId,
    message: steerMessage
  }
}

export async function cancelSessionQueueItem(
  sessionId: string,
  queueItemId: string
): Promise<ChatSessionQueueItemDto> {
  assertRunnableSession(sessionId)
  const row = db()
    .select()
    .from(chatSessionQueueItems)
    .where(
      and(
        eq(chatSessionQueueItems.id, queueItemId),
        eq(chatSessionQueueItems.sessionId, sessionId),
        eq(chatSessionQueueItems.mode, 'queue')
      )
    )
    .get()
  if (!row) {
    throw new AppError({
      code: 'chat_queue_item_not_found',
      status: 404,
      message: 'Chat queue item not found',
      details: { sessionId, queueItemId }
    })
  }
  if (row.status !== 'pending') {
    throw new AppError({
      code: 'chat_queue_item_not_pending',
      status: 409,
      message: 'Only pending chat queue items can be cancelled',
      details: { sessionId, queueItemId, status: row.status }
    })
  }

  const updated = await cancelQueuedSessionItem(sessionId, queueItemId)
  if (!updated || updated.status !== 'cancelled') {
    const current = db()
      .select()
      .from(chatSessionQueueItems)
      .where(
        and(
          eq(chatSessionQueueItems.id, queueItemId),
          eq(chatSessionQueueItems.sessionId, sessionId),
          eq(chatSessionQueueItems.mode, 'queue')
        )
      )
      .get()
    throw new AppError({
      code: 'chat_queue_item_not_pending',
      status: 409,
      message: 'Only pending chat queue items can be cancelled',
      details: { sessionId, queueItemId, status: current?.status ?? 'missing' }
    })
  }
  await normalizeSessionQueuePositions(sessionId)
  return toQueueItemDto(updated)
}

export async function reorderSessionQueueItems(
  sessionId: string,
  queueItemIds: string[]
): Promise<ChatSessionQueueItemDto[]> {
  assertRunnableSession(sessionId)
  const pendingRows = listPendingQueueRows(sessionId)
  const pendingIds = pendingRows.map((row) => row.id)
  const requestedIds = new Set(queueItemIds)
  const pendingIdSet = new Set(pendingIds)
  const hasSameItems =
    queueItemIds.length === pendingIds.length &&
    queueItemIds.every((id) => pendingIdSet.has(id)) &&
    pendingIds.every((id) => requestedIds.has(id))
  if (!hasSameItems) {
    throw new AppError({
      code: 'chat_queue_reorder_invalid',
      status: 400,
      message: 'Queue reorder must include every pending chat queue item exactly once',
      details: { sessionId, pendingIds, queueItemIds }
    })
  }

  const rowsById = new Map(pendingRows.map((row) => [row.id, row]))
  await recordQueuePositions(
    sessionId,
    queueItemIds
      .map((queueItemId) => rowsById.get(queueItemId))
      .filter((row): row is (typeof pendingRows)[number] => Boolean(row))
  )

  const session = assertStoredSession(sessionId)
  const runtimeSettings = readSessionRuntimeSettings(session.configJson)
  return listPendingQueueRows(sessionId).map((row) => toQueueItemDto(row, runtimeSettings))
}

export async function updateSessionQueueItem(
  input: UpdateSessionQueueItemInput
): Promise<ChatSessionQueueItemDto> {
  assertRunnableSession(input.sessionId)
  const row = db()
    .select()
    .from(chatSessionQueueItems)
    .where(
      and(
        eq(chatSessionQueueItems.id, input.queueItemId),
        eq(chatSessionQueueItems.sessionId, input.sessionId),
        eq(chatSessionQueueItems.mode, 'queue')
      )
    )
    .get()
  if (!row) {
    throw new AppError({
      code: 'chat_queue_item_not_found',
      status: 404,
      message: 'Chat queue item not found',
      details: { sessionId: input.sessionId, queueItemId: input.queueItemId }
    })
  }
  if (row.status !== 'pending') {
    throw new AppError({
      code: 'chat_queue_item_not_pending',
      status: 409,
      message: 'Only pending chat queue items can be edited',
      details: { sessionId: input.sessionId, queueItemId: input.queueItemId, status: row.status }
    })
  }

  const text = input.text?.trim() ?? ''
  const files = input.files ?? []
  const contextParts = input.contextParts ?? []
  if (!text && files.length === 0 && contextParts.length === 0) {
    throw new AppError({
      code: 'chat_queue_item_empty',
      status: 400,
      message: 'Chat queue item requires text, context, or at least one file attachment',
      details: { sessionId: input.sessionId, queueItemId: input.queueItemId }
    })
  }

  const session = assertStoredSession(input.sessionId)
  const baseRuntimeSettings = readSessionRuntimeSettings(session.configJson)
  const runtimeSettings = mergeRuntimeSettings(
    baseRuntimeSettings,
    normalizeRuntimeSettingsPatch(input.runtimeSettings)
  )
  const now = currentUnixSeconds()
  await commitSessionEvents(input.sessionId, [
    {
      type: 'QueueItemUpdated',
      payload: {
        queueItemId: input.queueItemId,
        sessionId: input.sessionId,
        text,
        filesJson: serializeQueueFiles(files),
        contextPartsJson: serializeQueueContextParts(contextParts),
        providerTargetId: input.providerTargetId?.trim() || null,
        modelId: input.modelId?.trim() || null,
        thinkingEffort: readPersistedThinkingEffort(input.thinkingEffort),
        runtimeAccessMode: runtimeSettings.accessMode,
        runtimeInteractionMode: runtimeSettings.interactionMode,
        updatedAt: now
      }
    }
  ])

  const updatedRow = db()
    .select()
    .from(chatSessionQueueItems)
    .where(eq(chatSessionQueueItems.id, input.queueItemId))
    .get()
  return toQueueItemDto(updatedRow ?? row, runtimeSettings)
}

function startActiveRunSnapshot(
  activeRun: ActiveRun,
  input: { workspaceId?: string | null; agentId?: string | null }
): void {
  const snapshot = startRunSnapshot({
    chatSessionId: activeRun.sessionId,
    runId: activeRun.runId,
    messageId: activeRun.messageId,
    providerTargetId: activeRun.providerTargetId,
    runtimeKind: activeRun.runtimeSession.runtimeKind,
    providerSessionId: activeRun.runtimeSession.providerSessionId,
    modelId: activeRun.modelId,
    workspaceId: input.workspaceId,
    agentId: input.agentId,
    summary: {
      providerTargetKind: activeRun.providerTargetKind,
      queueItemId: activeRun.queueItemId ?? null,
      runtimeSettings: activeRun.runtimeSettings,
      internalContinuation: activeRun.internalContinuation ?? null
    }
  })
  activeRun.runSnapshotId = snapshot?.id ?? null
  recordActiveRunSnapshotEvent(activeRun, {
    phase: 'run_started',
    payload: {
      providerTargetKind: activeRun.providerTargetKind,
      providerTargetId: activeRun.providerTargetId,
      modelId: activeRun.modelId,
      queueItemId: activeRun.queueItemId ?? null
    }
  })
}

// ── run execution (private) ──

interface ExecuteRunInput {
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

interface RunStreamPumpResult {
  finalChunk: UIMessageChunk
  failurePayload: SerializedChatError['payload'] | undefined
}

async function executeRun(activeRun: ActiveRun, input: ExecuteRunInput): Promise<void> {
  const diagnostics = createTurnOutputDiagnostics()
  const profile = startChatRuntimeProfile()

  const { finalChunk, failurePayload } = await pumpRuntimeStream(
    activeRun,
    input,
    diagnostics,
    profile
  )
  const { actualModelId, shouldFinalizeDiagnostics } = await persistRunTerminalAndUsage(
    activeRun,
    finalChunk,
    failurePayload,
    diagnostics,
    profile
  )
  completeRun(activeRun, finalChunk, diagnostics, profile, actualModelId, shouldFinalizeDiagnostics)
}

async function pumpRuntimeStream(
  activeRun: ActiveRun,
  input: ExecuteRunInput,
  diagnostics: TurnOutputDiagnostics,
  profile: ChatRuntimeProfile
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
              ...(input.runtimeSettings ? { runtimeSettings: input.runtimeSettings } : {})
            }
          : undefined,
      systemPrompt: input.systemPrompt,
      history: input.history,
      originalMessages: input.originalMessages,
      reportSessionTitle: (title) => {
        void reportRuntimeSessionTitle({ sessionId: activeRun.sessionId, title }).catch((error) => {
          chatLogger.warn('failed to persist runtime session title event', {
            error,
            sessionId: activeRun.sessionId
          })
        })
      },
      onProviderThreadEvent: (event) =>
        publishProviderThreadEvent({
          store: providerThreadStreamStore,
          sessionId: activeRun.sessionId,
          event,
          isTerminalChunk: isTerminalUIMessageChunk
        }),
      onProviderSyntheticTurnEvent
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
          payload: chunk
        })
      }
      accumulateDiagnostics(diagnostics, chunk)
      if (chunk.type === 'text-delta' && !activeRun.firstTextDeltaSnapshotRecorded) {
        activeRun.firstTextDeltaSnapshotRecorded = true
        recordActiveRunSnapshotEvent(activeRun, {
          phase: 'model_text_first_delta',
          chunk
        })
      }
      if (shouldRecordHarnessSnapshotChunk(chunk)) {
        recordActiveRunSnapshotEvent(activeRun, {
          phase: readHarnessSnapshotPhase(chunk),
          chunk
        })
      }
      if (isTerminalUIMessageChunk(chunk)) {
        finalChunk = chunk
        break
      } else {
        if (chunk.type === 'start' && activeRun.startChunkPublished) {
          continue
        }
        if (chunk.type !== 'start') {
          publishRunStartChunk(activeRun)
        }
        publishRuntimeChunk(activeRun, chunk)
      }
    }

    flushPendingRunDelta(activeRun)
    finalChunk = resolveTerminalChunkWithDiagnostics(finalChunk, diagnostics, {
      allowEmptyAssistantOutput: isCodexNoOutputCommandTurn(activeRun, input.message)
    })
    recordActiveRunSnapshotEvent(activeRun, {
      phase: 'stream_finished',
      chunk: finalChunk,
      payload: {
        terminalChunk: summarizeSnapshotChunk(finalChunk, truncateSnapshotPayload),
        diagnostics
      }
    })
    profile.streamFinishedAtMs = performance.now()
  } catch (error) {
    flushPendingRunDelta(activeRun)
    profile.streamFinishedAtMs = performance.now()
    if (isAbortError(error)) {
      finalChunk = { type: 'abort', reason: 'user' }
    } else {
      const serializedError = serializeChatError(error)
      failurePayload = serializedError.payload
      finalChunk = { type: 'error', errorText: serializedError.text }
    }
    recordActiveRunSnapshotEvent(activeRun, {
      phase: 'stream_failed',
      chunk: finalChunk,
      payload: {
        terminalChunk: summarizeSnapshotChunk(finalChunk, truncateSnapshotPayload),
        diagnostics,
        ...(failurePayload ? { payload: failurePayload } : {})
      }
    })
  }

  return { finalChunk, failurePayload }
}

async function persistRunTerminalAndUsage(
  activeRun: ActiveRun,
  finalChunk: UIMessageChunk,
  failurePayload: SerializedChatError['payload'] | undefined,
  diagnostics: TurnOutputDiagnostics,
  profile: ChatRuntimeProfile
): Promise<{ actualModelId: string | null; shouldFinalizeDiagnostics: boolean }> {
  let actualModelId = activeRun.modelId
  try {
    if (!activeRun.cancelRequested) {
      const finalized = await publishTerminalChunk(activeRun, finalChunk, profile)
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
                  runId: null
                })
              : undefined,
          attrs: {
            providerTargetId: activeRun.providerTargetId,
            runtimeKind: activeRun.runtimeSession.runtimeKind,
            providerSessionId: activeRun.runtimeSession.providerSessionId,
            diagnostics,
            ...(failurePayload ? { payload: failurePayload } : {})
          }
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
          usage
        })
        recordActiveRunSnapshotEvent(activeRun, {
          phase: 'usage',
          modelId: actualModelId,
          usage,
          estimatedCostUsd: estimateRunUsageCost(actualModelId, usage),
          payload: {
            source: activeRun.runtime?.totalUsage ? 'runtime.totalUsage' : 'runtime.lastUsage'
          }
        })
      }

      // Write per-step usage if the runtime supports it
      const runtimeWithSteps = activeRun.runtime as {
        lastStepUsages?: RuntimeStepUsageInput[]
      }
      const steps = runtimeWithSteps.lastStepUsages ?? []
      if (steps.length > 0) {
        const fallbackModelId = actualModelId ?? 'gpt-4o'
        const recordedSteps = insertRuntimeStepUsages({
          runId: activeRun.runId,
          sessionId: activeRun.sessionId,
          fallbackModelId,
          steps
        })
        for (const step of recordedSteps) {
          recordActiveRunSnapshotEvent(activeRun, {
            phase: 'step_usage',
            modelId: step.modelId,
            usage: step.usage,
            estimatedCostUsd: step.estimatedCostUsd,
            payload: {
              stepNumber: step.stepNumber,
              stepType: step.stepType
            }
          })
        }
      }
    }
  } catch (error) {
    chatLogger.error('failed to persist run finalization (session may have been deleted)', {
      error
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
  shouldFinalizeDiagnostics: boolean
): void {
  // Persist updated providerSessionId/state obtained during the run
  try {
    attachBinding({
      sessionId: activeRun.sessionId,
      providerTargetId: activeRun.providerTargetId,
      runtimeKind: activeRun.runtimeSession.runtimeKind,
      runtimeSession: activeRun.runtimeSession,
      requestedModelId: actualModelId
    })
  } catch {
    // session may have been deleted during the run
  }
  updateCodexGoalContinuationBackoff(
    {
      sessionId: activeRun.sessionId,
      runtimeKind: activeRun.runtimeSession.runtimeKind,
      cancelRequested: activeRun.cancelRequested === true,
      internalContinuation: activeRun.internalContinuation
    },
    finalChunk
  )
  const binding = readDurableProviderRuntimeBinding(activeRun.sessionId)
  const shouldContinueCodexGoal = shouldScheduleCodexGoalContinuation({
    run: {
      sessionId: activeRun.sessionId,
      runtimeKind: activeRun.runtimeSession.runtimeKind,
      cancelRequested: activeRun.cancelRequested === true,
      internalContinuation: activeRun.internalContinuation
    },
    finalChunk,
    binding,
    providerTargetAvailable: Boolean(
      binding && isProviderTargetAvailable(binding.providerTargetId)
    ),
    pendingQueueItemCount: listPendingQueueRows(activeRun.sessionId).length,
    continueBlockedGoals: shouldContinueBlockedCodexGoals()
  })
  if (shouldFinalizeDiagnostics) {
    finalizeActiveRunSnapshot(activeRun, finalChunk, {
      modelId: actualModelId,
      diagnostics,
      profile
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
      finalPartCount: activeRun.finalMessage.parts.length
    },
    diagnostics,
    profile
  })
  releaseActiveRun(activeRun)
  scheduleSessionQueueDrain(activeRun.sessionId, queueDrainDeps)
  if (shouldContinueCodexGoal) {
    if (!activeRun.providerTargetId) {
      return
    }
    scheduleCodexGoalContinuation(
      {
        sessionId: activeRun.sessionId,
        providerTargetId: activeRun.providerTargetId,
        modelId: actualModelId ?? undefined,
        continueBlockedGoals: shouldContinueBlockedCodexGoals()
      },
      codexGoalContinuationDeps
    )
  }
}

function snapshotActiveRun(activeRun: ActiveRun): void {
  if (activeRun.terminalStatus) {
    return
  }
  flushFinalMessageProjection(activeRun)
  persistStreamingMessageSnapshot(activeRun)
}

// Fenced streaming message writer. The only path that writes `messages` with
// `status = 'streaming'`. It checks the persisted run row first: once a terminal
// fact exists the run row is terminal, the fence returns non-streaming, and this
// releases the stale active run instead of overwriting a terminal message.
// `persistMessageSnapshot()` stays fence-free with no run id; it serves only the
// event-derived terminal projection and non-streaming record mutations.
function persistStreamingMessageSnapshot(activeRun: ActiveRun): void {
  const fence = readRunWriteFence(activeRun.runId)
  if (fence.status === 'streaming') {
    const message = compactStoredMessageSnapshot(normalizeMessageSnapshot(activeRun.finalMessage))
    const messageJson = JSON.stringify(message)
    db().transaction((tx) => {
      tx.update(messages)
        .set({
          content: extractMessageText(message),
          messageJson,
          status: 'streaming',
          errorText: null,
          updatedAt: currentUnixSeconds()
        })
        .where(and(eq(messages.id, activeRun.messageId), eq(messages.sessionId, activeRun.sessionId)))
        .run()

      tx.update(sessions).set({ updatedAt: currentUnixSeconds() }).where(eq(sessions.id, activeRun.sessionId)).run()
    })
    return
  }

  // Run is already terminal (or gone): a stale active run continued after
  // recovery. Stop writing and release it. The persisted terminal fact wins.
  releaseStaleActiveRun(activeRun, fence)
}

function startSnapshotTimer(activeRun: ActiveRun): void {
  stopSnapshotTimer(activeRun)
  activeRun.snapshotTimer = setInterval(
    snapshotActiveRun,
    readPositiveIntegerEnv('CRADLE_CHAT_SNAPSHOT_INTERVAL_MS', DEFAULT_SNAPSHOT_INTERVAL_MS),
    activeRun
  )
}

function stopSnapshotTimer(activeRun: ActiveRun): void {
  if (activeRun.snapshotTimer) {
    clearInterval(activeRun.snapshotTimer)
    activeRun.snapshotTimer = null
  }
}

function stopPendingRunDeltaFlush(activeRun: ActiveRun): void {
  if (activeRun.pendingDeltaFlushTimer) {
    clearTimeout(activeRun.pendingDeltaFlushTimer)
    activeRun.pendingDeltaFlushTimer = null
  }
}

export function flushAllActiveRunSnapshots(): void {
  for (const activeRun of runRegistry.listActiveRuns()) {
    try {
      snapshotActiveRun(activeRun)
    } catch {
      // best-effort on shutdown
    }
  }
}

export async function recoverPersistedRunProjections(): Promise<ChatRuntimeRecoveryResult> {
  const recovered = await recoverChatRuntimeProjections()
  const recoveredCount =
    recovered.interruptedRunsFinalized +
    recovered.terminalFactsProjected +
    recovered.terminalProjectionDriftsRepaired

  if (recoveredCount > 0) {
    chatLogger.warn('recovered persisted run projections', { recovered })
  }

  return recovered
}

function recordActiveRunSnapshotEvent(
  activeRun: ActiveRun,
  input: {
    phase: string
    chunk?: UIMessageChunk
    modelId?: string | null
    usage?: TokenUsage
    estimatedCostUsd?: number | null
    durationMs?: number | null
    payload?: Record<string, unknown>
  }
): void {
  appendActiveRunSnapshotEvent(activeRun, {
    ...input,
    truncatePayload: truncateSnapshotPayload
  })
}

function finalizeActiveRunSnapshot(
  activeRun: ActiveRun,
  finalChunk: UIMessageChunk,
  input: {
    modelId: string | null
    diagnostics: TurnOutputDiagnostics
    profile: ChatRuntimeProfile
  }
): void {
  finalizeRunSnapshotEvent(activeRun, finalChunk, {
    ...input,
    diagnostics: input.diagnostics as unknown as Record<string, unknown>,
    replayBuffer: getActiveRunReplayBufferSummary(activeRun.runId) as unknown as Record<
      string,
      unknown
    >,
    truncatePayload: truncateSnapshotPayload
  })
}

function publishRuntimeChunk(activeRun: ActiveRun, chunk: UIMessageChunk): void {
  const pending = activeRun.pendingDeltaChunk
  if (!pending) {
    if (readRunDeltaCoalesceKey(chunk)) {
      activeRun.pendingDeltaChunk = chunk
      schedulePendingRunDeltaFlush(activeRun)
      return
    }
    publishUIMessageChunk(activeRun, chunk, false)
    return
  }

  const merged = mergeRuntimeDeltaChunk(pending, chunk)
  if (merged) {
    activeRun.pendingDeltaChunk = merged
    if (
      readDeltaChunkTextLength(merged) >=
      readPositiveIntegerEnv('CRADLE_CHAT_RUN_DELTA_FLUSH_CHARS', DEFAULT_RUN_DELTA_FLUSH_CHARS)
    ) {
      flushPendingRunDelta(activeRun)
      return
    }
    schedulePendingRunDeltaFlush(activeRun)
    return
  }

  flushPendingRunDelta(activeRun)
  if (readRunDeltaCoalesceKey(chunk)) {
    activeRun.pendingDeltaChunk = chunk
    schedulePendingRunDeltaFlush(activeRun)
    return
  }
  publishUIMessageChunk(activeRun, chunk, false)
}

function schedulePendingRunDeltaFlush(activeRun: ActiveRun): void {
  if (activeRun.pendingDeltaFlushTimer) {
    return
  }
  activeRun.pendingDeltaFlushTimer = setTimeout(
    () => {
      activeRun.pendingDeltaFlushTimer = null
      flushPendingRunDelta(activeRun)
    },
    readPositiveIntegerEnv('CRADLE_CHAT_RUN_DELTA_FLUSH_MS', DEFAULT_RUN_DELTA_FLUSH_MS)
  )
}

function flushPendingRunDelta(activeRun: ActiveRun): void {
  if (activeRun.pendingDeltaFlushTimer) {
    clearTimeout(activeRun.pendingDeltaFlushTimer)
    activeRun.pendingDeltaFlushTimer = null
  }
  const chunk = activeRun.pendingDeltaChunk
  activeRun.pendingDeltaChunk = null
  if (chunk && !activeRun.terminalStatus) {
    const fence = readRunWriteFence(activeRun.runId)
    if (fence.status !== 'streaming') {
      releaseStaleActiveRun(activeRun, fence)
      return
    }
    publishUIMessageChunk(activeRun, chunk, false)
  }
}

function publishUIMessageChunk(
  activeRun: ActiveRun,
  chunk: UIMessageChunk,
  terminal: boolean
): void {
  if (chunk.type === 'start') {
    activeRun.startChunkPublished = true
  }

  if (isChatStreamTraceEnabled()) {
    recordChatStreamTrace({
      chatSessionId: activeRun.sessionId,
      runId: activeRun.runId,
      messageId: activeRun.messageId,
      runtimeKind: activeRun.runtimeSession.runtimeKind,
      providerSessionId: activeRun.runtimeSession.providerSessionId,
      toolCallId: readChunkTraceToolCallId(chunk),
      phase: 'sse_emit',
      payload: {
        chunk,
        terminal,
        subscriberCount: runSubscribers.size(activeRun.runId)
      }
    })
  }

  if (!terminal) {
    projectFinalMessageChunk(activeRun, chunk)
  }
  bufferReplayChunk(activeRun, chunk)

  runSubscribers.publish(activeRun.runId, chunk, terminal)
}

function bufferReplayChunk(activeRun: ActiveRun, chunk: UIMessageChunk): void {
  const coalesced = coalesceReplayChunk(activeRun, chunk)
  if (coalesced) {
    return
  }

  activeRun.chunkBuffer.push(chunk)
}

function coalesceReplayChunk(activeRun: ActiveRun, chunk: UIMessageChunk): boolean {
  const key = readReplayCoalesceKey(chunk)
  if (!key) {
    return false
  }

  const existingIndex = activeRun.chunkBufferIndexByKey.get(key)
  if (existingIndex === undefined) {
    activeRun.chunkBufferIndexByKey.set(key, activeRun.chunkBuffer.length)
    return false
  }

  const existing = activeRun.chunkBuffer[existingIndex]
  const merged = mergeBufferedStreamChunk(
    existing,
    chunk,
    readPositiveIntegerEnv('CRADLE_CHAT_RUN_DELTA_FLUSH_CHARS', DEFAULT_RUN_DELTA_FLUSH_CHARS)
  )
  if (!merged) {
    activeRun.chunkBufferIndexByKey.set(key, activeRun.chunkBuffer.length)
    return false
  }
  activeRun.chunkBuffer[existingIndex] = merged
  return true
}

function publishRunStartChunk(activeRun: ActiveRun): void {
  if (activeRun.startChunkPublished) {
    return
  }
  flushPendingRunDelta(activeRun)
  publishUIMessageChunk(activeRun, { type: 'start', messageId: activeRun.messageId }, false)
}

async function publishTerminalChunk(
  activeRun: ActiveRun,
  chunk: UIMessageChunk,
  profile?: ChatRuntimeProfile
): Promise<boolean> {
  publishRunStartChunk(activeRun)
  flushPendingRunDelta(activeRun)
  const status = readTerminalStatus(chunk)
  const errorText = chunk.type === 'error' ? chunk.errorText : null
  const finalized = await finalizeActiveRun(activeRun, status, errorText, chunk, profile)
  if (!finalized) {
    return false
  }
  publishUIMessageChunk(activeRun, chunk, true)
  return true
}

async function finalizeActiveRun(
  activeRun: ActiveRun,
  status: ChatMessageStatus,
  errorText: string | null,
  terminalChunk: UIMessageChunk,
  profile?: ChatRuntimeProfile
): Promise<boolean> {
  if (status === 'streaming' || activeRun.terminalStatus) {
    return false
  }

  const fence = readRunWriteFence(activeRun.runId)
  if (fence.status !== 'streaming') {
    publishUIMessageChunk(activeRun, terminalChunkForFence(fence), true)
    if (fence.status !== 'missing') {
      activeRun.terminalStatus = fence.status
    }
    return false
  }

  activeRun.terminalStatus = status
  if (profile) {
    profile.finalizeStartedAtMs = performance.now()
  }
  projectFinalMessageChunk(activeRun, terminalChunk)
  flushFinalMessageProjection(activeRun)
  await flushProjectedToolInputs(activeRun)

  const bindingId = recordTerminalRunBindingId(activeRun)
  const snapshotResult = await persistTerminalMessageSnapshot(
    activeRun,
    status,
    errorText,
    bindingId
  )
  if (profile) {
    profile.finalMessageJsonBytes = snapshotResult?.messageJsonBytes ?? null
  }
  if (profile) {
    profile.finalizeFinishedAtMs = performance.now()
    profile.memoryFinished = profile.enabled ? process.memoryUsage() : null
  }
  if (isChatStreamTraceEnabled()) {
    recordChatStreamTrace({
      chatSessionId: activeRun.sessionId,
      runId: activeRun.runId,
      messageId: activeRun.messageId,
      runtimeKind: activeRun.runtimeSession.runtimeKind,
      providerSessionId: activeRun.runtimeSession.providerSessionId,
      phase:
        status === 'complete'
          ? 'run_completed'
          : status === 'aborted'
            ? 'run_aborted'
            : 'run_failed',
      payload: {
        status,
        errorText,
        message: activeRun.finalMessage
      }
    })
  }
  return true
}

function releaseStaleActiveRun(activeRun: ActiveRun, fence: RunWriteFence): void {
  if (fence.status !== 'streaming' && fence.status !== 'missing') {
    activeRun.terminalStatus ??= fence.status
  }
  publishUIMessageChunk(activeRun, terminalChunkForFence(fence), true)
  releaseActiveRun(activeRun)
}

function terminalChunkForFence(fence: RunWriteFence): UIMessageChunk {
  switch (fence.status) {
    case 'streaming':
    case 'complete':
      return { type: 'finish', finishReason: 'stop' }
    case 'aborted':
      return { type: 'abort', reason: 'user' }
    case 'failed':
      return { type: 'error', errorText: fence.errorText ?? 'Chat run failed' }
    case 'missing':
      return { type: 'error', errorText: 'Chat run is no longer available' }
  }
}

async function persistTerminalMessageSnapshot(
  activeRun: ActiveRun,
  status: TerminalChatMessageStatus,
  errorText: string | null,
  bindingId?: string | null
): Promise<{ messageJsonBytes: number } | null> {
  try {
    const now = currentUnixSeconds()
    const message = compactStoredMessageSnapshot(normalizeMessageSnapshot(activeRun.finalMessage))
    const messageJson = JSON.stringify(message)
    await commitSessionEvents(activeRun.sessionId, [
      {
        type: 'AssistantMessageCompleted',
        payload: {
          message: {
            id: activeRun.messageId,
            sessionId: activeRun.sessionId,
            content: extractMessageText(message),
            messageJson,
            status,
            errorText,
            updatedAt: now
          }
        }
      },
      {
        type: readRunTerminalEventType(status),
        payload: {
          runId: activeRun.runId,
          sessionId: activeRun.sessionId,
          queueItemId: activeRun.queueItemId ?? null,
          ...(bindingId !== undefined ? { bindingId } : {}),
          status,
          stopReason: readRunStopReason(status),
          errorText,
          finishedAt: now
        }
      }
    ])
    return { messageJsonBytes: Buffer.byteLength(messageJson) }
  } catch (error) {
    chatLogger.error('failed to persist final message snapshot', {
      error,
      sessionId: activeRun.sessionId,
      runId: activeRun.runId,
      messageId: activeRun.messageId,
      status
    })
    return null
  }
}

async function settleActiveRun(
  activeRun: ActiveRun,
  status: TerminalChatMessageStatus,
  errorText: string | null
): Promise<void> {
  if (activeRun.terminalStatus) {
    return
  }
  if (status === 'aborted') {
    activeRun.cancelRequested = true
  }
  const terminalChunk: UIMessageChunk =
    status === 'complete'
      ? { type: 'finish', finishReason: 'stop' }
      : status === 'aborted'
        ? { type: 'abort', reason: 'user' }
        : { type: 'error', errorText: errorText ?? 'Chat run failed' }
  await publishTerminalChunk(activeRun, terminalChunk)
}

async function requestRuntimeCancel(activeRun: ActiveRun): Promise<void> {
  const context = getSessionRunContext(activeRun.sessionId)
  if (!context) {
    chatLogger.warn('cannot cancel runtime turn because chat session context is missing', {
      sessionId: activeRun.sessionId,
      runId: activeRun.runId
    })
    return
  }

  try {
    await activeRun.runtime.cancelTurn({
      runtimeSession: activeRun.runtimeSession,
      profile: context.profile
    })
  } catch (error) {
    chatLogger.warn('runtime turn cancellation failed after chat run was marked aborted', {
      error,
      sessionId: activeRun.sessionId,
      runId: activeRun.runId
    })
  } finally {
    try {
      attachBinding({
        sessionId: activeRun.sessionId,
        providerTargetId: activeRun.providerTargetId,
        runtimeKind: activeRun.runtimeSession.runtimeKind,
        runtimeSession: activeRun.runtimeSession,
        requestedModelId: activeRun.modelId
      })
    } catch (error) {
      chatLogger.warn('failed to persist runtime session after cancellation', {
        error,
        sessionId: activeRun.sessionId,
        runId: activeRun.runId
      })
    }
  }
}

function recordTerminalRunBindingId(activeRun: ActiveRun): string | undefined {
  try {
    return attachBinding({
      sessionId: activeRun.sessionId,
      providerTargetId: activeRun.providerTargetId,
      runtimeKind: activeRun.runtimeSession.runtimeKind,
      runtimeSession: activeRun.runtimeSession,
      requestedModelId: activeRun.modelId
    })?.id
  } catch {
    return undefined
  }
}

async function releaseTerminalPersistedActiveRunForSession(sessionId: string): Promise<boolean> {
  const runId = runRegistry.getActiveRunIdForSession(sessionId)
  if (!runId) {
    return false
  }

  const run = getRun(runId)
  if (!run) {
    return false
  }
  if (run.status === 'streaming') {
    return false
  }

  const activeRun = runRegistry.getActiveRun(runId)
  if (activeRun) {
    activeRun.terminalStatus ??= run.status
    releaseActiveRun(activeRun)
  } else {
    runRegistry.deleteActiveRunIdForSession(sessionId)
  }
  return true
}

async function finalizeInterruptedPersistedStreamingSessionIfIdle(
  sessionId: string
): Promise<void> {
  await releaseTerminalPersistedActiveRunForSession(sessionId)
  if (!runRegistry.hasActiveRunForSession(sessionId) && !runRegistry.hasPendingRun(sessionId)) {
    await recoverChatRuntimeSession(sessionId)
  }
}

function releaseActiveRun(activeRun: ActiveRun): void {
  stopSnapshotTimer(activeRun)
  stopPendingRunDeltaFlush(activeRun)
  rejectPendingUserInputsForRun(
    activeRun.runId,
    new Error('Chat run ended before pending user input was submitted')
  )
  rejectPendingToolApprovalsForRun(
    activeRun.runId,
    new Error('Chat run ended before pending tool approval was submitted')
  )
  runRegistry.deleteActiveRun(activeRun.runId)
  runSubscribers.delete(activeRun.runId)
  if (runRegistry.getActiveRunIdForSession(activeRun.sessionId) === activeRun.runId) {
    runRegistry.deleteActiveRunIdForSession(activeRun.sessionId)
  }
  activeRun.pendingDeltaChunk = null
  activeRun.chunkBuffer = []
  activeRun.chunkBufferIndexByKey.clear()
  activeRun.finalMessage.parts = []
  activeRun.finalProjection.activeTextParts.clear()
  activeRun.finalProjection.activeReasoningParts.clear()
  activeRun.finalProjection.partialToolCalls.clear()
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'))
  )
}

function isCodexNoOutputCommandTurn(activeRun: ActiveRun, message: UIMessage): boolean {
  if (activeRun.runtimeSession.runtimeKind !== 'codex') {
    return false
  }
  if (activeRun.internalContinuation === 'codexGoal' || isCodexGoalContinuationMessage(message)) {
    return true
  }
  const text = extractMessageText(message)
  return (
    readGoalMessageObjective(message) !== null ||
    isCodexGoalCommandText(text) ||
    isCodexCompactCommandText(text)
  )
}
