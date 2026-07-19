import { readObjectRecord as readRecord } from '../../../../helpers/json-record'
import type { ClaudeWorkflowDeclaration, ClaudeWorkflowDeclaredPhase } from './declaration-extractor'

export type ClaudeWorkflowAgentStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'

export type ClaudeWorkflowEvent
  = | { kind: 'workflow-declared', declaration: ClaudeWorkflowDeclaration, observedAt: number }
    | {
      kind: 'workflow-observed'
      runId: string | null
      name: string | null
      description: string | null
      status: 'running' | 'completed' | 'failed' | 'stopped' | null
      startedAt: number | null
      durationMs: number | null
      result: unknown
      totalTokens: number | null
      totalToolCalls: number | null
      declaredPhases: ClaudeWorkflowDeclaredPhase[]
      logs: string[]
    }
    | { kind: 'phase-observed', index: number, title: string, detail: string | null, observedAt: number }
    | {
      kind: 'agent-observed'
      agentId: string
      index: number | null
      label: string | null
      phaseIndex: number | null
      phaseTitle: string | null
      status: ClaudeWorkflowAgentStatus | null
      model: string | null
      prompt: string | null
      queuedAt: number | null
      startedAt: number | null
      updatedAt: number | null
      completedAt: number | null
      durationMs: number | null
      attempt: number | null
      totalTokens: number | null
      toolUses: number | null
      lastToolName: string | null
      lastToolSummary: string | null
      result: unknown
      resultPreview: string | null
      authoritative: boolean
      observedAt: number
    }
    | {
      kind: 'agent-tool-observed'
      agentId: string
      eventId: string
      toolCallIds: string[]
      lastToolName: string | null
      model: string | null
      totalTokens: number | null
      updatedAt: number | null
      observedAt: number
    }

export interface ClaudeWorkflowEventContext {
  source: 'workflow-output' | 'journal' | 'agent-transcript'
  agentId?: string
  observedAt?: number
}

/** Decode one JSONL line and normalize provider records at the ownership edge. */
export function parseClaudeWorkflowJsonlLine(
  line: string,
  context: ClaudeWorkflowEventContext,
): ClaudeWorkflowEvent[] {
  return normalizeClaudeWorkflowRecord(JSON.parse(line) as unknown, context)
}

export function normalizeClaudeWorkflowRecord(
  value: unknown,
  context: ClaudeWorkflowEventContext,
): ClaudeWorkflowEvent[] {
  const record = readRecord(value)
  const observedAt = context.observedAt ?? Date.now()
  if (context.source === 'workflow-output') {
    return normalizeWorkflowOutput(record, observedAt)
  }
  if (context.source === 'journal') {
    return normalizeJournalRecord(record, observedAt)
  }
  return normalizeTranscriptRecord(record, context.agentId, observedAt)
}

function normalizeWorkflowOutput(record: Record<string, unknown>, observedAt: number): ClaudeWorkflowEvent[] {
  const phases = readDeclaredPhases(record.phases)
  const events: ClaudeWorkflowEvent[] = [{
    kind: 'workflow-observed',
    runId: readString(record.runId),
    name: readString(record.workflowName),
    description: readString(record.summary),
    status: readWorkflowStatus(record.status),
    startedAt: readNumber(record.startTime),
    durationMs: readNumber(record.durationMs),
    result: Object.hasOwn(record, 'result') ? record.result : null,
    totalTokens: readNumber(record.totalTokens),
    totalToolCalls: readNumber(record.totalToolCalls),
    declaredPhases: phases,
    logs: readStrings(record.logs),
  }]
  const progress = Array.isArray(record.workflowProgress) ? record.workflowProgress : []
  for (const item of progress) {
    events.push(...normalizeProgressRecord(readRecord(item), phases, observedAt))
  }
  return events
}

function normalizeProgressRecord(
  record: Record<string, unknown>,
  phases: ClaudeWorkflowDeclaredPhase[],
  observedAt: number,
): ClaudeWorkflowEvent[] {
  if (record.type === 'workflow_phase') {
    const index = readNumber(record.index)
    const title = readString(record.title)
    return index !== null && title
      ? [{
          kind: 'phase-observed',
          index,
          title,
          detail: phases.find(phase => phase.index === index)?.detail ?? null,
          observedAt,
        }]
      : []
  }
  if (record.type !== 'workflow_agent') {
    return []
  }
  const agentId = readString(record.agentId)
  if (!agentId) {
    return []
  }
  const status = readAgentStatus(record.state)
  const startedAt = readNumber(record.startedAt)
  const durationMs = readNumber(record.durationMs)
  return [{
    kind: 'agent-observed',
    agentId,
    index: readNumber(record.index),
    label: readString(record.label),
    phaseIndex: readNumber(record.phaseIndex),
    phaseTitle: readString(record.phaseTitle),
    status,
    model: readString(record.model),
    prompt: readString(record.promptPreview),
    queuedAt: readNumber(record.queuedAt),
    startedAt,
    updatedAt: readNumber(record.lastProgressAt),
    completedAt: status === 'completed' && startedAt !== null && durationMs !== null ? startedAt + durationMs : null,
    durationMs,
    attempt: readNumber(record.attempt),
    totalTokens: readNumber(record.tokens),
    toolUses: readNumber(record.toolCalls),
    lastToolName: readString(record.lastToolName),
    lastToolSummary: readString(record.lastToolSummary),
    result: null,
    resultPreview: readString(record.resultPreview),
    authoritative: true,
    observedAt,
  }]
}

