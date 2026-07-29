import type { UIMessage } from 'ai'

import type {
  ProviderThreadTurn,
  RuntimeCrewAgentItem,
  RuntimeCrewCallItem,
  RuntimeCrewUiSlotState,
  RuntimeProgressItem,
} from '../../chat-runtime/runtime-provider-types'
import type { GetApiV1SessionsBySessionIdTranscriptResponses } from './protocol/rest/types.gen'
import { buildKimiToolInput, buildKimiToolOutput } from './tools/mapper'

export type KimiTranscriptData = Extract<
  GetApiV1SessionsBySessionIdTranscriptResponses[200],
  { code: 0 }
>['data']

export type KimiTranscriptTurn = Extract<KimiTranscriptData['items'][number], { kind: 'turn' }>
type KimiTranscriptStep = KimiTranscriptTurn['steps'][number]
type KimiTranscriptFrame = KimiTranscriptStep['frames'][number]
type KimiTranscriptTask = KimiTranscriptData['tasks'][number]

export interface KimiTranscriptTurnProjection {
  turns: ProviderThreadTurn[]
  messages: UIMessage[]
  nextCursor: string | null
}

export function projectKimiTranscriptTurns(data: KimiTranscriptData): KimiTranscriptTurnProjection {
  const nativeTurns = data.items.filter((item): item is KimiTranscriptTurn => item.kind === 'turn')
  return {
    turns: nativeTurns.map(projectKimiTranscriptTurn),
    messages: nativeTurns.flatMap(projectKimiTranscriptMessages),
    nextCursor: data.has_more ? nativeTurns.at(-1)?.turnId ?? null : null,
  }
}

export function findKimiPhaseTranscriptTurn(data: KimiTranscriptData): KimiTranscriptTurn | null {
  const phase = data.meta.agent?.phase
  if (!phase || !('turnId' in phase)) {
    return null
  }
  return data.items.find((item): item is KimiTranscriptTurn =>
    item.kind === 'turn' && readKimiTranscriptTurnSequence(item.turnId) === phase.turnId) ?? null
}

export function readKimiTranscriptTurnSequence(turnId: string): number | null {
  const normalized = turnId.startsWith('t') ? turnId.slice(1) : turnId
  const sequence = Number(normalized)
  return Number.isFinite(sequence) ? sequence : null
}

export function projectKimiTranscriptCrewState(
  data: KimiTranscriptData,
  threadId: string,
  updatedAt: number,
): RuntimeCrewUiSlotState | null {
  const subagentTasks = data.tasks.filter(task => task.kind === 'subagent')
  const agents = data.agents
    .filter(agent => agent.type !== 'main')
    .map(agent => projectKimiCrewAgent(
      data,
      agent.agentId,
      subagentTasks.find(task => task.agentId === agent.agentId) ?? null,
    ))
  const calls = subagentTasks.map(task => projectKimiCrewCall(data, task, threadId))
  if (agents.length === 0 && calls.length === 0) {
    return null
  }
  return {
    kind: 'crew',
    slotId: 'kimi:crew',
    threadId,
    activeCount: calls.filter(call => call.status === 'running').length,
    completedCount: calls.filter(call => call.status === 'completed').length,
    failedCount: calls.filter(call => call.status === 'failed').length,
    recentItems: calls.map(call => ({
      id: call.id,
      type: 'subagent',
      label: call.prompt ?? call.tool,
      status: call.status,
      startedAt: call.startedAt,
      completedAt: call.completedAt,
    })),
    agents,
    collaborationModeCount: 0,
    collaborationModes: [],
    calls,
    updatedAt,
  }
}

export function projectKimiTranscriptProgressItems(data: KimiTranscriptData): RuntimeProgressItem[] {
  return data.tasks.map(task => ({
    id: task.taskId,
    label: task.description ?? task.resultSummary ?? `${task.kind} task`,
    status: task.state === 'running'
        ? 'inProgress'
      : task.state === 'completed'
        ? 'completed'
        : 'pending',
    sourceStatus: task.state,
  }))
}

function projectKimiTranscriptTurn(turn: KimiTranscriptTurn): ProviderThreadTurn {
  return {
    id: turn.turnId,
    status: turn.state,
    startedAt: parseTimestamp(turn.startedAt),
    completedAt: parseTimestamp(turn.endedAt),
    durationMs: turn.durationMs ?? null,
    itemsView: 'full',
    items: [turn],
  }
}

function projectKimiTranscriptMessages(turn: KimiTranscriptTurn): UIMessage[] {
  const userParts: UIMessage['parts'] = []
  const assistantParts: UIMessage['parts'] = []
  if (turn.prompt) {
    userParts.push({ type: 'text', text: turn.prompt })
  }
  for (const step of turn.steps) {
    for (const frame of step.frames) {
      projectKimiTranscriptFrame(frame, userParts, assistantParts)
    }
  }
  return [
    ...(userParts.length > 0
      ? [{ id: `${turn.turnId}:user`, role: 'user' as const, parts: userParts }]
      : []),
    ...(assistantParts.length > 0
      ? [{ id: `${turn.turnId}:assistant`, role: 'assistant' as const, parts: assistantParts }]
      : []),
  ]
}

