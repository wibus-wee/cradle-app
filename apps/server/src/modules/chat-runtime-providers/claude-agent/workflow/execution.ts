import type {
  SDKTaskNotificationMessage,
  SDKTaskProgressMessage,
  SDKTaskStartedMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type { WorkflowOutput } from '@anthropic-ai/claude-agent-sdk/sdk-tools'

import { readObjectRecord as readRecord } from '../../../../helpers/json-record'

export type ClaudeWorkflowExecutionStatus = 'running' | 'completed' | 'failed' | 'stopped'

export interface ClaudeWorkflowInputRecord {
  script: string | null
  name: string | null
  description: string | null
  title: string | null
  args: Record<string, unknown> | null
  scriptPath: string | null
  resumeFromRunId: string | null
}

export interface ClaudeWorkflowOutputRecord {
  status: WorkflowOutput['status'] | null
  taskId: string | null
  taskType: string | null
  workflowName: string | null
  runId: string | null
  summary: string | null
  transcriptDir: string | null
  scriptPath: string | null
  sessionUrl: string | null
  warning: string | null
  error: string | null
}

export interface ClaudeWorkflowLifecycleUsage {
  totalTokens: number
  toolUses: number
  durationMs: number
}

export interface ClaudeWorkflowLifecycleRecord {
  type: 'task_started' | 'task_progress' | 'task_notification'
  uuid: string | null
  sessionId: string | null
  taskId: string
  toolUseId: string | null
  description: string | null
  subagentType: string | null
  taskType: string | null
  workflowName: string | null
  prompt: string | null
  status: ClaudeWorkflowExecutionStatus | null
  outputFile: string | null
  summary: string | null
  lastToolName: string | null
  skipTranscript: boolean | null
  usage: ClaudeWorkflowLifecycleUsage | null
}

export interface ClaudeWorkflowExecutionRecord {
  toolCallId: string
  tool: 'Workflow'
  status: ClaudeWorkflowExecutionStatus
  startedAt: number
  completedAt: number | null
  input: ClaudeWorkflowInputRecord
  output: ClaudeWorkflowOutputRecord | null
  lifecycle: ClaudeWorkflowLifecycleRecord[]
  rawInput: Record<string, unknown>
  rawOutput: Record<string, unknown> | null
  rawLifecycle: Array<Record<string, unknown>>
}

export type ClaudeWorkflowLifecycleMessage
  = SDKTaskStartedMessage | SDKTaskProgressMessage | SDKTaskNotificationMessage

export function createClaudeWorkflowExecutionRecord(input: {
  toolCallId: string
  input?: unknown
  output?: unknown
  lifecycle?: ClaudeWorkflowLifecycleMessage
  status?: ClaudeWorkflowExecutionStatus
  startedAt?: number
  completedAt?: number | null
}): ClaudeWorkflowExecutionRecord {
  const lifecycle = input.lifecycle ? projectClaudeWorkflowLifecycle(input.lifecycle) : null
  const output = input.output === undefined ? null : projectClaudeWorkflowOutput(input.output)
  const status = input.status
    ?? lifecycle?.status
    ?? (input.output === undefined ? 'running' : 'completed')

  return {
    toolCallId: input.toolCallId,
    tool: 'Workflow',
    status,
    startedAt: input.startedAt ?? Date.now(),
    completedAt: input.completedAt ?? (isTerminalWorkflowStatus(status) ? Date.now() : null),
    input: projectClaudeWorkflowInput(input.input),
    output,
    lifecycle: lifecycle ? [lifecycle] : [],
    rawInput: readRecord(input.input),
    rawOutput: input.output === undefined ? null : readOptionalRecord(input.output),
    rawLifecycle: input.lifecycle ? [readRecord(input.lifecycle)] : [],
  }
}

export function projectClaudeWorkflowInput(value: unknown): ClaudeWorkflowInputRecord {
  const record = readRecord(value)
  return {
    script: readOptionalString(record.script),
    name: readOptionalString(record.name),
    description: readOptionalString(record.description),
    title: readOptionalString(record.title),
    args: readOptionalRecord(record.args),
    scriptPath: readOptionalString(record.scriptPath),
    resumeFromRunId: readOptionalString(record.resumeFromRunId),
  }
}

export function projectClaudeWorkflowOutput(value: unknown): ClaudeWorkflowOutputRecord | null {
  const record = readOptionalRecord(value)
  if (!record) {
    return null
  }
  return {
    status: record.status === 'async_launched' || record.status === 'remote_launched' ? record.status : null,
    taskId: readOptionalString(record.taskId),
    taskType: readOptionalString(record.taskType),
    workflowName: readOptionalString(record.workflowName),
    runId: readOptionalString(record.runId),
    summary: readOptionalString(record.summary),
    transcriptDir: readOptionalString(record.transcriptDir),
    scriptPath: readOptionalString(record.scriptPath),
    sessionUrl: readOptionalString(record.sessionUrl),
    warning: readOptionalString(record.warning),
    error: readOptionalString(record.error),
  }
}

export function projectClaudeWorkflowLifecycle(
  message: ClaudeWorkflowLifecycleMessage,
): ClaudeWorkflowLifecycleRecord {
  const usage = 'usage' in message && message.usage
    ? {
        totalTokens: message.usage.total_tokens,
        toolUses: message.usage.tool_uses,
        durationMs: message.usage.duration_ms,
      }
    : null

  return {
    type: message.subtype,
    uuid: message.uuid,
    sessionId: message.session_id,
    taskId: message.task_id,
    toolUseId: message.tool_use_id ?? null,
    description: message.subtype === 'task_started' || message.subtype === 'task_progress' ? message.description : null,
    subagentType: message.subtype === 'task_started' || message.subtype === 'task_progress' ? message.subagent_type ?? null : null,
    taskType: message.subtype === 'task_started' ? message.task_type ?? null : null,
    workflowName: message.subtype === 'task_started' ? message.workflow_name ?? null : null,
    prompt: message.subtype === 'task_started' ? message.prompt ?? null : null,
    status: message.subtype === 'task_notification' ? message.status : message.subtype === 'task_progress' ? 'running' : null,
    outputFile: message.subtype === 'task_notification' ? message.output_file : null,
    summary: message.subtype === 'task_progress' || message.subtype === 'task_notification' ? message.summary ?? null : null,
    lastToolName: message.subtype === 'task_progress' ? message.last_tool_name ?? null : null,
    skipTranscript: message.subtype === 'task_started' || message.subtype === 'task_notification' ? message.skip_transcript ?? null : null,
    usage,
  }
}

export function readClaudeWorkflowExecutionRecord(value: unknown): ClaudeWorkflowExecutionRecord | null {
  const record = readRecord(value)
  const toolCallId = readOptionalString(record.toolCallId)
  if (!toolCallId || record.tool !== 'Workflow') {
    return null
  }

  const status = readWorkflowStatus(record.status)
  if (!status) {
    return null
  }

  const lifecycle = Array.isArray(record.lifecycle)
    ? record.lifecycle.flatMap((item): ClaudeWorkflowLifecycleRecord[] => {
        const parsed = readClaudeWorkflowLifecycleRecord(item)
        return parsed ? [parsed] : []
      })
    : []

  return {
    toolCallId,
    tool: 'Workflow',
    status,
    startedAt: typeof record.startedAt === 'number' ? record.startedAt : 0,
    completedAt: typeof record.completedAt === 'number' ? record.completedAt : null,
    input: projectClaudeWorkflowInput(record.input),
    output: projectClaudeWorkflowOutput(record.output),
    lifecycle,
    rawInput: readRecord(record.rawInput),
    rawOutput: readOptionalRecord(record.rawOutput),
    rawLifecycle: Array.isArray(record.rawLifecycle)
      ? record.rawLifecycle.map(item => readRecord(item))
      : [],
  }
}

export function mergeClaudeWorkflowExecutionRecord(
  existing: ClaudeWorkflowExecutionRecord,
  next: ClaudeWorkflowExecutionRecord,
): ClaudeWorkflowExecutionRecord {
  return {
    toolCallId: existing.toolCallId,
    tool: 'Workflow',
    status: next.status,
    startedAt: existing.startedAt > 0 ? existing.startedAt : next.startedAt,
    completedAt: isTerminalWorkflowStatus(next.status)
      ? next.completedAt ?? existing.completedAt
      : existing.completedAt,
    input: mergeClaudeWorkflowInput(existing.input, next.input),
    output: mergeClaudeWorkflowOutput(existing.output, next.output),
    lifecycle: mergeClaudeWorkflowLifecycle(existing.lifecycle, next.lifecycle),
    rawInput: Object.keys(next.rawInput).length > 0
      ? { ...existing.rawInput, ...next.rawInput }
      : existing.rawInput,
    rawOutput: mergeRawOutput(existing.rawOutput, next.rawOutput),
    rawLifecycle: mergeRawLifecycle(existing.rawLifecycle, next.rawLifecycle),
  }
}

function mergeClaudeWorkflowInput(
  existing: ClaudeWorkflowInputRecord,
  next: ClaudeWorkflowInputRecord,
): ClaudeWorkflowInputRecord {
  return {
    script: next.script ?? existing.script,
    name: next.name ?? existing.name,
    description: next.description ?? existing.description,
    title: next.title ?? existing.title,
    args: next.args ?? existing.args,
    scriptPath: next.scriptPath ?? existing.scriptPath,
    resumeFromRunId: next.resumeFromRunId ?? existing.resumeFromRunId,
  }
}

function mergeClaudeWorkflowOutput(
  existing: ClaudeWorkflowOutputRecord | null,
  next: ClaudeWorkflowOutputRecord | null,
): ClaudeWorkflowOutputRecord | null {
  if (!existing) {
    return next
  }
  if (!next) {
    return existing
  }
  return {
    status: next.status ?? existing.status,
    taskId: next.taskId ?? existing.taskId,
    taskType: next.taskType ?? existing.taskType,
    workflowName: next.workflowName ?? existing.workflowName,
    runId: next.runId ?? existing.runId,
    summary: next.summary ?? existing.summary,
    transcriptDir: next.transcriptDir ?? existing.transcriptDir,
    scriptPath: next.scriptPath ?? existing.scriptPath,
    sessionUrl: next.sessionUrl ?? existing.sessionUrl,
    warning: next.warning ?? existing.warning,
    error: next.error ?? existing.error,
  }
}

function mergeClaudeWorkflowLifecycle(
  existing: ClaudeWorkflowLifecycleRecord[],
  next: ClaudeWorkflowLifecycleRecord[],
): ClaudeWorkflowLifecycleRecord[] {
  const merged = [...existing]
  for (const item of next) {
    const index = item.uuid ? merged.findIndex(existingItem => existingItem.uuid === item.uuid) : -1
    if (index >= 0) {
      merged[index] = item
    }
    else {
      merged.push(item)
    }
  }
  return merged
}

function mergeRawOutput(
  existing: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!existing) {
    return next
  }
  if (!next) {
    return existing
  }
  return { ...existing, ...next }
}

