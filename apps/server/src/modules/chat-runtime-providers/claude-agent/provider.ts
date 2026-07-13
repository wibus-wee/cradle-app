import { randomUUID } from 'node:crypto'

import type { AccountInfo, Options, Query, SDKAuthStatusMessage, SDKMessage, SDKRateLimitEvent, SessionMessage } from '@anthropic-ai/claude-agent-sdk'
import { getSessionInfo, getSubagentMessages, listSubagents, query, renameSession } from '@anthropic-ai/claude-agent-sdk'
import type { LangfuseGeneration } from '@langfuse/tracing'
import { startObservation } from '@langfuse/tracing'
import type { UIMessage, UIMessageChunk } from 'ai'

import { readObjectRecord as readRecord } from '../../../helpers/json-record'
import { aiTelemetryEnabled } from '../../../telemetry/config'
import { liveRuntimeSessionRegistry } from '../../chat-runtime/runtime-live-session-registry'
import type {
  CancelTurnInput,
  ChatRuntime,
  GenerateSessionTitleInput,
  GetCapabilitiesInput,
  GetContextUsageInput,
  GetUiSlotStatesInput,
  ProviderContext,
  ProviderSyntheticTurnEvent,
  ProviderThread,
  ProviderThreadEvent,
  ProviderThreadListInput,
  ProviderThreadListResult,
  ProviderThreadReadInput,
  ProviderThreadReadResult,
  ProviderThreadTurn,
  ProviderThreadTurnsInput,
  ProviderThreadTurnsResult,
  QuickQuestionInput,
  ResumeChatSessionInput,
  RuntimeCompactUiSlotState,
  RuntimeContextUsage,
  RuntimePresentationCapabilities,
  RuntimeProviderTargetProfile,
  RuntimeSession,
  RuntimeUiSlotState,
  StartChatSessionInput,
  StreamTurnInput,
  UpdateRuntimeSettingsInput,
} from '../../chat-runtime/runtime-provider-types'
import {
  ProviderErrors,
  ProviderRuntimeError,
  requireRuntimeProviderTargetProfile,
} from '../../chat-runtime/runtime-provider-types'
import {
  getDefaultRuntimeSettings,
  mergeRuntimeSettings,
} from '../../chat-runtime/runtime-settings'
import { isChatStreamTraceEnabled, recordChatStreamTrace } from '../../chat-runtime/stream-trace'
import type { TokenUsage } from '../../chat-runtime-engine/ai-sdk-engine'
import { readTrustedClaudeAgentConfig } from '../../provider-contracts/provider-base'
import { AsyncEventQueue } from '../async-event-queue'
import { createBoundedTextCollector } from '../bounded-text-collector'
import { providerChunk } from '../kit/chunk-mapper'
import { readWorkspaceProviderStateSnapshot } from '../kit/state-snapshot'
import { ClaudeAgentInputStream, emptyClaudeAgentInput } from './async-input-stream'
import { projectClaudeAgentCompactState, projectClaudeAgentContextUsage } from './context-usage-projector'
import type { ClaudeAgentCapturedCrewCall, ClaudeAgentChunkMapperState, ClaudeCrewLink } from './event-to-chunk-mapper'
import { createClaudeAgentChunkMapperState, mapClaudeAgentMessageToChunks, mapClaudeAgentMessageToChunksWithoutParentProjection, resetClaudeAgentChunkMapperForTurn } from './event-to-chunk-mapper'
import type { ClaudeStderrSink } from './input-projector'
import {
  buildClaudeAgentTurnContent,
  buildClaudeQueryOptions,
  CLAUDE_AGENT_SDK_PERSIST_SESSION,
  createClaudeStderrSink,
  describeClaudeAgentUserContent,
  projectClaudeAgentInput,
  readClaudeAgentModelId,
  shouldPersistClaudeAgentSdkSession,
} from './input-projector'
import {
  CLAUDE_AGENT_RUNTIME_CAPABILITIES,
  CLAUDE_AGENT_RUNTIME_KIND,
  CLAUDE_AGENT_RUNTIME_METADATA,
  projectClaudeAgentPresentation,
} from './metadata'
import type { ClaudeAgentPermissionBridgeState, ClaudeAgentToolApprovalRequest } from './permission-bridge'
import {
  createClaudeAgentPermissionBridgeState,
  updateClaudeAgentPermissionBridgeState,
} from './permission-bridge'
import { generateClaudeSessionTitle, shouldGenerateClaudeSessionTitle } from './provider-title-generation'
import { activateClaudeAgentSdkConfigDir, resolveClaudeAgentRuntimeContext } from './runtime-context'
import {
  readClaudeAgentPermissionMode,
} from './runtime-settings'
import {
  CLAUDE_AGENT_RUNTIME_DEFAULT_MODEL_SWITCH_ID,
  clearClaudeAgentCapturedPlan,
  clearClaudeAgentPendingModelSwitch,
  projectClaudeAgentCrewUiSlotState,
  projectClaudeAgentPlanUiSlotState,
  projectClaudeAgentProgressUiSlotState,
  projectClaudeAgentToolActivityUiSlotState,
  projectClaudeAgentUsageUiSlotState,
  readClaudeAgentCrewProviderThreadIdForAgent,
  readClaudeAgentPendingModelSwitchId,
  resolveClaudeAgentPendingModelSwitchId,
  writeClaudeAgentAccountSnapshot,
  writeClaudeAgentAuthStatusSnapshot,
  writeClaudeAgentCapturedPlan,
  writeClaudeAgentCrewCall,
  writeClaudeAgentPendingModelSwitch,
  writeClaudeAgentProgress,
  writeClaudeAgentRateLimitSnapshot,
  writeClaudeAgentTaskActivity,
} from './state-projector'
import { ClaudeCodeToolName } from './tools/identity'
import { createClaudeCodeToolInputPayload, createClaudeCodeToolResultPayload } from './tools/mapper'
import type { ClaudeAgentProviderDeps, ClaudeAgentSessionInfo, ClaudeTitleGenerationThinkingEffort } from './types'

type ActiveClaudeNativeFollowUp = {
  queueItemId: string
  messageUuid: string
  userContent: ReturnType<typeof projectClaudeAgentInput>
}

type ActiveClaudeQuery = {
  query: Query
  abortController: AbortController
  inputStream: ClaudeAgentInputStream
  mapperState: ClaudeAgentChunkMapperState
  /**
   * Shared across the main session's mapper state and every per-subagent provider-thread /
   * synthetic-turn mapper state forked for this session (see `createClaudeAgentChunkMapperState`
   * call sites below). Task lifecycle events for one subagent are split across these states, so
   * the crew link `resolveClaudeTaskCrewLink` registers must be visible from all of them.
   */
  taskLaunchesById: Map<string, ClaudeCrewLink>
  permissionBridgeState: ClaudeAgentPermissionBridgeState
  runtimeSession: RuntimeSession
  providerTargetId: string
  releaseLiveRuntimeSession: () => void
  currentTurn: ActiveClaudeTurn | null
  syntheticTurn: ActiveClaudeSyntheticTurn | null
  providerThreadTurns: Map<string, ActiveClaudeProviderThreadTurn>
  completedProviderThreadParentOutputIds: Set<string>
  onProviderSyntheticTurnEvent: StreamTurnInput['onProviderSyntheticTurnEvent'] | null
  /** Follow-ups already pushed into the SDK input stream, waiting for a Cradle run to adopt. */
  nativeFollowUps: Map<string, ActiveClaudeNativeFollowUp>
  /** SDK messages received after a turn `result` while a native follow-up is waiting to be adopted. */
  preAdoptBuffer: SDKMessage[]
  closed: boolean
  pumpRunning: boolean
  stderrSink: ClaudeStderrSink
  allowDangerouslySkipPermissions: boolean
}

type ActiveClaudeTurn = {
  input: StreamTurnInput
  queue: AsyncEventQueue<UIMessageChunk>
  traceMessageId: string
  shouldPersistSession: boolean
  effectiveModel: string | undefined
  userPromptText: string
  shouldGenerateTitle: boolean
  outputTextCollector: ReturnType<typeof createBoundedTextCollector>
  endGeneration: (error?: unknown) => void
}

type ActiveClaudeSyntheticTurn = {
  providerTurnId: string
  providerThreadId: string | null
  mapperState: ClaudeAgentChunkMapperState
  onProviderSyntheticTurnEvent: NonNullable<StreamTurnInput['onProviderSyntheticTurnEvent']>
}

type ActiveClaudeProviderThreadTurn = {
  providerThreadId: string
  providerTurnId: string
  mapperState: ClaudeAgentChunkMapperState
  terminal: boolean
}

type ContextUsageRuntimeInput = Pick<GetContextUsageInput, 'runtimeSession'>

const COMPACT_SLOT_CONTEXT_USAGE_TTL_MS = 15_000
const DEFAULT_PROVIDER_THREAD_LIMIT = 50
const CLAUDE_SUBAGENT_SOURCE_KIND = 'subAgent'

type ClaudeTranscriptContentBlock = {
  type: string
  text?: string
  thinking?: string
  content?: unknown
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  is_error?: boolean
}

type ClaudeTranscriptMessagePayload = {
  role?: string
  content?: string | ClaudeTranscriptContentBlock[]
  model?: string
}

type ClaudeSubagentSessionMessage = SessionMessage & {
  timestamp?: string
  subagent_type?: string
  task_description?: string
  tool_use_result?: unknown
  message: ClaudeTranscriptMessagePayload | string
}

type ClaudeSubagentProjectedToolPart = UIMessage['parts'][number] & {
  toolCallId: string
  state?: string
  input?: unknown
  output?: unknown
  errorText?: string
}

interface ClaudeSubagentThreadRecord {
  agentId: string
  parentSessionId: string
  cwd: string
  messages: ClaudeSubagentSessionMessage[]
}

interface ClaudeSubagentProjectedEntry {
  providerThreadId: string
  agentId: string
  turn: ProviderThreadTurn
  message: UIMessage
  rawMessages: ClaudeSubagentSessionMessage[]
}

function readActiveClaudeQueryPermissionMode(
  permissionMode: ReturnType<typeof buildClaudeQueryOptions>['permissionMode'],
): Options['permissionMode'] {
  return permissionMode ?? 'bypassPermissions'
}

function closeClaudeQuery(activeQuery: Query): void {
  const close = (activeQuery as { close?: unknown }).close
  if (typeof close === 'function') {
    close.call(activeQuery)
  }
}

export function createClaudeAgentProvider(ctx: ProviderContext): ChatRuntime {
  return new ClaudeAgentProvider(ctx)
}

export class ClaudeAgentProvider implements ChatRuntime {
  readonly runtimeKind = CLAUDE_AGENT_RUNTIME_KIND
  readonly metadata = CLAUDE_AGENT_RUNTIME_METADATA
  readonly capabilities = CLAUDE_AGENT_RUNTIME_CAPABILITIES

  private readonly activeQueries = new Map<string, ActiveClaudeQuery>()
  private readonly compactStates = new Map<string, RuntimeCompactUiSlotState>()
  private readonly lastContextUsageBySession = new Map<string, RuntimeContextUsage>()
  private readonly lastContextUsageSampledAtBySession = new Map<string, number>()
  private readonly activePermissionModesBySession = new Map<string, Options['permissionMode']>()
  private _lastUsage: TokenUsage | null = null
  private _totalUsage: TokenUsage | null = null

