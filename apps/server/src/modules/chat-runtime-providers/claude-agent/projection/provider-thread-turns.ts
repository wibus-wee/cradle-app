import { randomUUID } from 'node:crypto'

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { UIMessageChunk } from 'ai'

import {
  bindHarnessProjectionToProviderSession,
} from '../../../chat-runtime/harness/provider-state'
import type {
  ProviderSyntheticTurnEvent,
  ProviderThreadEvent,
} from '../../../chat-runtime/runtime-provider-types'
import { requireRuntimeProviderTargetProfile } from '../../../chat-runtime/runtime-provider-types'
import { recordRuntimeUsageEvent } from '../../../usage/ingest'
import { providerChunk } from '../../kit/chunk-mapper'
import { readWorkspaceProviderStateSnapshot } from '../../kit/state-snapshot'
import type {
  ClaudeAgentCapturedCrewCall,
  ClaudeAgentChunkMapperState,
} from '../event-to-chunk-mapper'
import {
  createClaudeAgentChunkMapperState,
  mapClaudeAgentMessageToChunksWithoutParentProjection,
} from '../event-to-chunk-mapper'
import type { ClaudeAgentToolApprovalRequest } from '../permission-bridge'
import type {
  ActiveClaudeProviderThreadTurn,
  ActiveClaudeQuery,
  ActiveClaudeSyntheticTurn,
  ActiveClaudeTurn,
} from '../provider-internals'
import type { ClaudeAgentSessionArtifacts } from '../session-artifacts'
import {
  readClaudeAgentCrewProviderThreadIdForAgent,
  writeClaudeAgentCrewCall,
  writeClaudeAgentTaskActivity,
  writeClaudeAgentWorkflowExecution,
} from '../state-projector'
import { ClaudeCodeToolName } from '../tools/identity'
import {
  createClaudeCodeToolInputPayload,
  createClaudeCodeToolResultPayload,
} from '../tools/mapper'
import type { ClaudeAgentProviderDeps } from '../types'
import { projectClaudeAssistantUsageEvent } from '../usage-event-projector'

export interface ClaudeAgentProviderThreadTurnsContext {
  activeQueries: Map<string, ActiveClaudeQuery>
  deps: ClaudeAgentProviderDeps
  sessionArtifacts: ClaudeAgentSessionArtifacts
}

export class ClaudeAgentProviderThreadTurns {
  readonly runtimeKind = 'claude-agent' as const

  constructor(private readonly context: ClaudeAgentProviderThreadTurnsContext) {}

  private get activeQueries(): Map<string, ActiveClaudeQuery> {
    return this.context.activeQueries
  }

  private get deps(): ClaudeAgentProviderDeps {
    return this.context.deps
  }

  private get sessionArtifacts(): ClaudeAgentSessionArtifacts {
    return this.context.sessionArtifacts
  }

  async handleClaudeProviderThreadMessage(
    entry: ActiveClaudeQuery,
    turn: ActiveClaudeTurn,
    providerThreadId: string,
    message: SDKMessage,
  ): Promise<void> {
    const providerThreadTurn = this.ensureClaudeProviderThreadTurn(entry, providerThreadId)
    const result = await mapClaudeAgentMessageToChunksWithoutParentProjection(
      message,
      providerThreadTurn.mapperState,
    )
    await this.emitClaudeAssistantUsageEvent(entry, message, turn.effectiveModel)
    for (const crewCall of result.capturedCrewCalls) {
      writeClaudeAgentCrewCall(entry.runtimeSession, mapCrewCallToSnapshot(crewCall))
      if (crewCall.workflow) {
        writeClaudeAgentWorkflowExecution(entry.runtimeSession, crewCall.workflow)
      }
    }
    for (const taskActivity of result.capturedTaskActivity) {
      writeClaudeAgentTaskActivity(entry.runtimeSession, taskActivity)
    }
    this.publishClaudeProviderThreadEvent(turn, providerThreadTurn, result.chunks)
    if (hasTerminalProviderThreadChunk(result.chunks)) {
      this.emitClaudeProviderThreadParentOutput(entry, turn, providerThreadId, result.chunks)
      providerThreadTurn.terminal = true
      entry.providerThreadTurns.delete(providerThreadId)
    }
  }

