import type { ClaudeWorkflowDeclaredAgent } from './declaration-extractor'
import type { ClaudeWorkflowAgentStatus, ClaudeWorkflowEvent } from './event-parser'

export type ClaudeWorkflowArtifactStatus = 'running' | 'completed' | 'failed' | 'stopped'
export type ClaudeWorkflowPhaseStatus = 'pending' | 'running' | 'completed' | 'failed'
export type ClaudeWorkflowAgentAlignment = 'declared' | 'unmatched' | 'inferred' | 'observed'

export interface ClaudeWorkflowArtifactPhase {
  index: number
  title: string
  detail: string | null
  status: ClaudeWorkflowPhaseStatus
  agentCount: number
  completedAgentCount: number
  runningAgentCount: number
  failedAgentCount: number
}

export interface ClaudeWorkflowArtifactAgent {
  id: string
  declarationId: string | null
  index: number | null
  label: string
  phaseIndex: number | null
  phaseTitle: string | null
  alignment: ClaudeWorkflowAgentAlignment
  prompt: string | null
  status: ClaudeWorkflowAgentStatus
  model: string | null
  totalTokens: number | null
  toolUses: number
  lastToolName: string | null
  lastToolSummary: string | null
  queuedAt: number | null
  startedAt: number | null
  updatedAt: number | null
  completedAt: number | null
  durationMs: number | null
  attempt: number | null
  result: unknown
  resultPreview: string | null
}

export interface ClaudeWorkflowArtifactSnapshot {
  type: 'workflow-snapshot'
  workflow: {
    runId: string
    name: string | null
    description: string | null
    status: ClaudeWorkflowArtifactStatus
    startedAt: number
    durationMs: number | null
    result: unknown
    totalTokens: number | null
    totalToolCalls: number | null
    declarationIncomplete: boolean
  }
  phases: ClaudeWorkflowArtifactPhase[]
  currentPhase: ClaudeWorkflowArtifactPhase | null
  agents: ClaudeWorkflowArtifactAgent[]
  logs: string[]
  updatedAt: number
}

interface MutablePhase {
  index: number
  title: string
  detail: string | null
}

interface MutableAgent extends ClaudeWorkflowArtifactAgent {
  authoritative: boolean
  toolCallIds: Set<string>
  transcriptEventIds: Set<string>
}

export interface ClaudeWorkflowStateReducerSeed {
  runId: string
  name: string | null
  description: string | null
  status: ClaudeWorkflowArtifactStatus
  startedAt: number
}

/** Folds declared possibilities and observed Runner facts into one snapshot. */
export class ClaudeWorkflowStateReducer {
  private runId: string
  private name: string | null
  private description: string | null
  private status: ClaudeWorkflowArtifactStatus
  private startedAt: number
  private durationMs: number | null = null
  private result: unknown = null
  private totalTokens: number | null = null
  private totalToolCalls: number | null = null
  private declarationIncomplete = false
  private hasFinalObservation = false
  private currentPhaseIndex: number | null = null
  private updatedAt: number
  private readonly phases = new Map<number, MutablePhase>()
  private readonly declaredAgents = new Map<string, ClaudeWorkflowDeclaredAgent>()
  private readonly agents = new Map<string, MutableAgent>()
  private readonly logs: string[] = []

  constructor(seed: ClaudeWorkflowStateReducerSeed) {
    this.runId = seed.runId
    this.name = seed.name
    this.description = seed.description
    this.status = seed.status
    this.startedAt = seed.startedAt
    this.updatedAt = seed.startedAt
  }

  applyAll(events: ClaudeWorkflowEvent[]): void {
    for (const event of events) { this.apply(event) }
  }