  get lastUsage(): TokenUsage | null {
    return this._lastUsage
  }

  get totalUsage(): TokenUsage | null {
    return this._totalUsage
  }

  constructor(private readonly deps: ClaudeAgentProviderDeps) {}

  private releaseQuery(sessionId: string, entry: ActiveClaudeQuery): void {
    entry.releaseLiveRuntimeSession()
    if (this.activeQueries.get(sessionId) === entry) {
      this.activeQueries.delete(sessionId)
      this.activePermissionModesBySession.delete(sessionId)
    }
  }

  private readLiveRuntimeSession(runtimeSession: RuntimeSession): RuntimeSession {
    return this.activeQueries.get(runtimeSession.chatSessionId)?.runtimeSession ?? runtimeSession
  }

  async startChatSession(input: StartChatSessionInput): Promise<RuntimeSession> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const runtimeContext = resolveClaudeAgentRuntimeContext(input.workspacePath, input.agentId)
    return {
      id: input.chatSessionId,
      chatSessionId: input.chatSessionId,
      providerTargetId: profile.providerTargetId,
      runtimeKind: CLAUDE_AGENT_RUNTIME_KIND,
      providerSessionId: null,
      providerStateSnapshot: JSON.stringify({
        workspacePath: input.workspacePath,
        agentId: input.agentId ?? null,
        agentHome: runtimeContext.agentHome,
        models: { currentModelId: input.modelId },
      }),
    }
  }

  async resumeChatSession(input: ResumeChatSessionInput): Promise<RuntimeSession> {
    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const agentId = input.agentId ?? snapshot.agentId ?? null
    const runtimeContext = resolveClaudeAgentRuntimeContext(input.workspacePath, agentId)
    const pendingModelSwitchId = CLAUDE_AGENT_SDK_PERSIST_SESSION && input.modelId !== undefined
      ? resolveClaudeAgentPendingModelSwitchId(snapshot, input.modelId)
      : null
    const nextSnapshot = writeClaudeAgentPendingModelSwitch({
      ...snapshot,
      workspacePath: input.workspacePath,
      agentId,
      agentHome: runtimeContext.agentHome,
      models: {
        ...snapshot.models,
        currentModelId: input.modelId !== undefined ? input.modelId : snapshot.models.currentModelId,
      },
    }, pendingModelSwitchId)
    return {
      ...input.runtimeSession,
      providerStateSnapshot: JSON.stringify(nextSnapshot),
    }
  }

  async getPresentation(input: GetCapabilitiesInput): Promise<RuntimePresentationCapabilities> {
    const abortController = new AbortController()
    const stderrSink = createClaudeStderrSink()
    const queryOptions = buildClaudeQueryOptions({
      deps: this.deps,
      input,
      abortController,
      attachPermissionHandler: false,
      persistSession: false,
      onStderr: stderrSink.onStderr,
    })
    const activeQuery = query({ prompt: emptyClaudeAgentInput(), options: queryOptions })

    try {
      const slashCommands = await activeQuery.supportedCommands()

      return projectClaudeAgentPresentation(slashCommands)
    }
    catch (error) {
      throw stderrSink.enrichError(error)
    }
    finally {
      closeClaudeQuery(activeQuery)
    }
  }

  getDraftPresentation(): RuntimePresentationCapabilities {
    return projectClaudeAgentPresentation([])
  }

  async getUiSlotStates(input: GetUiSlotStatesInput): Promise<RuntimeUiSlotState[]> {
    const runtimeSession = this.readLiveRuntimeSession(input.runtimeSession)
    const planState = projectClaudeAgentPlanUiSlotState(runtimeSession)
    const progressState = projectClaudeAgentProgressUiSlotState(runtimeSession)
    const crewState = projectClaudeAgentCrewUiSlotState(runtimeSession)
    const toolActivityState = projectClaudeAgentToolActivityUiSlotState(runtimeSession)
    const compactState = await this.readCompactState({ ...input, runtimeSession })
    const states: RuntimeUiSlotState[] = []
    if (planState) {
      states.push(planState)
    }
    if (progressState) {
      states.push(progressState)
    }
    if (crewState) {
      states.push(crewState)
    }
    if (toolActivityState) {
      states.push(toolActivityState)
    }
    const usageState = projectClaudeAgentUsageUiSlotState(input.runtimeSession)
    if (usageState) {
      states.push(usageState)
    }
    if (compactState) {
      states.push(compactState)
    }
    return states
  }

  async* quickQuestion(input: QuickQuestionInput): AsyncGenerator<UIMessageChunk, void, void> {
    const abortController = new AbortController()
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const config = readTrustedClaudeAgentConfig(profile.configJson)
    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const effectiveModel = snapshot.models.currentModelId ?? config.model

    // Build query options with tools disabled
    const stderrSink = createClaudeStderrSink()
    const queryOptions = buildClaudeQueryOptions({
      deps: this.deps,
      input: {
        runtimeSession: input.runtimeSession,
        profile,
        workspacePath: input.workspacePath,
        workspaceId: input.workspaceId,
        modelId: effectiveModel,
      } as GetCapabilitiesInput,
      abortController,
      attachPermissionHandler: false,
      persistSession: false,
      onStderr: stderrSink.onStderr,
    })

    // Quick questions are a no-tools, no-persistence side path. Keep the
    // transcript in prompt context, but do not initialize provider tools,
    // MCP servers, or SDK skill discovery for this ephemeral query.
    queryOptions.tools = []
    delete queryOptions.mcpServers
    delete queryOptions.skills

    const inputStream = new ClaudeAgentInputStream()
    const activeQuery = query({ prompt: inputStream, options: queryOptions })
    const mapperState = createClaudeAgentChunkMapperState()

    try {
      // Build user content with full transcript for prompt cache reuse
      const userContent = buildClaudeAgentTurnContent({
        userContent: projectClaudeAgentInput(input.question, 'QuickQuestion'),
        history: input.transcript,
      })

      inputStream.push(userContent)

      // Stream response chunks
      for await (const message of activeQuery) {
        if (abortController.signal.aborted) {
          break
        }

        const result = await mapClaudeAgentMessageToChunks(message, mapperState)
        for (const chunk of result.chunks) {
          yield chunk
        }

        // Check if finished
        if (message.type === 'result') {
          break
        }
      }
    }
    catch (error) {
      throw stderrSink.enrichError(error)
    }
    finally {
      abortController.abort()
      closeClaudeQuery(activeQuery)
    }
  }

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    const abortController = new AbortController()
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const config = readTrustedClaudeAgentConfig(profile.configJson)
    const shouldPersistSession = shouldPersistClaudeAgentSdkSession(config.authMode)
    const resumedProviderSessionId = shouldPersistSession ? input.runtimeSession.providerSessionId : null
    const shouldResumeProviderSession = Boolean(resumedProviderSessionId)
    const projectedUserContent = projectClaudeAgentInput(input.message, 'Claude Agent provider')
    const userContent = buildClaudeAgentTurnContent({
      userContent: projectedUserContent,
      history: input.history,
      historyScope: shouldResumeProviderSession ? 'recentCradleLocal' : 'full',
    })
    const userPromptText = describeClaudeAgentUserContent(userContent)
    const effectiveModel = readClaudeAgentModelId(input, config)
    const pendingModelSwitchId = readClaudeAgentPendingModelSwitchId(
      readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot),
    )
    const sessionId = input.runtimeSession.chatSessionId
    let activeEntry = this.activeQueries.get(sessionId)
    if (
      activeEntry
      && (
        activeEntry.closed
        || !activeEntry.pumpRunning
        || activeEntry.providerTargetId !== profile.providerTargetId
      )
    ) {
      this.closeSessionQuery(sessionId, activeEntry)
      activeEntry = undefined
    }
    const planModeActive = readClaudeAgentPermissionMode(input.providerOptions?.runtimeSettings) === 'plan'
    // Only recreate when the in-memory query was built with skip=true; new options still resume
    // the same provider session so prompt cache and thread continuity are preserved.
    if (activeEntry && planModeActive && (activeEntry.allowDangerouslySkipPermissions ?? true)) {
      this.closeSessionQuery(sessionId, activeEntry)
      activeEntry = undefined
    }
    const permissionBridgeState = activeEntry?.permissionBridgeState ?? createClaudeAgentPermissionBridgeState({
      runtimeInput: input,
      permissionMode: 'bypassPermissions',
      runtimeSettings: input.providerOptions?.runtimeSettings,
    })
    let turnPermissionMode: Options['permissionMode'] = 'bypassPermissions'
    // Reuse the long-lived query's stderr sink when the session already exists;
    // otherwise create one for the new query. The sink must outlive the
    // pump loop so it can enrich the surfaced error when the process exits.
    const stderrSink = activeEntry?.stderrSink ?? createClaudeStderrSink()
    const queryOptions = buildClaudeQueryOptions({
      deps: this.deps,
      input,
      abortController,
      attachPermissionHandler: true,
      permissionBridgeState,
      emitToolApprovalRequest: request => this.emitClaudeAgentToolApprovalRequest(sessionId, request),
      onStderr: stderrSink.onStderr,
    })
    turnPermissionMode = readActiveClaudeQueryPermissionMode(queryOptions.permissionMode)

    if (!activeEntry) {
      this.activePermissionModesBySession.set(sessionId, turnPermissionMode)
      const inputStream = new ClaudeAgentInputStream()
      const activeQuery = query({ prompt: inputStream, options: queryOptions })
      if (turnPermissionMode === 'plan') {
        void activeQuery.setPermissionMode('plan').catch((error) => {
          this.deps.logger?.warn?.('Claude Agent failed to sync SDK plan permission mode after query start', {
            error,
            sessionId,
            resumed: shouldResumeProviderSession,
          })
        })
      }
      const taskLaunchesById: Map<string, ClaudeCrewLink> = new Map()
      activeEntry = {
        query: activeQuery,
        abortController,
        inputStream,
        mapperState: createClaudeAgentChunkMapperState(undefined, taskLaunchesById),
        taskLaunchesById,
        permissionBridgeState,
        runtimeSession: input.runtimeSession,
        providerTargetId: profile.providerTargetId,
        releaseLiveRuntimeSession: () => undefined,
        currentTurn: null,
        syntheticTurn: null,
        providerThreadTurns: new Map(),
        completedProviderThreadParentOutputIds: new Set(),
        onProviderSyntheticTurnEvent: null,
        nativeFollowUps: new Map(),
        preAdoptBuffer: [],
        closed: false,
        pumpRunning: true,
        stderrSink,
        allowDangerouslySkipPermissions: queryOptions.allowDangerouslySkipPermissions ?? true,
      }
      this.activeQueries.set(sessionId, activeEntry)
      const registeredEntry = activeEntry
      activeEntry.releaseLiveRuntimeSession = liveRuntimeSessionRegistry.register({
        sessionId,
        runtimeKind: this.runtimeKind,
        providerTargetId: profile.providerTargetId,
        readRuntimeSession: () => registeredEntry.runtimeSession,
        updateRuntimeSettings: async (settings) => {
          await this.updateRuntimeSettings({
            runtimeSession: registeredEntry.runtimeSession,
            profile,
            settings,
          })
        },
        enqueueNativeFollowUp: async ({ queueItemId, message }) => {
          this.enqueueNativeFollowUp(sessionId, queueItemId, message)
        },
        cancelNativeFollowUp: async (queueItemId) => {
          return this.cancelNativeFollowUp(sessionId, queueItemId)
        },
        claimNativeFollowUp: (queueItemId) => {
          return this.claimNativeFollowUp(sessionId, queueItemId)
        },
      })
      void this.captureClaudeAgentAccountSnapshot(input.runtimeSession, activeQuery)
      void this.pumpClaudeSessionQuery(sessionId, activeEntry)
    }
    else if (activeEntry.currentTurn) {
      throw new ProviderRuntimeError(
        ProviderErrors.requestFailed(this.runtimeKind, 'streamTurn', `Claude Agent session already has an active turn: ${sessionId}`),
      )
    }
    else {
      await this.completeClaudeSyntheticTurn(activeEntry)
      await this.updateActiveQueryPermissionMode({
        runtimeSession: input.runtimeSession,
        mode: turnPermissionMode,
        runtimeInput: input,
        runtimeSettings: input.providerOptions?.runtimeSettings,
      })
      activeEntry.runtimeSession = input.runtimeSession
      resetClaudeAgentChunkMapperForTurn(activeEntry.mapperState)
    }
    this._lastUsage = null
    this._totalUsage = null
    const traceMessageId = input.responseMessageId ?? input.message.id

    activeEntry.onProviderSyntheticTurnEvent = input.onProviderSyntheticTurnEvent ?? null
    clearClaudeAgentCapturedPlan(input.runtimeSession)

    // Langfuse tracing via @langfuse/tracing SDK
    let generation: LangfuseGeneration | null = null
    if (aiTelemetryEnabled()) {
      generation = startObservation('claude-agent-generation', {
        model: effectiveModel,
        input: input.systemPrompt
          ? [{ role: 'system', content: input.systemPrompt }, { role: 'user', content: userPromptText }]
          : [{ role: 'user', content: userPromptText }],
      }, { asType: 'generation' }) as LangfuseGeneration
      // Set trace-level attributes for session grouping
      const span = generation.otelSpan
      span.setAttribute('langfuse.session.id', input.runtimeSession.chatSessionId)
      span.setAttribute('langfuse.trace.name', 'claude-agent-chat')
    }
    const outputTextCollector = createBoundedTextCollector()
    let generationEnded = false
    const endGeneration = (error?: unknown) => {
      if (!generation || generationEnded) {
        return
      }
      if (error !== undefined) {
        generation.update({
          level: 'ERROR',
          statusMessage: error instanceof Error ? error.message : String(error),
        })
      }
      else {
        generation.update({
          output: outputTextCollector.read(),
          ...(this._lastUsage && {
            usageDetails: {
              input: this._lastUsage.promptTokens,
              output: this._lastUsage.completionTokens,
              total: this._lastUsage.totalTokens,
            },
          }),
        })
      }
      generation.end()
      generationEnded = true
    }

    const shouldGenerateTitle = shouldGenerateClaudeSessionTitle({
      providerSessionId: resumedProviderSessionId,
      promptText: userPromptText,
    })
    const turn: ActiveClaudeTurn = {
      input,
      queue: new AsyncEventQueue<UIMessageChunk>(),
      traceMessageId,
      shouldPersistSession,
      effectiveModel,
      userPromptText,
      shouldGenerateTitle,
      outputTextCollector,
      endGeneration,
    }
    activeEntry.currentTurn = turn

    try {
      if (shouldResumeProviderSession && pendingModelSwitchId) {
        await activeEntry.query.setModel(
          pendingModelSwitchId === CLAUDE_AGENT_RUNTIME_DEFAULT_MODEL_SWITCH_ID
            ? undefined
            : pendingModelSwitchId,
        )
        clearClaudeAgentPendingModelSwitch(input.runtimeSession)
      }
      if (resumedProviderSessionId) {
        await this.reportClaudeSessionTitle({
          sessionId: resumedProviderSessionId,
          runtimeSession: input.runtimeSession,
          reportSessionTitle: input.reportSessionTitle,
        })
      }

      const queueItemId = input.queueItemId?.trim() || null
      const adoptNative = queueItemId ? this.claimNativeFollowUp(sessionId, queueItemId) : false
      if (adoptNative) {
        const buffered = activeEntry.preAdoptBuffer.splice(0, activeEntry.preAdoptBuffer.length)
        for (const bufferedMessage of buffered) {
          await this.handleClaudeSessionMessage(activeEntry, bufferedMessage)
        }
      }
      else {
        activeEntry.inputStream.push(userContent, { priority: 'next' })
      }

      while (true) {
        const chunk = await turn.queue.next()
        if (!chunk) {
          break
        }
        yield chunk
      }

      endGeneration()
    }
    catch (error) {
      endGeneration(error)
      if (activeEntry.currentTurn === turn) {
        activeEntry.currentTurn = null
      }
      this.closeSessionQuery(sessionId, activeEntry)
      throw error
    }
    finally {
      endGeneration()
      if (activeEntry.currentTurn === turn) {
        this.completeClaudeProviderThreadTurns(activeEntry, turn)
        activeEntry.currentTurn = null
        turn.queue.close()
      }
    }
  }

  private async pumpClaudeSessionQuery(sessionId: string, entry: ActiveClaudeQuery): Promise<void> {
    entry.pumpRunning = true
    try {
      for await (const message of entry.query) {
        if (entry.abortController.signal.aborted || entry.closed) {
          break
        }
        await this.handleClaudeSessionMessage(entry, message)
      }
    }
    catch (error) {
      const turn = entry.currentTurn
      if (turn) {
        const enriched = entry.stderrSink.enrichError(error)
        const failure = enriched instanceof Error ? enriched : new Error(String(enriched))
        turn.endGeneration(failure)
        turn.queue.fail(failure)
      }
    }
    finally {
      entry.pumpRunning = false
      const turn = entry.currentTurn
      if (turn) {
        this.completeClaudeProviderThreadTurns(entry, turn)
        turn.endGeneration()
        turn.queue.close()
        entry.currentTurn = null
      }
      await this.completeClaudeSyntheticTurn(entry)
      entry.closed = true
      entry.nativeFollowUps.clear()
      entry.preAdoptBuffer = []
      entry.inputStream.close()
      this.releaseQuery(sessionId, entry)
    }
  }

  private async handleClaudeSessionMessage(entry: ActiveClaudeQuery, message: SDKMessage): Promise<void> {
    const turn = entry.currentTurn
    if (!turn && entry.nativeFollowUps.size > 0) {
      entry.preAdoptBuffer.push(message)
      return
    }

    if (turn && isChatStreamTraceEnabled()) {
      recordChatStreamTrace({
        chatSessionId: entry.runtimeSession.chatSessionId,
        runId: turn.input.runId,
        messageId: turn.traceMessageId,
        runtimeKind: this.runtimeKind,
        providerSessionId: entry.runtimeSession.providerSessionId,
        phase: 'provider_raw',
        payload: message,
      })
    }

    this.projectClaudeAgentRuntimeState(entry.runtimeSession, message)

    if (turn) {
      const providerThreadId = readClaudeActiveProviderThreadId(message)
      if (providerThreadId) {
        await this.handleClaudeProviderThreadMessage(entry, turn, providerThreadId, message)
        return
      }
    }

    const result = await mapClaudeAgentMessageToChunks(message, entry.mapperState)
    for (const plan of result.capturedPlans) {
      writeClaudeAgentCapturedPlan(entry.runtimeSession, plan)
    }
    for (const progress of result.capturedTodos) {
      writeClaudeAgentProgress(entry.runtimeSession, progress)
    }
    for (const crewCall of result.capturedCrewCalls) {
      writeClaudeAgentCrewCall(entry.runtimeSession, mapCrewCallToSnapshot(crewCall))
    }
    for (const taskActivity of result.capturedTaskActivity) {
      writeClaudeAgentTaskActivity(entry.runtimeSession, taskActivity)
    }
    for (const mode of result.capturedInteractionModes) {
      const nextSettings = mergeRuntimeSettings(
        this.runtimeKind,
        entry.permissionBridgeState.runtimeSettings ?? getDefaultRuntimeSettings(this.runtimeKind),
        { permissionMode: mode.permissionMode },
      )
      const projectedMode = readClaudeAgentPermissionMode(nextSettings)
      await this.updateActiveQueryPermissionMode({
        runtimeSession: entry.runtimeSession,
        mode: projectedMode,
        runtimeSettings: nextSettings,
      })
      void this.requestRuntimePermissionModeUpdate(entry.runtimeSession, mode.permissionMode)
    }

    if (turn && isChatStreamTraceEnabled()) {
      recordChatStreamTrace({
        chatSessionId: entry.runtimeSession.chatSessionId,
        runId: turn.input.runId,
        messageId: turn.traceMessageId,
        runtimeKind: this.runtimeKind,
        providerSessionId: result.sessionId ?? entry.runtimeSession.providerSessionId,
        phase: 'mapper_output',
        payload: {
          messageType: message.type,
          chunks: result.chunks,
          sessionId: result.sessionId ?? null,
          usage: result.usage ?? null,
          assistantStarted: entry.mapperState.assistantStarted,
        },
      })
    }

    if (turn) {
      await this.updateClaudeTurnProviderSession(entry, turn, result.sessionId)
      this.updateClaudeTurnUsage(result.usage)
      for (const chunk of result.chunks) {
        if (chunk.type === 'text-delta' && 'delta' in chunk) {
          turn.outputTextCollector.append((chunk as { delta: string }).delta)
        }
        turn.queue.push(chunk)
      }
    }
    else {
      await this.handleClaudeSyntheticSessionMessage(entry, message)
    }

    if (message.type === 'result' && !readClaudeMessageParentToolUseId(message)) {
      if (turn) {
        this.completeClaudeProviderThreadTurns(entry, turn)
        await this.refreshCompactState({ runtimeSession: entry.runtimeSession }).catch(() => undefined)
        turn.endGeneration()
        entry.currentTurn = null
        turn.queue.close()
      }
      resetClaudeAgentChunkMapperForTurn(entry.mapperState)
    }
  }

  private async handleClaudeProviderThreadMessage(
    entry: ActiveClaudeQuery,
    turn: ActiveClaudeTurn,
    providerThreadId: string,
    message: SDKMessage,
  ): Promise<void> {
    const providerThreadTurn = this.ensureClaudeProviderThreadTurn(entry, providerThreadId)
    const result = await mapClaudeAgentMessageToChunksWithoutParentProjection(message, providerThreadTurn.mapperState)
    for (const crewCall of result.capturedCrewCalls) {
      writeClaudeAgentCrewCall(entry.runtimeSession, mapCrewCallToSnapshot(crewCall))
    }
    for (const taskActivity of result.capturedTaskActivity) {
      writeClaudeAgentTaskActivity(entry.runtimeSession, taskActivity)
    }
    this.updateClaudeTurnUsage(result.usage)
    this.publishClaudeProviderThreadEvent(turn, providerThreadTurn, result.chunks)
    if (hasTerminalProviderThreadChunk(result.chunks)) {
      this.emitClaudeProviderThreadParentOutput(entry, turn, providerThreadId, result.chunks)
      providerThreadTurn.terminal = true
      entry.providerThreadTurns.delete(providerThreadId)
    }
  }

  private ensureClaudeProviderThreadTurn(
    entry: ActiveClaudeQuery,
    providerThreadId: string,
  ): ActiveClaudeProviderThreadTurn {
    const existing = entry.providerThreadTurns.get(providerThreadId)
    if (existing) {
      return existing
    }

    const providerThreadTurn: ActiveClaudeProviderThreadTurn = {
      providerThreadId,
      providerTurnId: `claude-subagent-${randomUUID()}`,
      mapperState: createClaudeAgentChunkMapperState(`provider-thread:${providerThreadId}`, entry.taskLaunchesById),
      terminal: false,
    }
    entry.providerThreadTurns.set(providerThreadId, providerThreadTurn)
    return providerThreadTurn
  }

  private publishClaudeProviderThreadEvent(
    turn: ActiveClaudeTurn,
    providerThreadTurn: ActiveClaudeProviderThreadTurn,
    chunks: UIMessageChunk[],
  ): void {
    if (chunks.length === 0 || providerThreadTurn.terminal) {
      return
    }
    const event: ProviderThreadEvent = {
      providerThreadId: providerThreadTurn.providerThreadId,
      providerTurnId: providerThreadTurn.providerTurnId,
      notification: {
        type: 'claudeAgentSubagent',
        parentToolUseId: providerThreadTurn.providerThreadId,
      },
      chunks,
    }
    turn.input.onProviderThreadEvent?.(event)
  }

  private completeClaudeProviderThreadTurns(entry: ActiveClaudeQuery, turn: ActiveClaudeTurn): void {
    for (const providerThreadTurn of entry.providerThreadTurns.values()) {
      const chunks: UIMessageChunk[] = [
        providerChunk.finish('stop'),
      ]
      this.publishClaudeProviderThreadEvent(turn, providerThreadTurn, chunks)
      this.emitClaudeProviderThreadParentOutput(entry, turn, providerThreadTurn.providerThreadId, chunks)
      providerThreadTurn.terminal = true
    }
    entry.providerThreadTurns.clear()
  }

  private emitClaudeProviderThreadParentOutput(
    entry: ActiveClaudeQuery,
    turn: ActiveClaudeTurn,
    providerThreadId: string,
    terminalChunks: UIMessageChunk[],
  ): void {
    if (entry.completedProviderThreadParentOutputIds.has(providerThreadId)) {
      return
    }
    entry.completedProviderThreadParentOutputIds.add(providerThreadId)

    const errorText = readTerminalProviderThreadErrorText(terminalChunks)
    if (errorText) {
      turn.queue.push({
        type: 'tool-output-error',
        toolCallId: providerThreadId,
        errorText,
      })
      return
    }

    const args = entry.mapperState.toolArgsByToolCallId.get(providerThreadId)
    const current = entry.mapperState.emittedToolStateByToolCallId.get(providerThreadId) ?? {
      started: false,
      inputAvailable: false,
    }
    current.outputAvailable = true
    entry.mapperState.emittedToolStateByToolCallId.set(providerThreadId, current)
    turn.queue.push({
      type: 'tool-output-available',
      toolCallId: providerThreadId,
      output: createClaudeCodeToolResultPayload({
        apiName: ClaudeCodeToolName.Agent,
        args,
        result: {
          status: 'completed',
          providerThreadId,
          threadId: providerThreadId,
        },
      }),
    })
  }

  private emitClaudeAgentToolApprovalRequest(sessionId: string, request: ClaudeAgentToolApprovalRequest): void {
    const entry = this.activeQueries.get(sessionId)
    const turn = entry?.currentTurn
    if (!entry || !turn) {
      return
    }

    const providerThreadTurn = this.resolveClaudeToolApprovalProviderThreadTurn(entry, request)
    if (providerThreadTurn) {
      this.publishClaudeProviderThreadEvent(
        turn,
        providerThreadTurn,
        emitClaudeAgentToolApprovalChunks(providerThreadTurn.mapperState, request),
      )
      return
    }

    for (const chunk of emitClaudeAgentToolApprovalChunks(entry.mapperState, request)) {
      turn.queue.push(chunk)
    }
  }

  private resolveClaudeToolApprovalProviderThreadTurn(
    entry: ActiveClaudeQuery,
    request: ClaudeAgentToolApprovalRequest,
  ): ActiveClaudeProviderThreadTurn | null {
    if (!request.agentId) {
      return null
    }

    const mappedProviderThreadId = readClaudeAgentCrewProviderThreadIdForAgent(entry.runtimeSession, request.agentId)
    if (mappedProviderThreadId) {
      return this.ensureClaudeProviderThreadTurn(entry, mappedProviderThreadId)
    }

    const providerThreadTurn = entry.providerThreadTurns.get(request.agentId)
    if (providerThreadTurn) {
      return providerThreadTurn
    }

    return null
  }

  private async handleClaudeSyntheticSessionMessage(entry: ActiveClaudeQuery, message: SDKMessage): Promise<void> {
    if (!shouldRouteClaudeMessageToSyntheticTurn(entry, message)) {
      return
    }

    const syntheticTurn = this.ensureClaudeSyntheticTurn(entry, message)
    if (!syntheticTurn) {
      return
    }

    const result = await mapClaudeAgentMessageToChunksWithoutParentProjection(message, syntheticTurn.mapperState)
    await this.publishClaudeSyntheticTurnEvent(entry, syntheticTurn, result.chunks)
    if (message.type === 'result') {
      entry.syntheticTurn = null
    }
  }

  private ensureClaudeSyntheticTurn(
    entry: ActiveClaudeQuery,
    message: SDKMessage,
  ): ActiveClaudeSyntheticTurn | null {
    if (entry.syntheticTurn) {
      return entry.syntheticTurn
    }
    const onProviderSyntheticTurnEvent = entry.onProviderSyntheticTurnEvent
    if (!onProviderSyntheticTurnEvent) {
      return null
    }

    const syntheticTurn: ActiveClaudeSyntheticTurn = {
      providerTurnId: `claude-synthetic-${randomUUID()}`,
      providerThreadId: readClaudeSyntheticProviderThreadId(message),
      mapperState: createClaudeAgentChunkMapperState(undefined, entry.taskLaunchesById),
      onProviderSyntheticTurnEvent,
    }
    entry.syntheticTurn = syntheticTurn
    return syntheticTurn
  }

  private async completeClaudeSyntheticTurn(entry: ActiveClaudeQuery): Promise<void> {
    const syntheticTurn = entry.syntheticTurn
    if (!syntheticTurn) {
      return
    }

    await this.publishClaudeSyntheticTurnEvent(entry, syntheticTurn, [
      providerChunk.finish('stop'),
    ])
    entry.syntheticTurn = null
  }

  private async publishClaudeSyntheticTurnEvent(
    entry: ActiveClaudeQuery,
    syntheticTurn: ActiveClaudeSyntheticTurn,
    chunks: UIMessageChunk[],
  ): Promise<void> {
    if (chunks.length === 0) {
      return
    }

    const event: ProviderSyntheticTurnEvent = {
      providerTurnId: syntheticTurn.providerTurnId,
      providerThreadId: syntheticTurn.providerThreadId,
      chunks,
    }
    try {
      await syntheticTurn.onProviderSyntheticTurnEvent(event)
    }
    catch (error) {
      this.deps.logger?.warn('Claude Agent synthetic turn event failed', {
        error,
        chatSessionId: entry.runtimeSession.chatSessionId,
        providerTurnId: syntheticTurn.providerTurnId,
        providerThreadId: syntheticTurn.providerThreadId,
      })
    }
  }

  private async updateClaudeTurnProviderSession(
    entry: ActiveClaudeQuery,
    turn: ActiveClaudeTurn,
    sessionId: string | null,
  ): Promise<void> {
    const nextProviderSessionId = turn.shouldPersistSession && sessionId && sessionId !== entry.runtimeSession.providerSessionId
      ? sessionId
      : null
    if (!nextProviderSessionId) {
      return
    }

    entry.runtimeSession.providerSessionId = nextProviderSessionId
    turn.input.runtimeSession.providerSessionId = nextProviderSessionId
    await this.reportClaudeSessionTitle({
      sessionId: nextProviderSessionId,
      runtimeSession: entry.runtimeSession,
      reportSessionTitle: turn.input.reportSessionTitle,
    })

    if (!turn.shouldGenerateTitle) {
      return
    }

    const snapshot = readWorkspaceProviderStateSnapshot(entry.runtimeSession.providerStateSnapshot)
    const titleGeneration = this.resolveClaudeSessionTitleGenerationConfig({
      currentProfile: requireRuntimeProviderTargetProfile(turn.input.profile, this.runtimeKind),
      fallbackModel: turn.effectiveModel ?? null,
    })
    this.generateClaudeSessionTitleInBackground({
      runtimeSession: entry.runtimeSession,
      profile: titleGeneration.profile,
      mainSessionId: nextProviderSessionId,
      promptText: turn.userPromptText,
      modelId: titleGeneration.modelId ?? titleGeneration.fallbackModel,
      fallbackModel: titleGeneration.fallbackModel,
      thinkingEffort: titleGeneration.thinkingEffort,
      workspaceId: turn.input.workspaceId,
      workspacePath: turn.input.workspacePath ?? snapshot.workspacePath ?? '',
      agentId: turn.input.agentId ?? snapshot.agentId ?? null,
      reportSessionTitle: turn.input.reportSessionTitle,
    })
  }

  private updateClaudeTurnUsage(usage: TokenUsage | null): void {
    if (!usage) {
      return
    }
    this._lastUsage = usage
    if (this._totalUsage) {
      this._totalUsage = {
        promptTokens: this._totalUsage.promptTokens + usage.promptTokens,
        completionTokens: this._totalUsage.completionTokens + usage.completionTokens,
        totalTokens: this._totalUsage.totalTokens + usage.totalTokens,
        cachedInputTokens: (this._totalUsage.cachedInputTokens ?? 0) + (usage.cachedInputTokens ?? 0),
        cacheWriteInputTokens: (this._totalUsage.cacheWriteInputTokens ?? 0) + (usage.cacheWriteInputTokens ?? 0),
        reasoningOutputTokens: (this._totalUsage.reasoningOutputTokens ?? 0) + (usage.reasoningOutputTokens ?? 0),
      }
      return
    }
    this._totalUsage = { ...usage }
  }

  private closeSessionQuery(sessionId: string, entry: ActiveClaudeQuery): void {
    if (entry.closed) {
      return
    }
    entry.closed = true
    entry.pumpRunning = false
    if (entry.currentTurn) {
      this.completeClaudeProviderThreadTurns(entry, entry.currentTurn)
    }
    entry.nativeFollowUps.clear()
    entry.preAdoptBuffer = []
    entry.abortController.abort()
    entry.inputStream.close()
    closeClaudeQuery(entry.query)
    entry.currentTurn?.queue.close()
    entry.currentTurn = null
    this.releaseQuery(sessionId, entry)
  }

  private enqueueNativeFollowUp(sessionId: string, queueItemId: string, message: UIMessage): void {
    const entry = this.activeQueries.get(sessionId)
    if (!entry || entry.closed || !entry.pumpRunning) {
      throw new ProviderRuntimeError(
        ProviderErrors.requestFailed(
          this.runtimeKind,
          'enqueueNativeFollowUp',
          `Claude Agent session has no live query to enqueue into: ${sessionId}`,
        ),
      )
    }
    if (entry.nativeFollowUps.has(queueItemId)) {
      return
    }
    const userContent = projectClaudeAgentInput(message, 'Claude Agent native queue')
    const messageUuid = entry.inputStream.push(userContent, {
      priority: 'next',
    })
    entry.nativeFollowUps.set(queueItemId, {
      queueItemId,
      messageUuid,
      userContent,
    })
  }

  private async cancelNativeFollowUp(sessionId: string, queueItemId: string): Promise<boolean> {
    const entry = this.activeQueries.get(sessionId)
    if (!entry) {
      return false
    }
    const pending = entry.nativeFollowUps.get(queueItemId)
    if (!pending) {
      return false
    }
    entry.nativeFollowUps.delete(queueItemId)
    const cancelAsyncMessage = (entry.query as {
      cancelAsyncMessage?: (messageUuid: string) => Promise<unknown>
    }).cancelAsyncMessage
    if (typeof cancelAsyncMessage === 'function') {
      try {
        await cancelAsyncMessage.call(entry.query, pending.messageUuid)
      }
      catch (error) {
        this.deps.logger?.warn?.('Claude Agent failed to cancel native queued follow-up', {
          error,
          sessionId,
          queueItemId,
          messageUuid: pending.messageUuid,
        })
      }
    }
    return true
  }

  private claimNativeFollowUp(sessionId: string, queueItemId: string): boolean {
    const entry = this.activeQueries.get(sessionId)
    if (!entry) {
      return false
    }
    return entry.nativeFollowUps.delete(queueItemId)
  }

  async getContextUsage(input: GetContextUsageInput): Promise<RuntimeContextUsage | null> {
    return await this.readContextUsage({
      runtimeSession: this.readLiveRuntimeSession(input.runtimeSession),
    })
  }

  async cancelTurn(input: CancelTurnInput): Promise<void> {
    const sessionId = input.runtimeSession.chatSessionId
    const entry = this.activeQueries.get(sessionId)
    if (!entry) {
      return
    }
    this.closeSessionQuery(sessionId, entry)
  }

  async dispose(): Promise<void> {
    for (const [sessionId, entry] of this.activeQueries) {
      this.closeSessionQuery(sessionId, entry)
    }
  }

  async listProviderThreads(input: ProviderThreadListInput): Promise<ProviderThreadListResult> {
    const parentSessionId = input.runtimeSession.providerSessionId
    if (!parentSessionId || !supportsClaudeSubagentSourceKinds(input.sourceKinds)) {
      return {
        runtimeKind: this.runtimeKind,
        providerSessionId: parentSessionId,
        threads: [],
        nextCursor: null,
        backwardsCursor: null,
      }
    }

    const cwd = this.resolveClaudeProviderThreadDir(input)
    const agentIds = await listSubagents(parentSessionId, { dir: cwd })
    const records = await Promise.all(agentIds.map(async agentId => ({
      agentId,
      parentSessionId,
      cwd,
      messages: await this.readClaudeSubagentMessages(parentSessionId, agentId, cwd),
    } satisfies ClaudeSubagentThreadRecord)))
    const sortKey = input.sortKey ?? 'updated_at'
    const sortDirection = input.sortDirection ?? 'desc'
    const searchTerm = normalizeProviderThreadText(input.searchTerm)
    const threads = records
      .map(projectClaudeSubagentThread)
      .filter(thread => !searchTerm || claudeProviderThreadMatchesSearch(thread, searchTerm))
      .sort((left, right) => compareClaudeProviderThreads(left, right, sortKey, sortDirection))

    const offset = readProviderThreadOffset(input.cursor)
    const limit = readProviderThreadLimit(input.limit)
    const page = threads.slice(offset, offset + limit)
    return {
      runtimeKind: this.runtimeKind,
      providerSessionId: parentSessionId,
      threads: page,
      nextCursor: offset + limit < threads.length ? String(offset + limit) : null,
      backwardsCursor: offset > 0 ? String(Math.max(0, offset - limit)) : null,
    }
  }

  async readProviderThread(input: ProviderThreadReadInput): Promise<ProviderThreadReadResult> {
    const record = await this.resolveClaudeSubagentThreadRecord(input.threadId, input)
    return {
      runtimeKind: this.runtimeKind,
      providerSessionId: record.parentSessionId,
      thread: projectClaudeSubagentThread(record),
    }
  }

  async listProviderThreadTurns(input: ProviderThreadTurnsInput): Promise<ProviderThreadTurnsResult> {
    const record = await this.resolveClaudeSubagentThreadRecord(input.threadId, input)
    const sortDirection = input.sortDirection ?? 'asc'
    const displayMessages = record.messages.filter(hasClaudeSubagentDisplayParts)
    const entries = projectClaudeSubagentEntries(record, displayMessages)
    const orderedEntries = sortDirection === 'desc' ? [...entries].reverse() : entries
    const offset = readProviderThreadOffset(input.cursor)
    const limit = readProviderThreadLimit(input.limit)
    const page = orderedEntries.slice(offset, offset + limit)
    return {
      runtimeKind: this.runtimeKind,
      providerSessionId: record.parentSessionId,
      threadId: readClaudeSubagentProviderThreadId(record),
      turns: page.map(entry => entry.turn),
      messages: page.map(entry => entry.message),
      nextCursor: offset + limit < orderedEntries.length ? String(offset + limit) : null,
      backwardsCursor: offset > 0 ? String(Math.max(0, offset - limit)) : null,
    }
  }

  private async readCompactState(input: GetUiSlotStatesInput): Promise<RuntimeCompactUiSlotState | null> {
    const sessionId = input.runtimeSession.chatSessionId
    const cached = this.readFreshCompactState(sessionId)
    if (cached) {
      return cached
    }

    try {
      return await this.refreshCompactState(input)
        ?? this.compactStates.get(sessionId)
        ?? null
    }
    catch {
      return this.compactStates.get(sessionId) ?? null
    }
  }

  private async readContextUsage(input: ContextUsageRuntimeInput): Promise<RuntimeContextUsage | null> {
    const sessionId = input.runtimeSession.chatSessionId
    const entry = this.activeQueries.get(sessionId)
    if (!entry) {
      return this.lastContextUsageBySession.get(sessionId) ?? null
    }

    const updatedAt = Math.floor(Date.now() / 1000)
    const response = await entry.query.getContextUsage()
    const usage = projectClaudeAgentContextUsage({
      providerSessionId: input.runtimeSession.providerSessionId,
      response,
      updatedAt,
    })
    this.lastContextUsageBySession.set(sessionId, usage)
    this.lastContextUsageSampledAtBySession.set(sessionId, Date.now())
    this.compactStates.set(sessionId, this.projectCompactState(input.runtimeSession, usage))
    return usage
  }

  private readFreshCompactState(sessionId: string): RuntimeCompactUiSlotState | null {
    const compactState = this.compactStates.get(sessionId)
    const sampledAt = this.lastContextUsageSampledAtBySession.get(sessionId)
    if (!compactState || !sampledAt) {
      return null
    }
    return Date.now() - sampledAt <= COMPACT_SLOT_CONTEXT_USAGE_TTL_MS ? compactState : null
  }

  private async refreshCompactState(input: ContextUsageRuntimeInput): Promise<RuntimeCompactUiSlotState | null> {
    const usage = await this.readContextUsage(input)
    if (!usage) {
      return null
    }
    const compactState = this.projectCompactState(input.runtimeSession, usage)
    this.compactStates.set(input.runtimeSession.chatSessionId, compactState)
    return compactState
  }

  private projectCompactState(
    runtimeSession: ContextUsageRuntimeInput['runtimeSession'],
    usage: RuntimeContextUsage,
  ): RuntimeCompactUiSlotState {
    return projectClaudeAgentCompactState({
      threadId: runtimeSession.chatSessionId,
      turnId: null,
      usage,
      updatedAt: usage.updatedAt,
    })
  }

  private async updateActiveQueryPermissionMode(
    input: Pick<UpdateRuntimeSettingsInput, 'runtimeSession'> & {
      mode: Options['permissionMode']
      runtimeInput?: StreamTurnInput | GetCapabilitiesInput
      runtimeSettings?: UpdateRuntimeSettingsInput['settings']
    },
  ): Promise<void> {
    const sessionId = input.runtimeSession.chatSessionId
    const entry = this.activeQueries.get(sessionId)
    if (!entry) {
      return
    }
    const mode = input.mode ?? 'bypassPermissions'
    if (this.activePermissionModesBySession.get(sessionId) !== mode) {
      await entry.query.setPermissionMode(mode)
    }
    this.activePermissionModesBySession.set(sessionId, mode)
    updateClaudeAgentPermissionBridgeState(entry.permissionBridgeState, {
      runtimeInput: input.runtimeInput ?? entry.permissionBridgeState.runtimeInput,
      permissionMode: mode,
      runtimeSettings: input.runtimeSettings ?? entry.permissionBridgeState.runtimeSettings,
    })
  }

  private async requestRuntimePermissionModeUpdate(
    runtimeSession: RuntimeSession,
    permissionMode: 'plan',
  ): Promise<void> {
    if (!this.deps.updateSessionRuntimeSettings) {
      return
    }

    try {
      await this.deps.updateSessionRuntimeSettings({
        sessionId: runtimeSession.chatSessionId,
        patch: { permissionMode },
      })
    }
    catch (error) {
      this.deps.logger?.warn?.('Claude Agent runtime permission mode update failed', {
        error,
        sessionId: runtimeSession.chatSessionId,
        permissionMode,
      })
    }
  }

  async updateRuntimeSettings(input: UpdateRuntimeSettingsInput): Promise<void> {
    const mode = readClaudeAgentPermissionMode(input.settings)
    await this.updateActiveQueryPermissionMode({
      runtimeSession: input.runtimeSession,
      mode,
      runtimeSettings: input.settings,
    })
  }

  async generateSessionTitle(input: GenerateSessionTitleInput): Promise<string | null> {
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const config = readTrustedClaudeAgentConfig(profile.configJson)
    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const titleGeneration = this.resolveClaudeSessionTitleGenerationConfig({
      currentProfile: profile,
      fallbackModel: input.modelId ?? snapshot.models.currentModelId ?? config.model ?? null,
    })
    const abortController = new AbortController()
    try {
      const title = await generateClaudeSessionTitle({
        runtimeSession: input.runtimeSession,
        profile: titleGeneration.profile,
        promptText: input.promptText,
        modelId: titleGeneration.modelId ?? titleGeneration.fallbackModel,
        thinkingEffort: titleGeneration.thinkingEffort,
        workspaceId: input.workspaceId,
        workspacePath: input.workspacePath ?? snapshot.workspacePath ?? '',
        agentId: input.agentId ?? snapshot.agentId ?? null,
        deps: this.deps,
        signal: abortController.signal,
      })
      if (title && input.runtimeSession.providerSessionId) {
        await renameSession(input.runtimeSession.providerSessionId, title, {
          dir: this.resolveClaudeSessionProjectDir({
            workspacePath: input.workspacePath ?? snapshot.workspacePath ?? undefined,
            agentId: input.agentId ?? snapshot.agentId ?? null,
          }),
        }).catch(() => undefined)
      }
      return title
    }
    finally {
      abortController.abort()
    }
  }

  private async reportClaudeSessionTitle(input: {
    sessionId: string
    runtimeSession: RuntimeSession
    reportSessionTitle?: (title: string) => void
  }): Promise<void> {
    if (!input.reportSessionTitle) {
      return
    }

    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    const info = await getSessionInfo(input.sessionId, {
      dir: this.resolveClaudeSessionProjectDir({
        workspacePath: snapshot.workspacePath ?? undefined,
        agentId: snapshot.agentId ?? null,
      }),
    }).catch(() => undefined)
    const title = normalizeClaudeSessionTitle(
      (info as ClaudeAgentSessionInfo | undefined)?.customTitle
      ?? (info as ClaudeAgentSessionInfo | undefined)?.summary,
    )
    if (title) {
      input.reportSessionTitle(title)
    }
  }

  private async captureClaudeAgentAccountSnapshot(runtimeSession: RuntimeSession, activeQuery: Query): Promise<void> {
    try {
      const result = await activeQuery.initializationResult()
      if (hasClaudeAgentAccountSignal(result.account)) {
        writeClaudeAgentAccountSnapshot(runtimeSession, result.account)
      }
    }
    catch (error) {
      this.deps.logger?.debug?.('Claude Agent account initialization probe failed', {
        error,
        sessionId: runtimeSession.chatSessionId,
      })
    }
  }

  private projectClaudeAgentRuntimeState(runtimeSession: RuntimeSession, message: SDKMessage): void {
    if (message.type === 'auth_status') {
      writeClaudeAgentAuthStatusSnapshot(runtimeSession, message as SDKAuthStatusMessage)
      return
    }
    if (message.type === 'rate_limit_event') {
      writeClaudeAgentRateLimitSnapshot(runtimeSession, (message as SDKRateLimitEvent).rate_limit_info)
    }
  }

  private resolveClaudeSessionProjectDir(input: {
    workspacePath?: string | null
    agentId?: string | null
  }): string {
    activateClaudeAgentSdkConfigDir()
    return resolveClaudeAgentRuntimeContext(input.workspacePath ?? undefined, input.agentId ?? null).cwd
  }

  private resolveClaudeProviderThreadDir(input: GetCapabilitiesInput): string {
    const snapshot = readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot)
    return this.resolveClaudeSessionProjectDir({
      workspacePath: input.workspacePath ?? snapshot.workspacePath ?? undefined,
      agentId: input.agentId ?? snapshot.agentId ?? null,
    })
  }

  private async readClaudeSubagentMessages(
    parentSessionId: string,
    agentId: string,
    cwd: string,
  ): Promise<ClaudeSubagentSessionMessage[]> {
    const messages = await getSubagentMessages(parentSessionId, agentId, { dir: cwd })
    return messages.map(message => message as ClaudeSubagentSessionMessage)
  }

  private async resolveClaudeSubagentThreadRecord(
    requestedThreadId: string,
    input: GetCapabilitiesInput,
  ): Promise<ClaudeSubagentThreadRecord> {
    const parentSessionId = input.runtimeSession.providerSessionId
    if (!parentSessionId) {
      throw new ProviderRuntimeError(ProviderErrors.sessionNotFound(this.runtimeKind, input.runtimeSession.chatSessionId))
    }

    const cwd = this.resolveClaudeProviderThreadDir(input)
    const agentIds = await listSubagents(parentSessionId, { dir: cwd })
    if (agentIds.includes(requestedThreadId)) {
      const messages = await this.readClaudeSubagentMessages(parentSessionId, requestedThreadId, cwd)
      return { agentId: requestedThreadId, parentSessionId, cwd, messages }
    }

    for (const agentId of agentIds) {
      const messages = await this.readClaudeSubagentMessages(parentSessionId, agentId, cwd)
      if (messages.some(message => message.parent_tool_use_id === requestedThreadId)) {
        return { agentId, parentSessionId, cwd, messages }
      }
    }

    throw new ProviderRuntimeError(
      ProviderErrors.requestFailed(
        this.runtimeKind,
        'provider-thread/read',
        `Claude Agent subagent transcript was not found: ${requestedThreadId}`,
      ),
    )
  }

  private resolveClaudeSessionTitleGenerationConfig(input: {
    currentProfile: RuntimeProviderTargetProfile
    fallbackModel: string | null
  }): {
    profile: RuntimeProviderTargetProfile
    modelId: string | null
    fallbackModel: string | null
    thinkingEffort: ClaudeTitleGenerationThinkingEffort
  } {
    const preferences = this.deps.readChatPreferences?.()
    const titlePreferences = preferences?.titleGeneration
    const thinkingEffort = titlePreferences?.thinkingEffort ?? 'minimal'
    const explicitProviderTargetId = titlePreferences?.providerTargetId ?? null
    const explicitModelId = titlePreferences?.modelId ?? null

    if (!explicitProviderTargetId) {
      return {
        profile: input.currentProfile,
        modelId: explicitModelId,
        fallbackModel: input.fallbackModel,
        thinkingEffort,
      }
    }

    const profile = this.deps.resolveProviderTargetProfile?.(explicitProviderTargetId)
    if (!profile) {
      return {
        profile: input.currentProfile,
        modelId: explicitModelId,
        fallbackModel: input.fallbackModel,
        thinkingEffort,
      }
    }

    const config = readTrustedClaudeAgentConfig(profile.configJson)
    const modelId = explicitModelId ?? config.model ?? null
    return {
      profile,
      modelId,
      fallbackModel: input.fallbackModel,
      thinkingEffort,
    }
  }

  private generateClaudeSessionTitleInBackground(input: {
    runtimeSession: RuntimeSession
    profile: RuntimeProviderTargetProfile
    mainSessionId: string
    promptText: string
    modelId: string | null
    fallbackModel: string | null
    thinkingEffort: ClaudeTitleGenerationThinkingEffort
    workspaceId?: string | null
    workspacePath: string
    agentId: string | null
    reportSessionTitle?: (title: string) => void
  }): void {
    setTimeout(() => {
      void (async () => {
        const abortController = new AbortController()
        try {
          const model = input.modelId ?? input.fallbackModel
          const generatedTitle = await generateClaudeSessionTitle({
            runtimeSession: input.runtimeSession,
            profile: input.profile,
            promptText: input.promptText,
            modelId: model,
            thinkingEffort: input.thinkingEffort,
            workspaceId: input.workspaceId,
            workspacePath: input.workspacePath,
            agentId: input.agentId,
            deps: this.deps,
            signal: abortController.signal,
          })
          if (generatedTitle) {
            await renameSession(input.mainSessionId, generatedTitle, {
              dir: this.resolveClaudeSessionProjectDir({
                workspacePath: input.workspacePath,
                agentId: input.agentId,
              }),
            })
            input.reportSessionTitle?.(generatedTitle)
          }
        }
        catch {
          // Title generation is opportunistic and must not affect the active turn.
        }
        finally {
          abortController.abort()
        }
      })()
    }, 0)
  }
}