function mergeRawLifecycle(
  existing: Array<Record<string, unknown>>,
  next: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const merged = [...existing]
  for (const item of next) {
    const uuid = readOptionalString(item.uuid)
    const index = uuid ? merged.findIndex(existingItem => readOptionalString(existingItem.uuid) === uuid) : -1
    if (index >= 0) {
      merged[index] = item
    }
    else {
      merged.push(item)
    }
  }
  return merged
}

function readClaudeWorkflowLifecycleRecord(value: unknown): ClaudeWorkflowLifecycleRecord | null {
  const record = readRecord(value)
  const type = record.type
  const taskId = readOptionalString(record.taskId)
  if ((type !== 'task_started' && type !== 'task_progress' && type !== 'task_notification') || !taskId) {
    return null
  }
  const usageRecord = readOptionalRecord(record.usage)
  return {
    type,
    uuid: readOptionalString(record.uuid),
    sessionId: readOptionalString(record.sessionId),
    taskId,
    toolUseId: readOptionalString(record.toolUseId),
    description: readOptionalString(record.description),
    subagentType: readOptionalString(record.subagentType),
    taskType: readOptionalString(record.taskType),
    workflowName: readOptionalString(record.workflowName),
    prompt: readOptionalString(record.prompt),
    status: readWorkflowStatus(record.status),
    outputFile: readOptionalString(record.outputFile),
    summary: readOptionalString(record.summary),
    lastToolName: readOptionalString(record.lastToolName),
    skipTranscript: typeof record.skipTranscript === 'boolean' ? record.skipTranscript : null,
    usage: usageRecord
      && typeof usageRecord.totalTokens === 'number'
      && typeof usageRecord.toolUses === 'number'
      && typeof usageRecord.durationMs === 'number'
      ? {
          totalTokens: usageRecord.totalTokens,
          toolUses: usageRecord.toolUses,
          durationMs: usageRecord.durationMs,
        }
      : null,
  }
}

function readWorkflowStatus(value: unknown): ClaudeWorkflowExecutionStatus | null {
  return value === 'running' || value === 'completed' || value === 'failed' || value === 'stopped'
    ? value
    : null
}

function isTerminalWorkflowStatus(status: ClaudeWorkflowExecutionStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'stopped'
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function readOptionalRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
