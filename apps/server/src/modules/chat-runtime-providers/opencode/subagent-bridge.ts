/**
 * Output: OpenCode task/subagent provider-thread resolution and live stream fanout helpers.
 * Input: task tool parts, session.created events, and provider-thread threadId aliases.
 * Position: opencode provider package bridge between child sessions and Cradle provider-thread APIs.
 */

import type {
  AssistantMessage as OpencodeAssistantMessage,
  Message as OpencodeMessage,
  Part as OpencodePart,
  Session as OpencodeSession,
  ToolPart as OpencodeToolPart,
} from '@opencode-ai/sdk'
import type { Event as OpencodeEvent } from '@opencode-ai/sdk/v2'
import type { UIMessageChunk } from 'ai'

import type { ProviderThread } from '../../chat-runtime/runtime-provider-types'
import type { OpencodeStreamEvent } from './event-stream'
import { OpencodeEventStreamProjector } from './event-stream'

export interface OpencodeSubagentBinding {
  toolCallId: string
  childSessionId: string
  parentSessionId: string
  description: string | null
  subagentType: string | null
  status: 'running' | 'completed' | 'failed'
  startedAt: number | null
  completedAt: number | null
}

export class OpencodeSubagentRegistry {
  private readonly byToolCallId = new Map<string, OpencodeSubagentBinding>()
  private readonly byChildSessionId = new Map<string, OpencodeSubagentBinding>()
  private readonly projectorsByToolCallId = new Map<string, OpencodeEventStreamProjector>()

  register(binding: OpencodeSubagentBinding): void {
    const existing = this.byToolCallId.get(binding.toolCallId)
    if (
      existing
      && existing.childSessionId === binding.childSessionId
      && existing.parentSessionId === binding.parentSessionId
    ) {
      const merged = mergeOpencodeSubagentBinding(existing, binding)
      this.byToolCallId.set(binding.toolCallId, merged)
      this.byChildSessionId.set(binding.childSessionId, merged)
      return
    }
    this.byToolCallId.set(binding.toolCallId, binding)
    this.byChildSessionId.set(binding.childSessionId, binding)
  }

  getByToolCallId(toolCallId: string): OpencodeSubagentBinding | null {
    return this.byToolCallId.get(toolCallId) ?? null
  }

  getByChildSessionId(childSessionId: string): OpencodeSubagentBinding | null {
    return this.byChildSessionId.get(childSessionId) ?? null
  }

  listBindings(): OpencodeSubagentBinding[] {
    return [...this.byToolCallId.values()]
  }

  getProjector(binding: OpencodeSubagentBinding): OpencodeEventStreamProjector {
    const existing = this.projectorsByToolCallId.get(binding.toolCallId)
    if (existing) {
      return existing
    }
    const projector = new OpencodeEventStreamProjector(binding.childSessionId)
    this.projectorsByToolCallId.set(binding.toolCallId, projector)
    return projector
  }
}

function mergeOpencodeSubagentBinding(
  existing: OpencodeSubagentBinding,
  next: OpencodeSubagentBinding,
): OpencodeSubagentBinding {
  return {
    toolCallId: existing.toolCallId,
    childSessionId: existing.childSessionId,
    parentSessionId: existing.parentSessionId,
    description: next.description ?? existing.description,
    subagentType: next.subagentType ?? existing.subagentType,
    status: next.status,
    startedAt: next.startedAt ?? existing.startedAt,
    completedAt: next.completedAt ?? existing.completedAt,
  }
}

export function isOpencodeNativeSessionId(threadId: string): boolean {
  return threadId.startsWith('ses_')
}

export function readOpencodeSyntheticCrewThreadId(threadId: string): { sessionId: string, agentName: string } | null {
  const match = /^(.+):agent:(.+)$/.exec(threadId)
  if (!match) {
    return null
  }
  return {
    sessionId: match[1]!,
    agentName: match[2]!,
  }
}