function hasClaudeAgentAccountSignal(account: AccountInfo | undefined): account is AccountInfo {
  return Boolean(
    account?.email
    || account?.organization
    || account?.subscriptionType
    || account?.tokenSource
    || account?.apiKeySource
    || account?.apiProvider,
  )
}

function emitClaudeAgentToolApprovalChunks(
  state: ClaudeAgentChunkMapperState,
  request: ClaudeAgentToolApprovalRequest,
): UIMessageChunk[] {
  const current = state.emittedToolStateByToolCallId.get(request.toolCallId) ?? {
    started: false,
    inputAvailable: false,
  }
  const chunks: UIMessageChunk[] = []
  state.toolNamesByToolCallId.set(request.toolCallId, request.toolName)

  if (!current.started) {
    chunks.push({
      type: 'tool-input-start',
      toolCallId: request.toolCallId,
      toolName: request.toolName,
    })
    current.started = true
  }

  if (!current.inputAvailable) {
    state.toolArgsByToolCallId.set(request.toolCallId, request.toolInput)
    chunks.push({
      type: 'tool-input-available',
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      input: createClaudeCodeToolInputPayload(request.toolName, request.toolInput),
    })
    current.inputAvailable = true
  }

  if (!current.approvalRequested) {
    chunks.push({
      type: 'tool-approval-request',
      toolCallId: request.toolCallId,
      approvalId: request.toolCallId,
    })
    current.approvalRequested = true
  }

  state.emittedToolStateByToolCallId.set(request.toolCallId, current)
  return chunks
}