function normalizeJournalRecord(record: Record<string, unknown>, observedAt: number): ClaudeWorkflowEvent[] {
  if (record.type === 'workflow_phase' || record.type === 'workflow_agent') {
    return normalizeProgressRecord(record, [], observedAt)
  }
  const agentId = readString(record.agentId)
  if (!agentId || (record.type !== 'started' && record.type !== 'result')) {
    return []
  }
  const completed = record.type === 'result'
  return [{
    kind: 'agent-observed',
    agentId,
    index: null,
    label: null,
    phaseIndex: null,
    phaseTitle: null,
    status: completed ? 'completed' : 'running',
    model: null,
    prompt: null,
    queuedAt: null,
    startedAt: completed ? null : observedAt,
    updatedAt: observedAt,
    completedAt: completed ? observedAt : null,
    durationMs: null,
    attempt: null,
    totalTokens: null,
    toolUses: null,
    lastToolName: null,
    lastToolSummary: null,
    result: completed && Object.hasOwn(record, 'result') ? record.result : null,
    resultPreview: null,
    authoritative: false,
    observedAt,
  }]
}

function normalizeTranscriptRecord(
  record: Record<string, unknown>,
  agentId: string | undefined,
  observedAt: number,
): ClaudeWorkflowEvent[] {
  if (!agentId) {
    return []
  }
  const message = readRecord(record.message)
  const updatedAt = readTimestamp(record.timestamp)
  if (record.type === 'user') {
    const prompt = readText(message.content)
    return prompt
      ? [emptyAgentEvent({ agentId, prompt, startedAt: updatedAt, updatedAt, observedAt })]
      : []
  }
  if (record.type !== 'assistant') {
    return []
  }
  const usage = readRecord(message.usage)
  const inputTokens = readNumber(usage.input_tokens)
  const outputTokens = readNumber(usage.output_tokens)
  const content = Array.isArray(message.content) ? message.content : []
  let lastToolName: string | null = null
  const toolCallIds = content.flatMap((item, index): string[] => {
    const block = readRecord(item)
    if (block.type !== 'tool_use') {
      return []
    }
    lastToolName = readString(block.name) ?? lastToolName
    return [readString(block.id) ?? `${readString(block.name) ?? 'tool'}:${readString(record.uuid) ?? observedAt}:${index}`]
  })
  return [{
    kind: 'agent-tool-observed',
    agentId,
    eventId: readString(record.uuid) ?? readString(message.id) ?? `${agentId}:${updatedAt ?? observedAt}:${toolCallIds.join(',')}`,
    toolCallIds,
    lastToolName,
    model: readString(message.model),
    totalTokens: inputTokens === null && outputTokens === null ? null : (inputTokens ?? 0) + (outputTokens ?? 0),
    updatedAt,
    observedAt,
  }]
}

function emptyAgentEvent(input: {
  agentId: string
  prompt: string
  startedAt: number | null
  updatedAt: number | null
  observedAt: number
}): Extract<ClaudeWorkflowEvent, { kind: 'agent-observed' }> {
  return {
    kind: 'agent-observed',
    agentId: input.agentId,
    index: null,
    label: null,
    phaseIndex: null,
    phaseTitle: null,
    status: null,
    model: null,
    prompt: input.prompt,
    queuedAt: null,
    startedAt: input.startedAt,
    updatedAt: input.updatedAt,
    completedAt: null,
    durationMs: null,
    attempt: null,
    totalTokens: null,
    toolUses: null,
    lastToolName: null,
    lastToolSummary: null,
    result: null,
    resultPreview: null,
    authoritative: false,
    observedAt: input.observedAt,
  }
}

function readDeclaredPhases(value: unknown): ClaudeWorkflowDeclaredPhase[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item, index): ClaudeWorkflowDeclaredPhase[] => {
    const phase = readRecord(item)
    const title = readString(phase.title)
    return title ? [{ index: index + 1, title, detail: readString(phase.detail) }] : []
  })
}

function readWorkflowStatus(value: unknown): 'running' | 'completed' | 'failed' | 'stopped' | null {
  return value === 'running' || value === 'completed' || value === 'failed' || value === 'stopped' ? value : null
}

function readAgentStatus(value: unknown): ClaudeWorkflowAgentStatus | null {
  if (value === 'pending' || value === 'queued') { return 'pending' }
  if (value === 'running') { return 'running' }
  if (value === 'done' || value === 'completed') { return 'completed' }
  if (value === 'error' || value === 'failed') { return 'failed' }
  return value === 'skipped' ? 'skipped' : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readTimestamp(value: unknown): number | null {
  if (typeof value !== 'string') { return null }
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function readText(value: unknown): string | null {
  if (typeof value === 'string') { return value || null }
  if (!Array.isArray(value)) { return null }
  const text = value
    .map(item => readRecord(item))
    .filter(item => item.type === 'text' && typeof item.text === 'string')
    .map(item => item.text as string)
    .join('')
  return text || null
}