function projectKimiTranscriptFrame(
  frame: KimiTranscriptFrame,
  userParts: UIMessage['parts'],
  assistantParts: UIMessage['parts'],
): void {
  switch (frame.kind) {
    case 'text':
      (frame.role === 'user' ? userParts : assistantParts).push({ type: 'text', text: frame.text })
      return
    case 'thinking':
      assistantParts.push({ type: 'reasoning', text: frame.text })
      return
    case 'tool':
      assistantParts.push(projectKimiTranscriptToolFrame(frame))
      return
    case 'notice':
      assistantParts.push({ type: 'text', text: frame.message })
  }
}

function projectKimiTranscriptToolFrame(
  frame: Extract<KimiTranscriptFrame, { kind: 'tool' }>,
): UIMessage['parts'][number] {
  const input = buildKimiToolInput(frame.name, frame.input ?? frame.inputText)
  if (frame.state === 'error') {
    return {
      type: 'dynamic-tool',
      toolCallId: frame.toolCallId,
      toolName: frame.name,
      state: 'output-error',
      input,
      errorText: frame.error ?? 'Kimi tool call failed.',
    }
  }
  if (frame.state === 'running' && frame.output === undefined && frame.progress === undefined) {
    return {
      type: 'dynamic-tool',
      toolCallId: frame.toolCallId,
      toolName: frame.name,
      state: 'input-available',
      input,
    }
  }
  return {
    type: 'dynamic-tool',
    toolCallId: frame.toolCallId,
    toolName: frame.name,
    state: 'output-available',
    input,
    output: buildKimiToolOutput(frame.name, frame.input, frame.output ?? frame.progress),
  }
}

function projectKimiCrewCall(
  data: KimiTranscriptData,
  task: KimiTranscriptTask,
  senderThreadId: string,
): RuntimeCrewCallItem {
  const retry = findKimiTaskRetry(data, task)
  const agentId = task.agentId ?? task.taskId
  return {
    id: task.taskId,
    tool: 'subagent',
    status: mapKimiTaskStatus(task.state),
    senderThreadId,
    receiverThreadIds: task.agentId ? [task.agentId] : [],
    prompt: task.description ?? task.resultSummary ?? null,
    model: null,
    reasoningEffort: null,
    agents: task.agentId ? [projectKimiCrewAgent(data, task.agentId, task)] : [],
    retry: retry
      ? {
        agentId,
          attempt: retry.failedAttempt,
          maxRetries: Math.max(0, retry.maxAttempts - 1),
          retryDelayMs: retry.delayMs,
          errorStatus: retry.statusCode ?? null,
          errorCategory: retry.errorName,
        }
      : null,
    startedAt: parseTimestamp(task.startedAt),
    completedAt: parseTimestamp(task.endedAt),
  }
}

function projectKimiCrewAgent(
  data: KimiTranscriptData,
  agentId: string,
  task: KimiTranscriptTask | null,
): RuntimeCrewAgentItem {
  const agent = data.agents.find(candidate => candidate.agentId === agentId)
  const retrying = task ? findKimiTaskRetry(data, task) !== null : false
  return {
    threadId: agentId,
    status: retrying
      ? 'retrying'
      : task?.state ?? (agent?.disposedAt ? 'completed' : 'running'),
    message: task?.description ?? task?.resultSummary ?? null,
    name: agent?.label ?? null,
    preview: task?.outputTail || task?.description || null,
    modelProvider: null,
    agentNickname: agent?.label ?? null,
    agentRole: agent?.type ?? null,
  }
}

function findKimiTaskRetry(
  data: KimiTranscriptData,
  task: KimiTranscriptTask,
): KimiTranscriptStep['retry'] | null {
  for (const item of data.items) {
    if (item.kind !== 'turn') {
      continue
    }
    for (const step of item.steps) {
      if (!step.retry) {
        continue
      }
      const belongsToTask = step.frames.some(frame =>
        ('taskId' in frame && frame.taskId === task.taskId)
        || (frame.kind === 'tool' && frame.agentRefs?.some(agent => agent.agentId === task.agentId)))
      if (belongsToTask) {
        return step.retry
      }
    }
  }
  return null
}

function mapKimiTaskStatus(state: KimiTranscriptTask['state']): RuntimeCrewCallItem['status'] {
  if (state === 'running') {
    return 'running'
  }
  if (state === 'completed') {
    return 'completed'
  }
  return 'failed'
}

function parseTimestamp(value: string | undefined): number | null {
  if (!value) {
    return null
  }
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}