  ensureClaudeProviderThreadTurn(
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
      mapperState: createClaudeAgentChunkMapperState(
        `provider-thread:${providerThreadId}`,
        entry.taskLaunchesById,
        entry.workflowOutputsByToolCallId,
        entry.workflowLifecyclesByToolCallId,
      ),
      terminal: false,
    }
    entry.providerThreadTurns.set(providerThreadId, providerThreadTurn)
    return providerThreadTurn
  }

  publishClaudeProviderThreadEvent(
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

  completeClaudeProviderThreadTurns(
    entry: ActiveClaudeQuery,
    turn: ActiveClaudeTurn,
  ): void {
    for (const providerThreadTurn of entry.providerThreadTurns.values()) {
      const chunks: UIMessageChunk[] = [providerChunk.finish('stop')]
      this.publishClaudeProviderThreadEvent(turn, providerThreadTurn, chunks)
      this.emitClaudeProviderThreadParentOutput(
        entry,
        turn,
        providerThreadTurn.providerThreadId,
        chunks,
      )
      providerThreadTurn.terminal = true
    }
    entry.providerThreadTurns.clear()
  }

  emitClaudeProviderThreadParentOutput(
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
      turn.hasProjectedOutput = true
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
    turn.hasProjectedOutput = true
  }

  emitClaudeAgentToolApprovalRequest(
    sessionId: string,
    request: ClaudeAgentToolApprovalRequest,
  ): void {
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
      turn.hasProjectedOutput = true
    }
  }

  resolveClaudeToolApprovalProviderThreadTurn(
    entry: ActiveClaudeQuery,
    request: ClaudeAgentToolApprovalRequest,
  ): ActiveClaudeProviderThreadTurn | null {
    if (!request.agentId) {
      return null
    }

    const mappedProviderThreadId = readClaudeAgentCrewProviderThreadIdForAgent(
      entry.runtimeSession,
      request.agentId,
    )
    if (mappedProviderThreadId) {
      return this.ensureClaudeProviderThreadTurn(entry, mappedProviderThreadId)
    }

    const providerThreadTurn = entry.providerThreadTurns.get(request.agentId)
    if (providerThreadTurn) {
      return providerThreadTurn
    }

    return null
  }

  async handleClaudeSyntheticSessionMessage(
    entry: ActiveClaudeQuery,
    message: SDKMessage,
  ): Promise<void> {
    const providerThreadId = readClaudeMessageParentToolUseId(message)
    if (providerThreadId) {
      const syntheticTurn = this.ensureClaudeProviderThreadSyntheticTurn(entry, providerThreadId)
      if (!syntheticTurn) {
        return
      }

      const result = await mapClaudeAgentMessageToChunksWithoutParentProjection(
        message,
        syntheticTurn.mapperState,
      )
      // Never block the long-lived SDK pump on synthetic-run persistence. Synthetic
      // handlers may wait for the parent Cradle run to finish; awaiting that here
      // freezes handleClaudeSessionMessage and starves the next streamTurn's
      // currentTurn of chunks (zombie streaming runs).
      this.enqueueClaudeSyntheticTurnEvent(entry, syntheticTurn, result.chunks)
      if (message.type === 'result') {
        entry.providerThreadSyntheticTurns.delete(providerThreadId)
      }
      return
    }

    // Task lifecycle notifications update Cradle's provider-owned crew/task snapshots above.
    // They do not own the main Claude conversation. In particular, `task_id` identifies the
    // completed background task, not the assistant turn that Claude may generate afterwards.
    if (readClaudeSystemSyntheticEventKind(message)) {
      return
    }

    if (!shouldRouteClaudeMessageToMainSyntheticTurn(entry, message)) {
      return
    }

    const syntheticTurn = this.ensureClaudeMainSyntheticTurn(entry)
    if (!syntheticTurn) {
      return
    }

    const result = await mapClaudeAgentMessageToChunksWithoutParentProjection(
      message,
      syntheticTurn.mapperState,
    )
    this.enqueueClaudeSyntheticTurnEvent(entry, syntheticTurn, result.chunks)
    if (message.type === 'result') {
      entry.mainSyntheticTurn = null
    }
  }

  ensureClaudeMainSyntheticTurn(
    entry: ActiveClaudeQuery,
  ): ActiveClaudeSyntheticTurn | null {
    if (entry.mainSyntheticTurn) {
      return entry.mainSyntheticTurn
    }
    const onProviderSyntheticTurnEvent = entry.onProviderSyntheticTurnEvent
    if (!onProviderSyntheticTurnEvent) {
      return null
    }

    const syntheticTurn: ActiveClaudeSyntheticTurn = {
      providerTurnId: `claude-synthetic-${randomUUID()}`,
      providerThreadId: null,
      mapperState: createClaudeAgentChunkMapperState(
        undefined,
        entry.taskLaunchesById,
        entry.workflowOutputsByToolCallId,
        entry.workflowLifecyclesByToolCallId,
      ),
      onProviderSyntheticTurnEvent,
    }
    entry.mainSyntheticTurn = syntheticTurn
    return syntheticTurn
  }

  ensureClaudeProviderThreadSyntheticTurn(
    entry: ActiveClaudeQuery,
    providerThreadId: string,
  ): ActiveClaudeSyntheticTurn | null {
    const existing = entry.providerThreadSyntheticTurns.get(providerThreadId)
    if (existing) {
      return existing
    }
    const onProviderSyntheticTurnEvent = entry.onProviderSyntheticTurnEvent
    if (!onProviderSyntheticTurnEvent) {
      return null
    }

    const syntheticTurn: ActiveClaudeSyntheticTurn = {
      providerTurnId: `claude-synthetic-${randomUUID()}`,
      providerThreadId,
      mapperState: createClaudeAgentChunkMapperState(
        undefined,
        entry.taskLaunchesById,
        entry.workflowOutputsByToolCallId,
        entry.workflowLifecyclesByToolCallId,
      ),
      onProviderSyntheticTurnEvent,
    }
    entry.providerThreadSyntheticTurns.set(providerThreadId, syntheticTurn)
    return syntheticTurn
  }

  async completeClaudeSyntheticTurns(entry: ActiveClaudeQuery): Promise<void> {
    const syntheticTurns = [
      ...(entry.mainSyntheticTurn ? [entry.mainSyntheticTurn] : []),
      ...entry.providerThreadSyntheticTurns.values(),
    ]
    entry.mainSyntheticTurn = null
    entry.providerThreadSyntheticTurns.clear()

    for (const syntheticTurn of syntheticTurns) {
      // Query teardown can still await terminal synthetic finish — pump is already
      // exiting, so blocking here does not starve an active streamTurn.
      await this.publishClaudeSyntheticTurnEvent(entry, syntheticTurn, [
        providerChunk.finish('stop'),
      ])
    }
  }

  /**
   * Schedule synthetic-turn publishing without blocking the SDK pump. The synthetic
   * handler may `waitForRunCompletion` on the parent Cradle run; awaiting that on the
   * pump freezes all subsequent SDK message handling.
   */
  enqueueClaudeSyntheticTurnEvent(
    entry: ActiveClaudeQuery,
    syntheticTurn: ActiveClaudeSyntheticTurn,
    chunks: UIMessageChunk[],
  ): void {
    if (chunks.length === 0) {
      return
    }
    void this.publishClaudeSyntheticTurnEvent(entry, syntheticTurn, chunks)
  }

  async publishClaudeSyntheticTurnEvent(
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

  async updateClaudeTurnProviderSession(
    entry: ActiveClaudeQuery,
    turn: ActiveClaudeTurn,
    sessionId: string | null,
  ): Promise<void> {
    const nextProviderSessionId
      = turn.shouldPersistSession && sessionId && sessionId !== entry.runtimeSession.providerSessionId
        ? sessionId
        : null
    if (!nextProviderSessionId) {
      return
    }

    entry.runtimeSession.providerSessionId = nextProviderSessionId
    turn.input.runtimeSession.providerSessionId = nextProviderSessionId
    bindHarnessProjectionToProviderSession(entry.runtimeSession, nextProviderSessionId)
    await this.sessionArtifacts.reportClaudeSessionTitle({
      sessionId: nextProviderSessionId,
      runtimeSession: entry.runtimeSession,
      reportSessionTitle: turn.input.reportSessionTitle,
    })

    if (!turn.shouldGenerateTitle) {
      return
    }

    const snapshot = readWorkspaceProviderStateSnapshot(entry.runtimeSession.providerStateSnapshot)
    const titleGeneration = this.sessionArtifacts.resolveClaudeSessionTitleGenerationConfig({
      currentProfile: requireRuntimeProviderTargetProfile(turn.input.profile, this.runtimeKind),
      fallbackModel: turn.effectiveModel ?? null,
    })
    this.sessionArtifacts.generateClaudeSessionTitleInBackground({
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

  async emitClaudeAssistantUsageEvent(
    entry: ActiveClaudeQuery,
    message: SDKMessage,
    fallbackModelId: string | null | undefined,
  ): Promise<void> {
    let event: ReturnType<typeof projectClaudeAssistantUsageEvent>
    try {
      event = projectClaudeAssistantUsageEvent({
        message,
        fallbackModelId,
      })
    }
    catch (error) {
      this.deps.logger?.warn?.('Claude Agent ignored malformed assistant usage event', {
        error,
        chatSessionId: entry.runtimeSession.chatSessionId,
      })
      return
    }
    if (!event) {
      return
    }
    if (entry.currentTurn && entry.onUsageEvent) {
      await entry.onUsageEvent(event)
      return
    }

    const providerSessionId = entry.runtimeSession.providerSessionId
    if (!providerSessionId) {
      this.deps.logger?.warn?.('Claude Agent late assistant usage event arrived before provider session binding', {
        chatSessionId: entry.runtimeSession.chatSessionId,
        providerThreadId: event.providerThreadId,
        providerTurnId: event.providerTurnId,
      })
      return
    }
    try {
      recordRuntimeUsageEvent({
        event,
        sessionId: entry.runtimeSession.chatSessionId,
        runId: null,
        messageId: null,
        providerTargetId: entry.providerTargetId,
        providerSessionId,
      })
    }
    catch (error) {
      this.deps.logger?.warn?.('Claude Agent failed to persist late assistant usage event', {
        error,
        chatSessionId: entry.runtimeSession.chatSessionId,
        providerSessionId,
        providerThreadId: event.providerThreadId,
        providerTurnId: event.providerTurnId,
      })
    }
  }
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

export function readClaudeMessageParentToolUseId(message: SDKMessage): string | null {
  if (!('parent_tool_use_id' in message)) {
    return null
  }
  const parentToolUseId = (message as { parent_tool_use_id?: unknown }).parent_tool_use_id
  return typeof parentToolUseId === 'string' && parentToolUseId.length > 0 ? parentToolUseId : null
}

export function readClaudeActiveProviderThreadId(message: SDKMessage): string | null {
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
  const error = chunks.find(
    (chunk): chunk is Extract<UIMessageChunk, { type: 'error' }> => chunk.type === 'error',
  )
  return error?.errorText ?? null
}

function shouldRouteClaudeMessageToMainSyntheticTurn(
  entry: ActiveClaudeQuery,
  message: SDKMessage,
): boolean {
  if (entry.currentTurn) {
    return false
  }
  if (entry.mainSyntheticTurn) {
    return true
  }
  if (message.type === 'result') {
    return false
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

export function mapCrewCallToSnapshot(call: ClaudeAgentCapturedCrewCall): {
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