  apply(event: ClaudeWorkflowEvent): void {
    switch (event.kind) {
      case 'workflow-declared':
        this.applyDeclaration(event)
        return
      case 'workflow-observed':
        this.applyWorkflow(event)
        return
      case 'phase-observed':
        this.upsertPhase(event.index, event.title, event.detail)
        this.currentPhaseIndex = event.index
        this.updatedAt = Math.max(this.updatedAt, event.observedAt)
        return
      case 'agent-observed':
        this.applyAgent(event)
        return
      case 'agent-tool-observed':
        this.applyAgentTool(event)
    }
  }

  snapshot(): ClaudeWorkflowArtifactSnapshot {
    const observedAgents = Array.from(this.agents.values(), stripMutableFields)
    const alignedDeclarations = new Set(observedAgents.flatMap(agent => agent.declarationId ? [agent.declarationId] : []))
    const declaredOnlyAgents = (this.hasFinalObservation ? [] : [...this.declaredAgents.values()])
      .filter(agent => !alignedDeclarations.has(agent.declarationId))
      .map(projectDeclaredAgent)
    const agents = [...observedAgents, ...declaredOnlyAgents].sort(compareAgents)
    const phases = [...this.phases.values()]
      .sort((left, right) => left.index - right.index)
      .map(phase => this.projectPhase(phase, agents))
    return {
      type: 'workflow-snapshot',
      workflow: {
        runId: this.runId,
        name: this.name,
        description: this.description,
        status: this.status,
        startedAt: this.startedAt,
        durationMs: this.durationMs,
        result: this.result,
        totalTokens: this.totalTokens,
        totalToolCalls: this.totalToolCalls,
        declarationIncomplete: this.declarationIncomplete,
      },
      phases,
      currentPhase: phases.find(phase => phase.index === this.currentPhaseIndex) ?? null,
      agents,
      logs: [...this.logs],
      updatedAt: this.updatedAt,
    }
  }

  private applyDeclaration(event: Extract<ClaudeWorkflowEvent, { kind: 'workflow-declared' }>): void {
    const declaration = event.declaration
    this.name = declaration.name ?? this.name
    this.description = declaration.description ?? this.description
    this.declarationIncomplete ||= declaration.incomplete
    for (const phase of declaration.phases) { this.upsertPhase(phase.index, phase.title, phase.detail) }
    for (const agent of declaration.agents) { this.declaredAgents.set(agent.declarationId, agent) }
    this.reconcileAllAgents()
    this.updatedAt = Math.max(this.updatedAt, event.observedAt)
  }

  private applyWorkflow(event: Extract<ClaudeWorkflowEvent, { kind: 'workflow-observed' }>): void {
    this.runId = event.runId ?? this.runId
    this.name = event.name ?? this.name
    this.description = event.description ?? this.description
    this.status = event.status ?? this.status
    this.hasFinalObservation ||= event.status === 'completed' || event.status === 'failed' || event.status === 'stopped'
    this.startedAt = event.startedAt ?? this.startedAt
    this.durationMs = event.durationMs ?? this.durationMs
    this.result = event.result ?? this.result
    this.totalTokens = event.totalTokens ?? this.totalTokens
    this.totalToolCalls = event.totalToolCalls ?? this.totalToolCalls
    for (const phase of event.declaredPhases) { this.upsertPhase(phase.index, phase.title, phase.detail) }
    for (const message of event.logs) { if (!this.logs.includes(message)) { this.logs.push(message) } }
    const completedAt = event.startedAt !== null && event.durationMs !== null
      ? event.startedAt + event.durationMs
      : event.startedAt
    this.updatedAt = Math.max(this.updatedAt, completedAt ?? this.updatedAt)
  }