export function readOpencodeTaskChildSessionId(part: OpencodeToolPart): string | null {
  if (part.tool !== 'task') {
    return null
  }
  const metadataSessionId = part.state.status === 'pending' ? null : readMetadataSessionId(part.state.metadata)
  if (metadataSessionId) {
    return metadataSessionId
  }
  if (part.state.status === 'completed' || part.state.status === 'running') {
    const fromOutput = readTaskSessionIdFromText(part.state.status === 'completed' ? part.state.output : '')
    if (fromOutput) {
      return fromOutput
    }
  }
  if (part.state.status === 'error') {
    return readMetadataSessionId(part.state.metadata) ?? readTaskSessionIdFromText(part.state.error)
  }
  return null
}

export function readOpencodeSubagentBindingFromTaskPart(
  part: OpencodeToolPart,
  parentSessionId: string,
): OpencodeSubagentBinding | null {
  const childSessionId = readOpencodeTaskChildSessionId(part)
  if (!childSessionId) {
    return null
  }
  const input = part.state.status === 'pending'
    ? part.state.raw
    : part.state.input
  return {
    toolCallId: part.callID,
    childSessionId,
    parentSessionId,
    description: readTaskDescription(part, input),
    subagentType: readTaskSubagentType(input),
    status: readTaskRuntimeStatus(part),
    startedAt: readTaskStartedAt(part),
    completedAt: readTaskCompletedAt(part),
  }
}

export function readOpencodeEventSessionId(event: OpencodeStreamEvent): string | null {
  switch (event.type) {
    case 'message.updated':
      return event.properties.info.sessionID
    case 'message.removed':
      return event.properties.sessionID
    case 'message.part.updated':
      return event.properties.part.sessionID
    case 'message.part.removed':
      return event.properties.sessionID
    case 'message.part.delta':
      return event.properties.sessionID
    case 'session.created':
    case 'session.updated':
      return event.properties.info.id
    case 'session.status':
    case 'session.idle':
    case 'session.compacted':
    case 'session.diff':
    case 'session.error':
    case 'todo.updated':
    case 'command.executed':
    case 'permission.updated':
    case 'permission.replied':
      return 'sessionID' in event.properties && typeof event.properties.sessionID === 'string'
        ? event.properties.sessionID
        : null
    default:
      return null
  }
}

export function projectOpencodeSubagentProviderThread(input: {
  threadId: string
  binding: OpencodeSubagentBinding
  session: OpencodeSession
  childCount?: number
}): ProviderThread {
  const base = projectOpencodeSessionProviderThread(input.session, input.childCount ?? 0)
  return {
    ...base,
    id: input.threadId,
    providerSessionTreeId: input.binding.parentSessionId,
    forkedFromId: input.binding.toolCallId,
    agentNickname: input.binding.subagentType ?? input.binding.description,
    agentRole: input.binding.subagentType,
    name: input.binding.description ?? input.binding.subagentType ?? base.name,
    sourceKind: 'appServer',
    source: {
      type: 'opencode-subagent',
      childSessionId: input.binding.childSessionId,
      parentSessionId: input.binding.parentSessionId,
      toolCallId: input.binding.toolCallId,
      subagentType: input.binding.subagentType,
    },
    threadSource: {
      kind: 'opencode-subagent',
      childSessionId: input.binding.childSessionId,
      parentSessionId: input.binding.parentSessionId,
      toolCallId: input.binding.toolCallId,
      subagentType: input.binding.subagentType,
    },
  }
}

export function projectOpencodeCrewAgentProviderThread(input: {
  threadId: string
  sessionId: string
  agentName: string
  parentSessionId: string | null
}): ProviderThread {
  const now = Math.floor(Date.now() / 1000)
  return {
    id: input.threadId,
    providerSessionTreeId: input.parentSessionId,
    forkedFromId: null,
    preview: input.agentName,
    ephemeral: true,
    modelProvider: null,
    createdAt: now,
    updatedAt: now,
    status: 'idle',
    sourceKind: 'unknown',
    source: {
      type: 'opencode-crew-agent',
      sessionId: input.sessionId,
      agentName: input.agentName,
    },
    threadSource: {
      kind: 'opencode-crew-agent',
      sessionId: input.sessionId,
      agentName: input.agentName,
    },
    agentNickname: input.agentName,
    agentRole: 'agent',
    name: input.agentName,
    cwd: null,
  }
}