function readClaudeMessageParentToolUseId(message: SDKMessage): string | null {
  if (!('parent_tool_use_id' in message)) {
    return null
  }
  const parentToolUseId = (message as { parent_tool_use_id?: unknown }).parent_tool_use_id
  return typeof parentToolUseId === 'string' && parentToolUseId.length > 0 ? parentToolUseId : null
}

function readClaudeActiveProviderThreadId(message: SDKMessage): string | null {
  return readClaudeMessageParentToolUseId(message) ?? readClaudeSystemTaskToolUseId(message)
}

function readClaudeSystemTaskToolUseId(message: SDKMessage): string | null {
  if (message.type !== 'system') {
    return null
  }
  switch (message.subtype) {
    case 'task_started':
    case 'task_progress':
    case 'task_notification': {
      const toolUseId = (message as { tool_use_id?: unknown }).tool_use_id
      return typeof toolUseId === 'string' && toolUseId.length > 0 ? toolUseId : null
    }
    default:
      return null
  }
}

function hasTerminalProviderThreadChunk(chunks: UIMessageChunk[]): boolean {
  return chunks.some(chunk => chunk.type === 'finish' || chunk.type === 'error')
}

function readTerminalProviderThreadErrorText(chunks: UIMessageChunk[]): string | null {
  const error = chunks.find((chunk): chunk is Extract<UIMessageChunk, { type: 'error' }> => chunk.type === 'error')
  return error?.errorText ?? null
}