  private applyAgent(event: Extract<ClaudeWorkflowEvent, { kind: 'agent-observed' }>): void {
    const agent = this.ensureAgent(event.agentId)
    const acceptsStats = event.authoritative || !agent.authoritative
    agent.authoritative ||= event.authoritative
    agent.index = event.index ?? agent.index
    agent.label = event.label ?? agent.label
    agent.phaseIndex = event.phaseIndex ?? agent.phaseIndex
    agent.phaseTitle = event.phaseTitle ?? agent.phaseTitle
    agent.prompt = event.prompt ?? agent.prompt
    agent.status = event.status ?? agent.status
    agent.model = event.model ?? agent.model
    agent.queuedAt = event.queuedAt ?? agent.queuedAt
    agent.startedAt = event.startedAt ?? agent.startedAt
    agent.updatedAt = event.updatedAt ?? agent.updatedAt
    agent.completedAt = event.completedAt ?? agent.completedAt
    agent.durationMs = event.durationMs ?? agent.durationMs
    agent.attempt = event.attempt ?? agent.attempt
    agent.lastToolName = event.lastToolName ?? agent.lastToolName
    agent.lastToolSummary = event.lastToolSummary ?? agent.lastToolSummary
    agent.result = event.result ?? agent.result
    agent.resultPreview = event.resultPreview ?? agent.resultPreview
    if (acceptsStats) {
      agent.totalTokens = event.totalTokens ?? agent.totalTokens
      agent.toolUses = event.toolUses ?? agent.toolUses
    }
    if (event.authoritative) {
      agent.alignment = 'observed'
      this.reconcileAuthoritativeAgent(agent)
    }
    else if (event.prompt !== null) {
      this.reconcilePromptAgent(agent)
    }
    if (agent.phaseIndex !== null && agent.phaseTitle !== null) { this.upsertPhase(agent.phaseIndex, agent.phaseTitle, null) }
    if (agent.status === 'running' && agent.phaseIndex !== null) { this.currentPhaseIndex = agent.phaseIndex }
    this.updatedAt = Math.max(this.updatedAt, event.updatedAt ?? event.observedAt)
  }

  private applyAgentTool(event: Extract<ClaudeWorkflowEvent, { kind: 'agent-tool-observed' }>): void {
    const agent = this.ensureAgent(event.agentId)
    if (agent.transcriptEventIds.has(event.eventId)) { return }
    agent.transcriptEventIds.add(event.eventId)
    for (const id of event.toolCallIds) { agent.toolCallIds.add(id) }
    agent.lastToolName = event.lastToolName ?? agent.lastToolName
    agent.model = event.model ?? agent.model
    agent.updatedAt = event.updatedAt ?? agent.updatedAt
    if (!agent.authoritative) {
      agent.totalTokens = event.totalTokens === null ? agent.totalTokens : Math.max(agent.totalTokens ?? 0, event.totalTokens)
      agent.toolUses = agent.toolCallIds.size
    }
    this.updatedAt = Math.max(this.updatedAt, event.updatedAt ?? event.observedAt)
  }

  private reconcileAllAgents(): void {
    for (const agent of this.agents.values()) {
      if (agent.authoritative) { this.reconcileAuthoritativeAgent(agent) }
      else { this.reconcilePromptAgent(agent) }
    }
  }

  private reconcilePromptAgent(agent: MutableAgent): void {
    if (!agent.prompt || agent.declarationId) { return }
    const alreadyAligned = new Set([...this.agents.values()].flatMap(item => item.declarationId ? [item.declarationId] : []))
    const candidates = [...this.declaredAgents.values()].filter(candidate => (
      !alreadyAligned.has(candidate.declarationId) && candidate.prompt === agent.prompt
    ))
    if (candidates.length === 1) { this.alignAgent(agent, candidates[0]!, 'inferred') }
  }

  private reconcileAuthoritativeAgent(agent: MutableAgent): void {
    if (agent.declarationId) { return }
    const candidates = [...this.declaredAgents.values()].filter(candidate => (
      (candidate.label === agent.label || candidate.prompt === agent.prompt)
      && (agent.phaseIndex === null || candidate.phaseIndex === agent.phaseIndex)
    ))
    if (candidates.length === 1) { this.alignAgent(agent, candidates[0]!, 'observed') }
  }

