import type { Query, SDKContextUsage } from '@anthropic-ai/claude-agent-sdk'
import { query } from '@anthropic-ai/claude-agent-sdk'

import type {
  GetCapabilitiesInput,
  GetContextUsageInput,
  GetUiSlotStatesInput,
  RuntimeCompactUiSlotState,
  RuntimeContextUsage,
  RuntimePresentationCapabilities,
  RuntimeSession,
  RuntimeUiSlotState,
} from '../../chat-runtime/runtime-provider-types'
import { emptyClaudeAgentInput } from './async-input-stream'
import {
  projectClaudeAgentAssistantContextUsage,
  projectClaudeAgentCompactState,
  projectClaudeAgentContextUsage,
} from './context-usage-projector'
import { buildClaudeQueryOptions, createClaudeStderrSink } from './input-projector'
import { projectClaudeAgentPresentation } from './metadata'
import type { ActiveClaudeQuery, ContextUsageRuntimeInput } from './provider-internals'
import {
  projectClaudeAgentCrewUiSlotState,
  projectClaudeAgentPlanUiSlotState,
  projectClaudeAgentProgressUiSlotState,
  projectClaudeAgentToolActivityUiSlotState,
  projectClaudeAgentUsageUiSlotState,
} from './state-projector'
import type { ClaudeAgentProviderDeps } from './types'

const COMPACT_SLOT_CONTEXT_USAGE_TTL_MS = 15_000

export interface ClaudeAgentPresentationContext {
  activeQueries: Map<string, ActiveClaudeQuery>
  deps: ClaudeAgentProviderDeps
}

export class ClaudeAgentPresentation {
  private readonly compactStates = new Map<string, RuntimeCompactUiSlotState>()
  private readonly lastContextUsageBySession = new Map<string, RuntimeContextUsage>()
  private readonly lastContextUsageSampledAtBySession = new Map<string, number>()

  constructor(private readonly context: ClaudeAgentPresentationContext) {}

  async getPresentation(input: GetCapabilitiesInput): Promise<RuntimePresentationCapabilities> {
    const liveEntry = this.context.activeQueries.get(input.runtimeSession.chatSessionId)
    if (liveEntry && !liveEntry.closed) {
      const slashCommands = liveEntry.slashCommands ?? await liveEntry.query.supportedCommands()
      liveEntry.slashCommands = slashCommands
      return projectClaudeAgentPresentation(slashCommands)
    }
    const abortController = new AbortController()
    const stderrSink = createClaudeStderrSink()
    const queryOptions = buildClaudeQueryOptions({
      deps: this.context.deps,
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
    if (planState) { states.push(planState) }
    if (progressState) { states.push(progressState) }
    if (crewState) { states.push(crewState) }
    if (toolActivityState) { states.push(toolActivityState) }
    const usageState = projectClaudeAgentUsageUiSlotState(input.runtimeSession)
    if (usageState) { states.push(usageState) }
    if (compactState) { states.push(compactState) }
    return states
  }

  async getContextUsage(input: GetContextUsageInput): Promise<RuntimeContextUsage | null> {
    return await this.readContextUsage({
      runtimeSession: this.readLiveRuntimeSession(input.runtimeSession),
    })
  }

  captureAssistantContextUsage(
    runtimeSession: RuntimeSession,
    providerSessionId: string,
    response: SDKContextUsage,
  ): void {
    const usage = projectClaudeAgentAssistantContextUsage({
      providerSessionId,
      response,
      updatedAt: Math.floor(Date.now() / 1000),
    })
    this.cacheContextUsage(runtimeSession, usage)
  }

  private readLiveRuntimeSession(runtimeSession: RuntimeSession): RuntimeSession {
    return this.context.activeQueries.get(runtimeSession.chatSessionId)?.runtimeSession
      ?? runtimeSession
  }

  private async readCompactState(
    input: GetUiSlotStatesInput,
  ): Promise<RuntimeCompactUiSlotState | null> {
    const sessionId = input.runtimeSession.chatSessionId
    const cached = this.readFreshCompactState(sessionId)
    if (cached) { return cached }

    try {
      return (await this.refreshCompactState(input)) ?? this.compactStates.get(sessionId) ?? null
    }
    catch {
      return this.compactStates.get(sessionId) ?? null
    }
  }

  private async readContextUsage(
    input: ContextUsageRuntimeInput,
  ): Promise<RuntimeContextUsage | null> {
    const sessionId = input.runtimeSession.chatSessionId
    const entry = this.context.activeQueries.get(sessionId)
    if (!entry) { return this.lastContextUsageBySession.get(sessionId) ?? null }

    const updatedAt = Math.floor(Date.now() / 1000)
    const response = await entry.query.getContextUsage()
    const usage = projectClaudeAgentContextUsage({
      providerSessionId: input.runtimeSession.providerSessionId,
      response,
      updatedAt,
    })
    this.cacheContextUsage(input.runtimeSession, usage)
    return usage
  }

  private cacheContextUsage(runtimeSession: RuntimeSession, usage: RuntimeContextUsage): void {
    const sessionId = runtimeSession.chatSessionId
    this.lastContextUsageBySession.set(sessionId, usage)
    this.lastContextUsageSampledAtBySession.set(sessionId, Date.now())
    this.compactStates.set(sessionId, this.projectCompactState(runtimeSession, usage))
  }

  private readFreshCompactState(sessionId: string): RuntimeCompactUiSlotState | null {
    const compactState = this.compactStates.get(sessionId)
    const sampledAt = this.lastContextUsageSampledAtBySession.get(sessionId)
    if (!compactState || !sampledAt) { return null }
    return Date.now() - sampledAt <= COMPACT_SLOT_CONTEXT_USAGE_TTL_MS ? compactState : null
  }

  async refreshCompactState(
    input: ContextUsageRuntimeInput,
  ): Promise<RuntimeCompactUiSlotState | null> {
    const usage = await this.readContextUsage(input)
    if (!usage) { return null }
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
}

function closeClaudeQuery(activeQuery: Query): void {
  const close = (activeQuery as { close?: unknown }).close
  if (typeof close === 'function') { close.call(activeQuery) }
}