function shouldRouteClaudeMessageToSyntheticTurn(entry: ActiveClaudeQuery, message: SDKMessage): boolean {
  if (entry.currentTurn) {
    return false
  }
  if (entry.syntheticTurn) {
    return true
  }
  if (message.type === 'result') {
    return false
  }
  if (readClaudeMessageParentToolUseId(message)) {
    return true
  }
  if (readClaudeSystemSyntheticEventKind(message)) {
    return true
  }

  switch (message.type as string) {
    case 'assistant':
    case 'stream_event':
    case 'user':
    case 'tool_progress':
      return true
    default:
      return false
  }
}

function readClaudeSystemSyntheticEventKind(message: SDKMessage): string | null {
  if (message.type !== 'system') {
    return null
  }
  switch (message.subtype) {
    case 'task_started':
    case 'task_progress':
    case 'task_notification':
      return message.subtype
    default:
      return null
  }
}

function readClaudeSyntheticProviderThreadId(message: SDKMessage): string | null {
  const parentToolUseId = readClaudeMessageParentToolUseId(message)
  if (parentToolUseId) {
    return parentToolUseId
  }
  if (!('task_id' in message)) {
    return null
  }
  const taskId = (message as { task_id?: unknown }).task_id
  return typeof taskId === 'string' && taskId.length > 0 ? taskId : null
}