  private alignAgent(
    agent: MutableAgent,
    declaration: ClaudeWorkflowDeclaredAgent,
    alignment: 'inferred' | 'observed',
  ): void {
    agent.declarationId = declaration.declarationId
    agent.index = declaration.index
    agent.label = declaration.label ?? agent.label
    agent.phaseIndex = declaration.phaseIndex
    agent.phaseTitle = declaration.phaseTitle
    agent.alignment = alignment
  }

  private ensureAgent(id: string): MutableAgent {
    const existing = this.agents.get(id)
    if (existing) { return existing }
    const next: MutableAgent = {
      id,
      declarationId: null,
      index: null,
      label: `agent:${id.slice(0, 8)}`,
      phaseIndex: null,
      phaseTitle: null,
      alignment: 'unmatched',
      prompt: null,
      status: 'pending',
      model: null,
      totalTokens: null,
      toolUses: 0,
      lastToolName: null,
      lastToolSummary: null,
      queuedAt: null,
      startedAt: null,
      updatedAt: null,
      completedAt: null,
      durationMs: null,
      attempt: null,
      result: null,
      resultPreview: null,
      authoritative: false,
      toolCallIds: new Set(),
      transcriptEventIds: new Set(),
    }
    this.agents.set(id, next)
    return next
  }

  private upsertPhase(index: number, title: string, detail: string | null): void {
    const existing = this.phases.get(index)
    this.phases.set(index, { index, title, detail: detail ?? existing?.detail ?? null })
  }

  private projectPhase(phase: MutablePhase, agents: ClaudeWorkflowArtifactAgent[]): ClaudeWorkflowArtifactPhase {
    const phaseAgents = agents.filter(agent => agent.phaseIndex === phase.index)
    return {
      ...phase,
      status: this.readPhaseStatus(phase.index),
      agentCount: phaseAgents.length,
      completedAgentCount: phaseAgents.filter(agent => agent.status === 'completed' || agent.status === 'skipped').length,
      runningAgentCount: phaseAgents.filter(agent => agent.status === 'running').length,
      failedAgentCount: phaseAgents.filter(agent => agent.status === 'failed').length,
    }
  }

  private readPhaseStatus(index: number): ClaudeWorkflowPhaseStatus {
    if (this.status === 'completed') { return 'completed' }
    if ((this.status === 'failed' || this.status === 'stopped') && index === this.currentPhaseIndex) { return 'failed' }
    if (this.currentPhaseIndex === null || index > this.currentPhaseIndex) { return 'pending' }
    return index === this.currentPhaseIndex ? 'running' : 'completed'
  }
}

function projectDeclaredAgent(agent: ClaudeWorkflowDeclaredAgent): ClaudeWorkflowArtifactAgent {
  return {
    id: agent.declarationId,
    declarationId: agent.declarationId,
    index: agent.index,
    label: agent.label ?? `Agent ${agent.index}`,
    phaseIndex: agent.phaseIndex,
    phaseTitle: agent.phaseTitle,
    alignment: 'declared',
    prompt: agent.prompt,
    status: 'pending',
    model: null,
    totalTokens: null,
    toolUses: 0,
    lastToolName: null,
    lastToolSummary: null,
    queuedAt: null,
    startedAt: null,
    updatedAt: null,
    completedAt: null,
    durationMs: null,
    attempt: null,
    result: null,
    resultPreview: null,
  }
}

function compareAgents(left: ClaudeWorkflowArtifactAgent, right: ClaudeWorkflowArtifactAgent): number {
  if (left.index !== null && right.index !== null) { return left.index - right.index }
  if (left.index !== null) { return -1 }
  if (right.index !== null) { return 1 }
  return (left.startedAt ?? Number.MAX_SAFE_INTEGER) - (right.startedAt ?? Number.MAX_SAFE_INTEGER)
}

function stripMutableFields(agent: MutableAgent): ClaudeWorkflowArtifactAgent {
  const { authoritative: _a, toolCallIds: _t, transcriptEventIds: _e, ...snapshot } = agent
  return snapshot
}