export function projectOpencodeSubagentStreamChunks(
  event: OpencodeStreamEvent,
  binding: OpencodeSubagentBinding,
  registry: OpencodeSubagentRegistry,
): UIMessageChunk[] {
  const eventSessionId = readOpencodeEventSessionId(event)
  if (eventSessionId !== binding.childSessionId) {
    return []
  }
  const projector = registry.getProjector(binding)
  const chunks = projector.projectEvent(event)
  if (event.type === 'message.updated' && event.properties.info.role === 'assistant') {
    const info = event.properties.info as OpencodeAssistantMessage
    if (info.time.completed !== undefined || info.finish !== undefined || info.error !== undefined) {
      if (info.finish !== 'tool-calls' && info.finish !== 'unknown') {
        chunks.push(projector.finish(info))
      }
    }
  }
  return chunks
}

export async function resolveOpencodeProviderThreadTarget(input: {
  threadId: string
  parentSessionId: string | null
  registry: OpencodeSubagentRegistry | null
  readChildSession: (sessionId: string) => Promise<OpencodeSession | null>
  readParentTaskBindings: () => Promise<OpencodeSubagentBinding[]>
}): Promise<
  | { kind: 'session', sessionId: string, binding: OpencodeSubagentBinding | null, requestedThreadId: string }
  | { kind: 'crew-agent', threadId: string, sessionId: string, agentName: string, parentSessionId: string | null }
> {
  const crew = readOpencodeSyntheticCrewThreadId(input.threadId)
  if (crew) {
    return {
      kind: 'crew-agent',
      threadId: input.threadId,
      sessionId: crew.sessionId,
      agentName: crew.agentName,
      parentSessionId: input.parentSessionId,
    }
  }

  const registryBinding = input.registry?.getByToolCallId(input.threadId) ?? null
  if (registryBinding) {
    return {
      kind: 'session',
      sessionId: registryBinding.childSessionId,
      binding: registryBinding,
      requestedThreadId: input.threadId,
    }
  }

  if (isOpencodeNativeSessionId(input.threadId)) {
    const binding = input.registry?.getByChildSessionId(input.threadId) ?? null
    return {
      kind: 'session',
      sessionId: input.threadId,
      binding,
      requestedThreadId: input.threadId,
    }
  }

  const parentBindings = await input.readParentTaskBindings()
  const matched = parentBindings.find(binding => binding.toolCallId === input.threadId) ?? null
  if (matched) {
    input.registry?.register(matched)
    return {
      kind: 'session',
      sessionId: matched.childSessionId,
      binding: matched,
      requestedThreadId: input.threadId,
    }
  }

  throw new Error(`OpenCode provider thread was not found: ${input.threadId}`)
}

function projectOpencodeSessionProviderThread(session: OpencodeSession, childCount: number): ProviderThread {
  return {
    id: session.id,
    providerSessionTreeId: session.parentID ?? null,
    forkedFromId: session.parentID ?? null,
    preview: normalizeProviderThreadTitle(session.title),
    ephemeral: false,
    modelProvider: null,
    createdAt: session.time.created,
    updatedAt: session.time.updated,
    status: session.time.compacting ? 'active' : 'idle',
    sourceKind: 'appServer',
    source: {
      type: 'opencode-session',
      projectID: session.projectID,
      version: session.version,
      shareUrl: session.share?.url ?? null,
      summary: session.summary ?? null,
      revert: session.revert ?? null,
      childCount,
    },
    threadSource: {
      kind: 'opencode-session',
      directory: session.directory,
      parentID: session.parentID ?? null,
      shareUrl: session.share?.url ?? null,
      childCount,
    },
    agentNickname: null,
    agentRole: null,
    name: normalizeProviderThreadTitle(session.title),
    cwd: session.directory,
  }
}

