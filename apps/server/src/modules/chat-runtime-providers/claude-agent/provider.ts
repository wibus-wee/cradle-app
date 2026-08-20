import type { UUID } from 'node:crypto'

import type {
  Options,
  Query,
} from '@anthropic-ai/claude-agent-sdk'
import {
  query,
} from '@anthropic-ai/claude-agent-sdk'
import type { LangfuseGeneration } from '@langfuse/tracing'
import { startObservation } from '@langfuse/tracing'
import type { UIMessage, UIMessageChunk } from 'ai'

import { aiTelemetryEnabled } from '../../../telemetry/config'
import {
  markHarnessFragmentsProjected,
  resolvePendingHarnessFragments,
} from '../../chat-runtime/harness/provider-state'
import { liveRuntimeSessionRegistry } from '../../chat-runtime/runtime-live-session-registry'
import type {
  CancelTurnInput,
  ChatRuntime,
  GenerateSessionTitleInput,
  GetCapabilitiesInput,
  GetContextUsageInput,
  GetUiSlotStatesInput,
  ProviderContext,
  ProviderThreadListInput,
  ProviderThreadListResult,
  ProviderThreadReadInput,
  ProviderThreadReadResult,
  ProviderThreadTurnsInput,
  ProviderThreadTurnsResult,
  QuickQuestionInput,
  ResumeChatSessionInput,
  RuntimeContextUsage,
  RuntimePresentationCapabilities,
  RuntimeSession,
  RuntimeUiSlotState,
  StartChatSessionInput,
  SteerTurnInput,
  StreamTurnInput,
  UpdateRuntimeSettingsInput,
} from '../../chat-runtime/runtime-provider-types'
import {
  ProviderErrors,
  ProviderRuntimeError,
  requireRuntimeProviderTargetProfile,
} from '../../chat-runtime/runtime-provider-types'
import { readTrustedClaudeAgentConfig } from '../../provider-contracts/provider-base'
import { AsyncEventQueue } from '../async-event-queue'
import { createBoundedTextCollector } from '../bounded-text-collector'
import { readWorkspaceProviderStateSnapshot } from '../kit/state-snapshot'
import { ClaudeAgentInputStream } from './async-input-stream'
import type {
  ClaudeCrewLink,
} from './event-to-chunk-mapper'
import {
  createClaudeAgentChunkMapperState,
  resetClaudeAgentChunkMapperForTurn,
} from './event-to-chunk-mapper'
import {
  buildClaudeAgentTurnContent,
  buildClaudeQueryOptions,
  CLAUDE_AGENT_SDK_PERSIST_SESSION,
  createClaudeStderrSink,
  describeClaudeAgentUserContent,
  isClaudeAgentUltracodeEnabled,
  projectClaudeAgentInput,
  readClaudeAgentModelId,
  shouldPersistClaudeAgentSdkSession,
} from './input-projector'
import { ClaudeAgentLiveSettings } from './live-settings'
import { ClaudeAgentMessageDispatch } from './message-dispatch'
import {
  CLAUDE_AGENT_RUNTIME_CAPABILITIES,
  CLAUDE_AGENT_RUNTIME_KIND,
  CLAUDE_AGENT_RUNTIME_METADATA,
} from './metadata'
import {
  createClaudeAgentPermissionBridgeState,
} from './permission-bridge'
import { ClaudeAgentPresentation } from './presentation'
import {
  ClaudeAgentProviderThreadTurns,
} from './projection/provider-thread-turns'
import type {
  ActiveClaudeQuery,
  ActiveClaudeTurn,
} from './provider-internals'
import {
  shouldGenerateClaudeSessionTitle,
} from './provider-title-generation'
import { streamClaudeAgentQuickQuestion } from './quick-question'
import {
  resolveClaudeAgentRuntimeContext,
} from './runtime-context'
import { readClaudeAgentPermissionMode } from './runtime-settings'
import { ClaudeAgentSessionArtifacts } from './session-artifacts'
import {
  CLAUDE_AGENT_RUNTIME_DEFAULT_MODEL_SWITCH_ID,
  clearClaudeAgentCapturedPlan,
  clearClaudeAgentPendingModelSwitch,
  readClaudeAgentPendingModelSwitchId,
  resolveClaudeAgentPendingModelSwitchId,
  writeClaudeAgentPendingModelSwitch,
} from './state-projector'
import type {
  ClaudeAgentProviderDeps,
} from './types'

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
  readonly usageAccounting = 'provider-events' as const
  readonly metadata = CLAUDE_AGENT_RUNTIME_METADATA
  readonly capabilities = CLAUDE_AGENT_RUNTIME_CAPABILITIES

  private readonly activeQueries = new Map<string, ActiveClaudeQuery>()
  private readonly activePermissionModesBySession = new Map<string, Options['permissionMode']>()
  private readonly liveSettings: ClaudeAgentLiveSettings
  private readonly presentation: ClaudeAgentPresentation
  private readonly sessionArtifacts: ClaudeAgentSessionArtifacts
  private readonly providerThreadTurns: ClaudeAgentProviderThreadTurns
  private readonly messageDispatch: ClaudeAgentMessageDispatch

  constructor(private readonly deps: ClaudeAgentProviderDeps) {
    this.liveSettings = new ClaudeAgentLiveSettings({
      activeQueries: this.activeQueries,
      activePermissionModesBySession: this.activePermissionModesBySession,
      deps,
    })
    this.presentation = new ClaudeAgentPresentation({
      activeQueries: this.activeQueries,
      deps,
    })
    this.sessionArtifacts = new ClaudeAgentSessionArtifacts(deps)
    this.providerThreadTurns = new ClaudeAgentProviderThreadTurns({
      activeQueries: this.activeQueries,
      deps,
      sessionArtifacts: this.sessionArtifacts,
    })
    this.messageDispatch = new ClaudeAgentMessageDispatch({
      liveSettings: this.liveSettings,
      providerThreadTurns: this.providerThreadTurns,
      sessionArtifacts: this.sessionArtifacts,
      captureContextUsage: (runtimeSession, providerSessionId, response) =>
        this.presentation.captureAssistantContextUsage(runtimeSession, providerSessionId, response),
      finalizeClaudeUserTurn: (entry, turn, terminalChunk) =>
        this.finalizeClaudeUserTurn(entry, turn, terminalChunk),
    })
  }

  private releaseQuery(sessionId: string, entry: ActiveClaudeQuery): void {
    entry.releaseLiveRuntimeSession()
    if (this.activeQueries.get(sessionId) === entry) {
      this.activeQueries.delete(sessionId)
      this.activePermissionModesBySession.delete(sessionId)
    }
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
    const pendingModelSwitchId
      = CLAUDE_AGENT_SDK_PERSIST_SESSION && input.modelId !== undefined
        ? resolveClaudeAgentPendingModelSwitchId(snapshot, input.modelId)
        : null
    const nextSnapshot = writeClaudeAgentPendingModelSwitch(
      {
        ...snapshot,
        workspacePath: input.workspacePath,
        agentId,
        agentHome: runtimeContext.agentHome,
        models: {
          ...snapshot.models,
          currentModelId:
            input.modelId !== undefined ? input.modelId : snapshot.models.currentModelId,
        },
      },
      pendingModelSwitchId,
    )
    return {
      ...input.runtimeSession,
      providerStateSnapshot: JSON.stringify(nextSnapshot),
    }
  }

  async getPresentation(input: GetCapabilitiesInput): Promise<RuntimePresentationCapabilities> {
    return await this.presentation.getPresentation(input)
  }

  getDraftPresentation(): RuntimePresentationCapabilities {
    return this.presentation.getDraftPresentation()
  }

  getActiveQueryCount(): number {
    return this.activeQueries.size
  }

  async getUiSlotStates(input: GetUiSlotStatesInput): Promise<RuntimeUiSlotState[]> {
    return await this.presentation.getUiSlotStates(input)
  }

  async* quickQuestion(input: QuickQuestionInput): AsyncGenerator<UIMessageChunk, void, void> {
    yield* streamClaudeAgentQuickQuestion(input, this.deps)
  }

  async* streamTurn(input: StreamTurnInput): AsyncGenerator<UIMessageChunk, void, void> {
    const abortController = new AbortController()
    const profile = requireRuntimeProviderTargetProfile(input.profile, this.runtimeKind)
    const config = readTrustedClaudeAgentConfig(profile.configJson)
    const shouldPersistSession = shouldPersistClaudeAgentSdkSession(config.authMode)
    const resumedProviderSessionId = shouldPersistSession
      ? input.runtimeSession.providerSessionId
      : null
    const shouldResumeProviderSession = Boolean(resumedProviderSessionId)
    const effectiveModel = readClaudeAgentModelId(input, config)
    const pendingModelSwitchId = readClaudeAgentPendingModelSwitchId(
      readWorkspaceProviderStateSnapshot(input.runtimeSession.providerStateSnapshot),
    )
    const sessionId = input.runtimeSession.chatSessionId
    let activeEntry = this.activeQueries.get(sessionId)
    if (
      activeEntry
      && (activeEntry.closed
        || !activeEntry.pumpRunning
        || activeEntry.providerTargetId !== profile.providerTargetId)
    ) {
      this.closeSessionQuery(sessionId, activeEntry)
      activeEntry = undefined
    }
    const historyScope = (activeEntry || shouldResumeProviderSession)
      ? 'recentCradleLocal' as const
      : 'full' as const
    const projectedUserContent = projectClaudeAgentInput(input.message, 'Claude Agent provider')
    const userContent = buildClaudeAgentTurnContent({
      userContent: projectedUserContent,
      history: input.history,
      historyScope,
    })
    const userPromptText = describeClaudeAgentUserContent(userContent)
    const turnPermissionMode: Options['permissionMode'] = readClaudeAgentPermissionMode(
      input.providerOptions?.runtimeSettings,
    )
    const ultracodeEnabled = isClaudeAgentUltracodeEnabled(input.providerOptions?.thinkingEffort)
    const permissionBridgeState = activeEntry?.permissionBridgeState ?? createClaudeAgentPermissionBridgeState({
      runtimeInput: input,
      permissionMode: turnPermissionMode,
      runtimeSettings: input.providerOptions?.runtimeSettings,
    })
    // Reuse the long-lived query's stderr sink when the session already exists;
    // otherwise create one for the new query. The sink must outlive the
    // pump loop so it can enrich the surfaced error when the process exits.
    const stderrSink = activeEntry?.stderrSink ?? createClaudeStderrSink()
    if (!activeEntry) {
      const queryOptions = buildClaudeQueryOptions({
        deps: this.deps,
        input,
        abortController,
        attachPermissionHandler: true,
        permissionBridgeState,
        emitToolApprovalRequest: request =>
          this.providerThreadTurns.emitClaudeAgentToolApprovalRequest(sessionId, request),
        onStderr: stderrSink.onStderr,
      })
      this.activePermissionModesBySession.set(sessionId, turnPermissionMode)
      const inputStream = new ClaudeAgentInputStream()
      const activeQuery = query({ prompt: inputStream, options: queryOptions })
      const taskLaunchesById: Map<string, ClaudeCrewLink> = new Map()
      const workflowOutputsByToolCallId: Map<string, Record<string, unknown>> = new Map()
      const workflowLifecyclesByToolCallId: Map<string, Array<Record<string, unknown>>> = new Map()
      let resolveMessageLifecycleSupport!: (supported: boolean) => void
      const messageLifecycleSupport = new Promise<boolean>((resolve) => {
        resolveMessageLifecycleSupport = resolve
      })
      activeEntry = {
        query: activeQuery,
        abortController,
        inputStream,
        mapperState: createClaudeAgentChunkMapperState(
          undefined,
          taskLaunchesById,
          workflowOutputsByToolCallId,
          workflowLifecyclesByToolCallId,
        ),
        taskLaunchesById,
        workflowOutputsByToolCallId,
        workflowLifecyclesByToolCallId,
        slashCommands: null,
        permissionBridgeState,
        runtimeSession: input.runtimeSession,
        providerTargetId: profile.providerTargetId,
        releaseLiveRuntimeSession: () => undefined,
        currentTurn: null,
        mainSyntheticTurn: null,
        providerThreadSyntheticTurns: new Map(),
        providerThreadTurns: new Map(),
        completedProviderThreadParentOutputIds: new Set(),
        onProviderSyntheticTurnEvent: null,
        onUsageEvent: null,
        submittedInputs: new Map(),
        messageLifecycleSupported: null,
        messageLifecycleSupport,
        resolveMessageLifecycleSupport,
        closed: false,
        pumpRunning: true,
        stderrSink,
        ultracodeEnabled,
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
        // Product Composer queue/steer no longer auto-calls these (Synara durable wait).
        // Hooks remain for low-level lifecycle tests and explicit native cancel of in-flight UUIDs.
        submitNativeInput: async ({ queueItemId, message }) => {
          await this.submitNativeInput(sessionId, queueItemId, message)
        },
        cancelNativeInput: async (queueItemId) => {
          return this.cancelNativeInput(sessionId, queueItemId)
        },
        hasNativeInput: (queueItemId) => {
          return this.hasNativeInput(sessionId, queueItemId)
        },
      })
      void this.sessionArtifacts.captureClaudeAgentAccountSnapshot(
        input.runtimeSession,
        activeQuery,
      )
      void this.pumpClaudeSessionQuery(sessionId, activeEntry)
    }
 else {
      if (activeEntry.currentTurn) {
        const existingTurn = activeEntry.currentTurn
        if (!existingTurn.hasProjectedOutput) {
          // Prior turn stayed open after a deferred empty `result` with no follow-on
          // output. Finish it so the next user send can start cleanly.
          this.finalizeClaudeUserTurn(activeEntry, existingTurn, {
            type: 'finish',
            finishReason: 'stop',
          })
        }
 else {
          throw new ProviderRuntimeError(
            ProviderErrors.requestFailed(
              this.runtimeKind,
              'streamTurn',
              `Claude Agent session already has an active turn: ${sessionId}`,
            ),
          )
        }
      }
      await this.liveSettings.updateActiveQueryUltracode({
        runtimeSession: input.runtimeSession,
        enabled: ultracodeEnabled,
      })
      await this.liveSettings.updateActiveQueryPermissionMode({
        runtimeSession: input.runtimeSession,
        mode: turnPermissionMode,
        runtimeInput: input,
        runtimeSettings: input.providerOptions?.runtimeSettings,
      })
      activeEntry.runtimeSession = input.runtimeSession
      resetClaudeAgentChunkMapperForTurn(activeEntry.mapperState)
    }
    const traceMessageId = input.responseMessageId ?? input.message.id

    activeEntry.onProviderSyntheticTurnEvent = input.onProviderSyntheticTurnEvent ?? null
    activeEntry.onUsageEvent = input.onUsageEvent ?? null
    clearClaudeAgentCapturedPlan(input.runtimeSession)

    // Langfuse tracing via @langfuse/tracing SDK
    let generation: LangfuseGeneration | null = null
    if (aiTelemetryEnabled()) {
      generation = startObservation(
        'claude-agent-generation',
        {
          model: effectiveModel,
          input: input.systemPrompt
            ? [
                { role: 'system', content: input.systemPrompt },
                { role: 'user', content: userPromptText },
              ]
            : [{ role: 'user', content: userPromptText }],
        },
        { asType: 'generation' },
      ) as LangfuseGeneration
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
      interruptRequested: false,
      hasProjectedOutput: false,
      deferredEmptyResult: false,
    }
    activeEntry.currentTurn = turn

    try {
      if (pendingModelSwitchId) {
        await activeEntry.query.setModel(
          pendingModelSwitchId === CLAUDE_AGENT_RUNTIME_DEFAULT_MODEL_SWITCH_ID
            ? undefined
            : pendingModelSwitchId,
        )
        clearClaudeAgentPendingModelSwitch(input.runtimeSession)
      }
      if (resumedProviderSessionId) {
        await this.sessionArtifacts.reportClaudeSessionTitle({
          sessionId: resumedProviderSessionId,
          runtimeSession: input.runtimeSession,
          reportSessionTitle: input.reportSessionTitle,
        })
      }

      const pendingHarnessFragments = resolvePendingHarnessFragments(
        input.runtimeSession,
        input.harness?.fragments,
      )
      for (const fragment of pendingHarnessFragments) {
        activeEntry.inputStream.push(fragment.content, {
          isSynthetic: true,
          shouldQuery: false,
          priority: 'next',
        })
      }
      markHarnessFragmentsProjected(input.runtimeSession, pendingHarnessFragments)
      activeEntry.inputStream.push(userContent, { priority: 'next' })
      // Projection persistence is a side effect of accepted input, never a
      // prerequisite for the SDK iterable to receive that input.
      void this.providerThreadTurns.completeClaudeSyntheticTurns(activeEntry)

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
        this.providerThreadTurns.completeClaudeProviderThreadTurns(activeEntry, turn)
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
        await this.messageDispatch.handleClaudeSessionMessage(entry, message)
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
        // Query ended: abort if the user interrupted; otherwise just close the
        // projection queue (no synthetic `finish` — the consumer may already
        // have received a terminal chunk, or tests close the mock mid-turn).
        this.finalizeClaudeUserTurn(
          entry,
          turn,
          turn.interruptRequested ? { type: 'abort', reason: 'user' } : null,
        )
      }
      await this.providerThreadTurns.completeClaudeSyntheticTurns(entry)
      entry.closed = true
      this.releaseSubmittedInputsOnQueryClose(entry)
      this.messageDispatch.resolveMessageLifecycleSupport(entry, false)
      entry.inputStream.close()
      this.releaseQuery(sessionId, entry)
    }
  }

  /**
   * Close the active user UI turn projection. Does not stop the long-lived SDK Query.
   */
  private finalizeClaudeUserTurn(
    entry: ActiveClaudeQuery,
    turn: ActiveClaudeTurn,
    terminalChunk?: UIMessageChunk | null,
  ): void {
    if (entry.currentTurn !== turn) {
      return
    }
    turn.deferredEmptyResult = false
    this.providerThreadTurns.completeClaudeProviderThreadTurns(entry, turn)
    turn.endGeneration()
    entry.currentTurn = null
    if (terminalChunk) {
      turn.queue.push(terminalChunk)
    }
    turn.queue.close()
    void this.presentation.refreshCompactState({ runtimeSession: entry.runtimeSession })
      .catch(() => undefined)
  }

  private closeSessionQuery(sessionId: string, entry: ActiveClaudeQuery): void {
    if (entry.closed) {
      return
    }
    entry.closed = true
    entry.pumpRunning = false
    if (entry.currentTurn) {
      this.providerThreadTurns.completeClaudeProviderThreadTurns(entry, entry.currentTurn)
    }
    this.releaseSubmittedInputsOnQueryClose(entry)
    this.messageDispatch.resolveMessageLifecycleSupport(entry, false)
    entry.abortController.abort()
    entry.inputStream.close()
    closeClaudeQuery(entry.query)
    entry.currentTurn?.queue.close()
    entry.currentTurn = null
    this.releaseQuery(sessionId, entry)
  }

  private releaseSubmittedInputsOnQueryClose(entry: ActiveClaudeQuery): void {
    const uncertainInputs = Array.from(entry.submittedInputs.values())
      .filter(submitted => submitted.state !== 'queued')
      .map(submitted => ({
        queueItemId: submitted.queueItemId,
        outcome: 'failed' as const,
      }))
    entry.submittedInputs.clear()
    if (uncertainInputs.length > 0) {
      liveRuntimeSessionRegistry.markNativeInputsTerminal(
        entry.runtimeSession.chatSessionId,
        uncertainInputs,
      )
    }
  }

  private async submitNativeInput(
    sessionId: string,
    queueItemId: UUID,
    message: UIMessage,
  ): Promise<void> {
    const entry = this.activeQueries.get(sessionId)
    if (!entry || entry.closed || !entry.pumpRunning) {
      throw new ProviderRuntimeError(
        ProviderErrors.requestFailed(
          this.runtimeKind,
          'submitNativeInput',
          `Claude Agent session has no live query to enqueue into: ${sessionId}`,
        ),
      )
    }
    if (entry.submittedInputs.has(queueItemId)) {
      return
    }
    const messageLifecycleSupported = await entry.messageLifecycleSupport
    if (!messageLifecycleSupported || entry.closed || !entry.pumpRunning) {
      throw new ProviderRuntimeError(
        ProviderErrors.requestFailed(
          this.runtimeKind,
          'submitNativeInput',
          `Claude Agent query does not support msg_lifecycle_v1: ${sessionId}`,
        ),
      )
    }
    const userContent = projectClaudeAgentInput(message, 'Claude Agent native queue')
    const messageUuid = entry.inputStream.push(userContent, {
      priority: 'next',
      uuid: queueItemId,
    })
    entry.submittedInputs.set(messageUuid, {
      queueItemId,
      messageUuid,
      state: 'submitted',
    })
  }

  private async cancelNativeInput(sessionId: string, queueItemId: string): Promise<boolean> {
    const entry = this.activeQueries.get(sessionId)
    if (!entry) {
      return false
    }
    const pending = entry.submittedInputs.get(queueItemId)
    if (!pending) {
      return false
    }
    const cancelled = await entry.query.cancelAsyncMessage(pending.messageUuid)
    if (!cancelled) {
      return false
    }
    entry.submittedInputs.delete(queueItemId)
    liveRuntimeSessionRegistry.discardTerminalNativeInput(sessionId, queueItemId)
    return true
  }

  private hasNativeInput(sessionId: string, queueItemId: string): boolean {
    const entry = this.activeQueries.get(sessionId)
    return Boolean(entry?.submittedInputs.has(queueItemId))
  }

  async getContextUsage(input: GetContextUsageInput): Promise<RuntimeContextUsage | null> {
    return await this.presentation.getContextUsage(input)
  }

  /**
   * Legacy mid-turn SDK push. Product steer is Synara-aligned queue-fallback (interrupt +
   * durable front-of-queue). Kept for direct unit coverage of the input stream primitive.
   */
  async steerTurn(input: SteerTurnInput): Promise<void> {
    const sessionId = input.runtimeSession.chatSessionId
    const entry = this.activeQueries.get(sessionId)
    if (!entry || entry.closed || !entry.pumpRunning) {
      throw new ProviderRuntimeError(
        ProviderErrors.requestFailed(
          this.runtimeKind,
          'steerTurn',
          `Claude Agent session has no live query to steer: ${sessionId}`,
        ),
      )
    }
    const userContent = projectClaudeAgentInput(input.message, 'Claude Agent live steer')
    entry.inputStream.push(userContent, {
      priority: 'next',
    })
  }

  async cancelTurn(input: CancelTurnInput): Promise<void> {
    const sessionId = input.runtimeSession.chatSessionId
    const entry = this.activeQueries.get(sessionId)
    if (!entry || entry.closed) {
      return
    }

    const turn = entry.currentTurn
    if (turn) {
      turn.interruptRequested = true
      if (!turn.hasProjectedOutput || turn.deferredEmptyResult) {
        this.finalizeClaudeUserTurn(entry, turn, {
          type: 'abort',
          reason: 'user',
        })
      }
    }
    void entry.query.interrupt().catch(() => {})
    this.closeSessionQuery(sessionId, entry)
  }

  async dispose(): Promise<void> {
    for (const [sessionId, entry] of this.activeQueries) {
      this.closeSessionQuery(sessionId, entry)
    }
  }

  async disposeSession(sessionId: string): Promise<void> {
    const entry = this.activeQueries.get(sessionId)
    if (entry) {
      this.closeSessionQuery(sessionId, entry)
    }
  }

  async listProviderThreads(input: ProviderThreadListInput): Promise<ProviderThreadListResult> {
    return await this.sessionArtifacts.listProviderThreads(input)
  }

  async readProviderThread(input: ProviderThreadReadInput): Promise<ProviderThreadReadResult> {
    return await this.sessionArtifacts.readProviderThread(input)
  }

  async listProviderThreadTurns(
    input: ProviderThreadTurnsInput,
  ): Promise<ProviderThreadTurnsResult> {
    return await this.sessionArtifacts.listProviderThreadTurns(input)
  }

  async updateRuntimeSettings(input: UpdateRuntimeSettingsInput): Promise<void> {
    await this.liveSettings.updateRuntimeSettings(input)
  }

  async generateSessionTitle(input: GenerateSessionTitleInput): Promise<string | null> {
    return await this.sessionArtifacts.generateSessionTitle(input)
  }
}