function normalizeClaudeSessionTitle(title: string | null | undefined): string | null {
  const normalized = title?.replace(/\s+/g, ' ').trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

function supportsClaudeSubagentSourceKinds(sourceKinds: ProviderThreadListInput['sourceKinds']): boolean {
  return !sourceKinds || sourceKinds.length === 0 || sourceKinds.includes(CLAUDE_SUBAGENT_SOURCE_KIND)
}

function readProviderThreadLimit(limit: number | null | undefined): number {
  return Number.isFinite(limit) && typeof limit === 'number' && limit > 0
    ? Math.floor(limit)
    : DEFAULT_PROVIDER_THREAD_LIMIT
}

function readProviderThreadOffset(cursor: string | null | undefined): number {
  if (!cursor) {
    return 0
  }
  const offset = Number.parseInt(cursor, 10)
  return Number.isFinite(offset) && offset > 0 ? offset : 0
}

function projectClaudeSubagentThread(record: ClaudeSubagentThreadRecord): ProviderThread {
  const parentToolUseId = readClaudeSubagentParentToolUseId(record.messages)
  const providerThreadId = readClaudeSubagentProviderThreadId(record)
  const preview = readClaudeSubagentPreview(record.messages)
  const createdAt = readClaudeSubagentBoundaryTimestamp(record.messages, 'first')
  const updatedAt = readClaudeSubagentBoundaryTimestamp(record.messages, 'last')
  const subagentType = readFirstClaudeSubagentString(record.messages, 'subagent_type')
  const taskDescription = readFirstClaudeSubagentString(record.messages, 'task_description')
  return {
    id: providerThreadId,
    providerSessionTreeId: record.parentSessionId,
    forkedFromId: parentToolUseId,
    preview,
    ephemeral: false,
    modelProvider: readClaudeSubagentModel(record.messages),
    createdAt,
    updatedAt,
    status: 'completed',
    sourceKind: CLAUDE_SUBAGENT_SOURCE_KIND,
    source: {
      type: 'claude-agent-subagent',
      agentId: record.agentId,
      parentToolUseId,
    },
    threadSource: {
      kind: 'claude-agent-transcript',
      parentSessionId: record.parentSessionId,
      agentId: record.agentId,
      parentToolUseId,
    },
    agentNickname: subagentType,
    agentRole: taskDescription,
    name: taskDescription ?? subagentType ?? preview,
    cwd: record.cwd,
  }
}

function readClaudeSubagentProviderThreadId(record: ClaudeSubagentThreadRecord): string {
  return readClaudeSubagentParentToolUseId(record.messages) ?? record.agentId
}

function compareClaudeProviderThreads(
  left: ProviderThread,
  right: ProviderThread,
  sortKey: ProviderThreadListInput['sortKey'],
  sortDirection: ProviderThreadListInput['sortDirection'],
): number {
  const leftValue = sortKey === 'created_at' ? left.createdAt : left.updatedAt
  const rightValue = sortKey === 'created_at' ? right.createdAt : right.updatedAt
  const direction = sortDirection === 'asc' ? 1 : -1
  return ((leftValue ?? 0) - (rightValue ?? 0)) * direction
}

function claudeProviderThreadMatchesSearch(thread: ProviderThread, searchTerm: string): boolean {
  return [
    thread.id,
    thread.forkedFromId,
    readClaudeProviderThreadSourceAgentId(thread.source),
    thread.preview,
    thread.agentNickname,
    thread.agentRole,
    thread.name,
  ].some(value => normalizeProviderThreadText(value)?.includes(searchTerm))
}

function readClaudeProviderThreadSourceAgentId(source: unknown): string | null {
  if (!source || typeof source !== 'object') {
    return null
  }
  const agentId = (source as { agentId?: unknown }).agentId
  return typeof agentId === 'string' ? agentId : null
}

function normalizeProviderThreadText(text: string | null | undefined): string | null {
  const normalized = text?.replace(/\s+/g, ' ').trim().toLowerCase() ?? ''
  return normalized.length > 0 ? normalized : null
}

function readClaudeSubagentParentToolUseId(messages: ClaudeSubagentSessionMessage[]): string | null {
  return messages.find(message => message.parent_tool_use_id)?.parent_tool_use_id ?? null
}

function readClaudeSubagentModel(messages: ClaudeSubagentSessionMessage[]): string | null {
  for (const message of messages) {
    const payload = readClaudeTranscriptPayload(message)
    const model = normalizeProviderThreadText(payload?.model)
    if (model) {
      return payload!.model!
    }
  }
  return null
}

function readFirstClaudeSubagentString(
  messages: ClaudeSubagentSessionMessage[],
  key: 'subagent_type' | 'task_description',
): string | null {
  for (const message of messages) {
    const value = normalizeProviderThreadText(message[key])
    if (value) {
      return message[key]!
    }
  }
  return null
}

function readClaudeSubagentPreview(messages: ClaudeSubagentSessionMessage[]): string | null {
  for (const message of messages) {
    const text = readClaudeMessageText(message)
    if (text) {
      return text.length > 240 ? `${text.slice(0, 237)}...` : text
    }
  }
  return null
}

function readClaudeSubagentBoundaryTimestamp(
  messages: ClaudeSubagentSessionMessage[],
  boundary: 'first' | 'last',
): number | null {
  const ordered = boundary === 'first' ? messages : [...messages].reverse()
  for (const message of ordered) {
    const timestamp = readClaudeSubagentTimestamp(message)
    if (timestamp !== null) {
      return timestamp
    }
  }
  return null
}

function readClaudeSubagentTimestamp(message: ClaudeSubagentSessionMessage): number | null {
  if (!message.timestamp) {
    return null
  }
  const timestamp = Date.parse(message.timestamp)
  return Number.isFinite(timestamp) ? timestamp : null
}

function projectClaudeSubagentEntryTurn(entry: Pick<ClaudeSubagentProjectedEntry, 'agentId' | 'providerThreadId' | 'rawMessages' | 'message'>): ProviderThreadTurn {
  const metadata = readRecord(entry.message.metadata)
  const entryId = typeof metadata.providerMessageId === 'string' ? metadata.providerMessageId : entry.message.id
  const startedAt = readClaudeSubagentTimestamp(entry.rawMessages[0]!)
  const completedAt = readClaudeSubagentTimestamp(entry.rawMessages.at(-1)!)
  return {
    id: entryId,
    status: entry.message.parts.some(part => isClaudeSubagentToolErrorPart(part)) ? 'failed' : 'completed',
    startedAt,
    completedAt,
    durationMs: startedAt !== null && completedAt !== null ? Math.max(0, completedAt - startedAt) : null,
    itemsView: 'full',
    items: entry.rawMessages.map(message => ({
      provider: 'claude-agent',
      providerThreadId: entry.providerThreadId,
      agentId: entry.agentId,
      message,
    })),
  }
}

function projectClaudeSubagentEntries(
  record: ClaudeSubagentThreadRecord,
  messages: ClaudeSubagentSessionMessage[],
  toolSourceMessages: ClaudeSubagentSessionMessage[] = messages,
): ClaudeSubagentProjectedEntry[] {
  const providerThreadId = readClaudeSubagentProviderThreadId(record)
  const toolUseById = collectClaudeSubagentToolUses(toolSourceMessages)
  const entries: ClaudeSubagentProjectedEntry[] = []
  const toolEntryByCallId = new Map<string, ClaudeSubagentProjectedEntry>()

  // The launch prompt is metadata carried on every persisted session message (`task_description`),
  // not a message of its own — so it must be synthesized as a standing entry rather than relying on
  // one of `messages` to happen to render it. Without this, the prompt was only ever visible via the
  // transient live-stream announcement and vanished from history once the subagent produced output.
  const launchPromptEntry = projectClaudeSubagentLaunchPromptEntry(record)
  if (launchPromptEntry) {
    entries.push(launchPromptEntry)
  }

  for (const message of messages) {
    const rawParts = projectClaudeSubagentMessageParts(message, toolUseById)
    if (rawParts.length === 0) {
      continue
    }
    // Claude Code session transcripts can bundle a `tool_use` block and its matching
    // `tool_result` in the very same session message (unlike the raw Anthropic API, where
    // they are always in separate messages). Merge those before cross-message merging below,
    // or the tool call would render as two separate blocks — the input-available one and the
    // output-available one — inside a single chat message.
    const parts = mergeClaudeSubagentToolResultPartsWithinMessage(rawParts)

    const localParts: UIMessage['parts'] = []
    for (const part of parts) {
      const merged = mergeClaudeSubagentToolResultPartIntoEntry(part, message, toolEntryByCallId)
      if (!merged) {
        localParts.push(part)
      }
    }

    if (localParts.length === 0) {
      continue
    }

    const entryMessage: UIMessage = {
      id: `provider-thread:${providerThreadId}:message:${message.uuid}`,
      role: readClaudeSubagentUiRole(message),
      parts: localParts,
      metadata: {
        provider: 'claude-agent',
        providerThreadId,
        agentId: record.agentId,
        providerMessageId: message.uuid,
        providerMessageIds: [message.uuid],
        parentToolUseId: message.parent_tool_use_id,
      },
    }
    const entry: ClaudeSubagentProjectedEntry = {
      providerThreadId,
      agentId: record.agentId,
      turn: {
        id: message.uuid,
        status: 'completed',
        startedAt: readClaudeSubagentTimestamp(message),
        completedAt: readClaudeSubagentTimestamp(message),
        durationMs: null,
        itemsView: 'full',
        items: [{
          provider: 'claude-agent',
          providerThreadId,
          agentId: record.agentId,
          message,
        }],
      },
      message: entryMessage,
      rawMessages: [message],
    }
    entry.turn = projectClaudeSubagentEntryTurn(entry)

    entries.push(entry)
    indexClaudeSubagentToolUseParts(entry, toolEntryByCallId)
  }

  return entries
}

function projectClaudeSubagentLaunchPromptEntry(record: ClaudeSubagentThreadRecord): ClaudeSubagentProjectedEntry | null {
  const promptText = readFirstClaudeSubagentString(record.messages, 'task_description')
  if (!promptText) {
    return null
  }

  const providerThreadId = readClaudeSubagentProviderThreadId(record)
  const startedAt = readClaudeSubagentBoundaryTimestamp(record.messages, 'first')
  const entryId = `${providerThreadId}:launch-prompt`
  const message: UIMessage = {
    id: `provider-thread:${providerThreadId}:message:${entryId}`,
    role: 'user',
    parts: [{ type: 'text', text: promptText, state: 'done' }],
    metadata: {
      provider: 'claude-agent',
      providerThreadId,
      agentId: record.agentId,
      providerMessageId: entryId,
      providerMessageIds: [entryId],
      synthetic: 'launch-prompt',
    },
  }
  return {
    providerThreadId,
    agentId: record.agentId,
    turn: {
      id: entryId,
      status: 'completed',
      startedAt,
      completedAt: startedAt,
      durationMs: null,
      itemsView: 'full',
      items: [],
    },
    message,
    rawMessages: [],
  }
}

function indexClaudeSubagentToolUseParts(
  entry: ClaudeSubagentProjectedEntry,
  toolEntryByCallId: Map<string, ClaudeSubagentProjectedEntry>,
): void {
  for (const part of entry.message.parts) {
    if (isClaudeSubagentToolUsePart(part)) {
      toolEntryByCallId.set(part.toolCallId, entry)
    }
  }
}

/**
 * Merges a `tool_result` part into an earlier `tool_use` part for the same `toolCallId` when
 * both originate from the same raw session message's content blocks. Must run before
 * cross-message merging (`mergeClaudeSubagentToolResultPartIntoEntry`), since that only indexes
 * tool_use parts from messages already fully processed — it can never see a tool_use from the
 * message currently being projected.
 */
function mergeClaudeSubagentToolResultPartsWithinMessage(parts: UIMessage['parts']): UIMessage['parts'] {
  const merged: UIMessage['parts'] = []
  const toolUseIndexByCallId = new Map<string, number>()

  for (const part of parts) {
    if (isClaudeSubagentToolResultPart(part)) {
      const toolUseIndex = toolUseIndexByCallId.get(part.toolCallId)
      const toolUsePart = toolUseIndex !== undefined ? merged[toolUseIndex] : undefined
      if (toolUseIndex !== undefined && toolUsePart && isClaudeSubagentToolUsePart(toolUsePart)) {
        merged[toolUseIndex] = { ...toolUsePart, ...part, input: toolUsePart.input ?? part.input } as UIMessage['parts'][number]
        continue
      }
    }
    if (isClaudeSubagentToolUsePart(part)) {
      toolUseIndexByCallId.set(part.toolCallId, merged.length)
    }
    merged.push(part)
  }

  return merged
}

function mergeClaudeSubagentToolResultPartIntoEntry(
  part: UIMessage['parts'][number],
  message: ClaudeSubagentSessionMessage,
  toolEntryByCallId: Map<string, ClaudeSubagentProjectedEntry>,
): boolean {
  if (!isClaudeSubagentToolResultPart(part)) {
    return false
  }
  const entry = toolEntryByCallId.get(part.toolCallId)
  if (!entry) {
    return false
  }
  entry.message.parts = entry.message.parts.map((candidate) => {
    if (!isClaudeSubagentToolUsePart(candidate) || candidate.toolCallId !== part.toolCallId) {
      return candidate
    }
    return {
      ...candidate,
      ...part,
      input: candidate.input ?? part.input,
    } as UIMessage['parts'][number]
  })
  const providerMessageIds = readProviderMessageIds(entry.message.metadata)
  if (!providerMessageIds.includes(message.uuid)) {
    providerMessageIds.push(message.uuid)
  }
  entry.message.metadata = {
    ...readRecord(entry.message.metadata),
    providerMessageIds,
  }
  entry.rawMessages.push(message)
  entry.turn = projectClaudeSubagentEntryTurn(entry)
  return true
}

function readProviderMessageIds(metadata: UIMessage['metadata']): string[] {
  if (!metadata || typeof metadata !== 'object') {
    return []
  }
  const ids = (metadata as { providerMessageIds?: unknown }).providerMessageIds
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
}

function isClaudeSubagentToolUsePart(part: UIMessage['parts'][number]): part is ClaudeSubagentProjectedToolPart {
  return isClaudeSubagentToolPart(part) && part.state === 'input-available'
}

function isClaudeSubagentToolResultPart(part: UIMessage['parts'][number]): part is ClaudeSubagentProjectedToolPart {
  return isClaudeSubagentToolPart(part) && (part.state === 'output-available' || part.state === 'output-error')
}

function isClaudeSubagentToolErrorPart(part: UIMessage['parts'][number]): part is ClaudeSubagentProjectedToolPart {
  return isClaudeSubagentToolPart(part) && part.state === 'output-error'
}

function isClaudeSubagentToolPart(part: UIMessage['parts'][number]): part is ClaudeSubagentProjectedToolPart {
  return typeof part.type === 'string'
    && part.type.startsWith('tool-')
    && typeof (part as { toolCallId?: unknown }).toolCallId === 'string'
}

function hasClaudeSubagentDisplayParts(message: ClaudeSubagentSessionMessage): boolean {
  return projectClaudeSubagentMessageParts(message, new Map()).length > 0
}

function readClaudeSubagentUiRole(message: ClaudeSubagentSessionMessage): UIMessage['role'] {
  if (hasClaudeSubagentToolResult(message)) {
    return 'assistant'
  }
  return message.type === 'assistant' || message.type === 'system' ? message.type : 'user'
}

function projectClaudeSubagentMessageParts(
  message: ClaudeSubagentSessionMessage,
  toolUseById: Map<string, { toolName: string, input: unknown }>,
): UIMessage['parts'] {
  const payload = readClaudeTranscriptPayload(message)
  if (!payload) {
    return projectClaudeSubagentTextPart(typeof message.message === 'string' ? message.message : null)
  }
  const content = payload.content
  if (typeof content === 'string') {
    return projectClaudeSubagentTextPart(content)
  }
  if (!Array.isArray(content)) {
    return []
  }

  const parts: UIMessage['parts'] = []
  const toolResultCount = content.filter(block => block.type === 'tool_result').length
  for (const block of content) {
    if (block.type === 'text') {
      const text = normalizeProviderThreadRawText(block.text)
      if (text) {
        parts.push({ type: 'text', text, state: 'done' })
      }
      continue
    }
    if (block.type === 'thinking') {
      const thinking = normalizeProviderThreadRawText(block.thinking)
      if (thinking) {
        parts.push({ type: 'reasoning', text: thinking, state: 'done' })
      }
      continue
    }
    if (block.type === 'tool_use') {
      const part = projectClaudeSubagentToolUsePart(block, toolUseById)
      if (part) {
        parts.push(part)
      }
      continue
    }
    if (block.type === 'tool_result') {
      const part = projectClaudeSubagentToolResultPart(message, block, toolResultCount, toolUseById)
      if (part) {
        parts.push(part)
      }
      continue
    }
  }
  return parts
}

function projectClaudeSubagentTextPart(text: string | null): UIMessage['parts'] {
  const normalized = normalizeProviderThreadRawText(text)
  return normalized ? [{ type: 'text', text: normalized, state: 'done' }] : []
}

function readClaudeMessageText(message: ClaudeSubagentSessionMessage): string | null {
  return projectClaudeSubagentMessageParts(message, new Map())
    .flatMap(part => part.type === 'text' || part.type === 'reasoning' ? [part.text] : [])
    .join('\n')
    .trim() || null
}

function collectClaudeSubagentToolUses(
  messages: ClaudeSubagentSessionMessage[],
): Map<string, { toolName: string, input: unknown }> {
  const toolUseById = new Map<string, { toolName: string, input: unknown }>()
  for (const message of messages) {
    const payload = readClaudeTranscriptPayload(message)
    if (!payload || typeof payload.content === 'string' || !Array.isArray(payload.content)) {
      continue
    }
    for (const block of payload.content) {
      if (block.type !== 'tool_use' || !block.id || !block.name) {
        continue
      }
      toolUseById.set(block.id, { toolName: block.name, input: block.input })
    }
  }
  return toolUseById
}

function projectClaudeSubagentToolUsePart(
  block: ClaudeTranscriptContentBlock,
  toolUseById: Map<string, { toolName: string, input: unknown }>,
): UIMessage['parts'][number] | null {
  if (!block.id || !block.name) {
    return null
  }
  toolUseById.set(block.id, { toolName: block.name, input: block.input })
  return {
    type: `tool-${block.name}`,
    toolCallId: block.id,
    state: 'input-available',
    input: createClaudeCodeToolInputPayload(block.name, block.input),
  } as UIMessage['parts'][number]
}

function projectClaudeSubagentToolResultPart(
  message: ClaudeSubagentSessionMessage,
  block: ClaudeTranscriptContentBlock,
  toolResultCount: number,
  toolUseById: Map<string, { toolName: string, input: unknown }>,
): UIMessage['parts'][number] | null {
  if (!block.tool_use_id) {
    return null
  }

  const toolUse = toolUseById.get(block.tool_use_id)
  const toolName = toolUse?.toolName ?? 'Tool'
  const result = normalizeClaudeSubagentToolResultContent(
    readClaudeSubagentToolResultContent(message, block, toolResultCount),
  )
  if (block.is_error) {
    return {
      type: `tool-${toolName}`,
      toolCallId: block.tool_use_id,
      state: 'output-error',
      ...(toolUse ? { input: createClaudeCodeToolInputPayload(toolName, toolUse.input) } : {}),
      errorText: normalizeClaudeSubagentToolErrorText(result),
    } as UIMessage['parts'][number]
  }

  return {
    type: `tool-${toolName}`,
    toolCallId: block.tool_use_id,
    state: 'output-available',
    ...(toolUse ? { input: createClaudeCodeToolInputPayload(toolName, toolUse.input) } : {}),
    output: createClaudeCodeToolResultPayload({
      apiName: toolName,
      args: toolUse?.input,
      result,
    }),
  } as UIMessage['parts'][number]
}

function hasClaudeSubagentToolResult(message: ClaudeSubagentSessionMessage): boolean {
  const payload = readClaudeTranscriptPayload(message)
  return Boolean(
    payload
    && Array.isArray(payload.content)
    && payload.content.some(block => block.type === 'tool_result' && Boolean(block.tool_use_id)),
  )
}

function readClaudeSubagentToolResultContent(
  message: ClaudeSubagentSessionMessage,
  block: ClaudeTranscriptContentBlock,
  toolResultCount: number,
): unknown {
  if (message.tool_use_result !== undefined && toolResultCount === 1) {
    return message.tool_use_result
  }
  return block.content
}

function normalizeClaudeSubagentToolResultContent(content: unknown): unknown {
  if (content == null) {
    return ''
  }
  if (typeof content === 'object') {
    return content
  }
  if (typeof content === 'string') {
    try {
      return JSON.parse(content)
    }
    catch {
      return content
    }
  }
  return String(content)
}

function normalizeClaudeSubagentToolErrorText(output: unknown): string {
  if (typeof output === 'string') {
    return output || 'Tool execution failed'
  }
  if (output == null) {
    return 'Tool execution failed'
  }
  try {
    return JSON.stringify(output)
  }
  catch {
    return String(output)
  }
}

function readClaudeTranscriptPayload(message: ClaudeSubagentSessionMessage): ClaudeTranscriptMessagePayload | null {
  if (typeof message.message === 'string') {
    return null
  }
  const record = readRecord(message.message)
  if (!('content' in record) && !('model' in record)) {
    return null
  }
  return {
    role: typeof record.role === 'string' ? record.role : undefined,
    content: readClaudeTranscriptContent(record.content),
    model: typeof record.model === 'string' ? record.model : undefined,
  }
}

function readClaudeTranscriptContent(value: unknown): ClaudeTranscriptMessagePayload['content'] {
  if (typeof value === 'string') {
    return value
  }
  if (!Array.isArray(value)) {
    return undefined
  }
  return value.map(block => readRecord(block) as ClaudeTranscriptContentBlock)
}

function normalizeProviderThreadRawText(text: string | null | undefined): string | null {
  const normalized = text?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

function mapCrewCallToSnapshot(call: ClaudeAgentCapturedCrewCall): {
  id: string
  agentId: string | null
  tool: string
  prompt: string | null
  description: string | null
  subagentType: string | null
  model: string | null
  reasoningEffort: string | null
  tools: string[]
  outputFile: string | null
  runInBackground: boolean
  status: 'running' | 'completed' | 'failed'
  startedAt: number
  completedAt: number | null
} {
  return {
    id: call.toolCallId,
    agentId: call.agentId,
    tool: call.tool,
    prompt: call.prompt,
    description: call.description,
    subagentType: call.subagentType,
    model: call.model,
    reasoningEffort: call.reasoningEffort,
    tools: call.tools,
    outputFile: call.outputFile,
    runInBackground: call.runInBackground,
    status: call.status,
    startedAt: call.startedAt,
    completedAt: call.completedAt,
  }
}