function normalizeProviderThreadTitle(text: string | null | undefined): string | null {
  const trimmed = text?.trim()
  return trimmed || null
}

function readMetadataSessionId(metadata: Record<string, unknown> | undefined): string | null {
  if (!metadata) {
    return null
  }
  const sessionId = metadata.sessionId ?? metadata.sessionID
  return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null
}

function readTaskSessionIdFromText(text: string): string | null {
  const taskIdMatch = /task_id:\s*(ses_[^\s<]+)/i.exec(text)
  if (taskIdMatch?.[1]) {
    return taskIdMatch[1]
  }
  const metadataMatch = /<task_metadata>[\s\S]*?session_id:\s*(ses_[^\s<]+)/i.exec(text)
  return metadataMatch?.[1] ?? null
}

function readTaskDescription(part: OpencodeToolPart, input: unknown): string | null {
  if (part.state.status === 'running' || part.state.status === 'completed') {
    const title = part.state.title?.trim()
    if (title) {
      return title
    }
  }
  if (input && typeof input === 'object' && 'description' in input && typeof input.description === 'string') {
    const description = input.description.trim()
    return description.length > 0 ? description : null
  }
  return null
}

function readTaskSubagentType(input: unknown): string | null {
  if (!input || typeof input !== 'object') {
    return null
  }
  const subagentType = 'subagent_type' in input
    ? input.subagent_type
    : 'subagentType' in input
      ? input.subagentType
      : null
  return typeof subagentType === 'string' && subagentType.trim().length > 0 ? subagentType.trim() : null
}

function readTaskRuntimeStatus(part: OpencodeToolPart): OpencodeSubagentBinding['status'] {
  switch (part.state.status) {
    case 'completed':
      return 'completed'
    case 'error':
      return 'failed'
    case 'pending':
    case 'running':
      return 'running'
  }
}

function readTaskStartedAt(part: OpencodeToolPart): number | null {
  return part.state.status === 'pending' ? null : part.state.time.start
}

function readTaskCompletedAt(part: OpencodeToolPart): number | null {
  return part.state.status === 'completed' || part.state.status === 'error' ? part.state.time.end : null
}

export async function readOpencodeTaskBindingsFromMessages(
  parentSessionId: string,
  messages: Array<{ info: OpencodeMessage, parts: OpencodePart[] }>,
): Promise<OpencodeSubagentBinding[]> {
  const bindings: OpencodeSubagentBinding[] = []
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== 'tool' || part.tool !== 'task') {
        continue
      }
      const binding = readOpencodeSubagentBindingFromTaskPart(part, parentSessionId)
      if (binding) {
        bindings.push(binding)
      }
    }
  }
  return bindings
}

export function readOpencodeSubagentBindingFromSessionCreated(
  session: OpencodeSession,
  pendingTaskParts: OpencodeToolPart[],
): OpencodeSubagentBinding | null {
  if (!session.parentID || pendingTaskParts.length === 0) {
    return null
  }
  const unmatched = pendingTaskParts.filter(part => !readOpencodeTaskChildSessionId(part))
  const part = unmatched.at(-1) ?? pendingTaskParts.at(-1)
  if (!part) {
    return null
  }
  return {
    toolCallId: part.callID,
    childSessionId: session.id,
    parentSessionId: session.parentID,
    description: readTaskDescription(part, part.state.status === 'pending' ? part.state.raw : part.state.input),
    subagentType: readTaskSubagentType(part.state.status === 'pending' ? part.state.raw : part.state.input),
    status: readTaskRuntimeStatus(part),
    startedAt: readTaskStartedAt(part),
    completedAt: readTaskCompletedAt(part),
  }
}

export type { OpencodeEvent }
