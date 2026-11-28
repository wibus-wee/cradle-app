import type { Citation, ProviderMetadata, UIMessage, UIMessageChunk } from 'ai'
import { parsePartialJson } from 'ai'

const SNAPSHOT_CHUNK_TYPE = 'data-cradle-stream-snapshot' as const

type MessagePart = UIMessage['parts'][number]
type MutableTextPart = Extract<MessagePart, { type: 'text' }>
type MutableReasoningPart = Extract<MessagePart, { type: 'reasoning' }>
type MutableToolPart = Extract<MessagePart, { toolCallId: string }>

interface ActiveTextPart {
  part: MutableTextPart | MutableReasoningPart
  deltas: string[]
}

interface PartialToolCall {
  deltas: string[]
  toolName: string
  dynamic?: boolean
  title?: string
}

export interface UIMessageStreamState {
  activeTextParts: Map<string, ActiveTextPart>
  activeReasoningParts: Map<string, ActiveTextPart>
  partialToolCalls: Map<string, PartialToolCall>
}

export interface UIMessageStreamTarget {
  message: UIMessage
  state: UIMessageStreamState
}

export interface SerializedUIMessageStreamSnapshot {
  version: 1
  message: UIMessage
  activeTextParts: Array<{ id: string, partIndex: number }>
  activeReasoningParts: Array<{ id: string, partIndex: number }>
  partialToolCalls: Array<{
    toolCallId: string
    inputText: string
    toolName: string
    dynamic?: boolean
    title?: string
  }>
}

export type UIMessageStreamSnapshotChunk = Extract<UIMessageChunk, { type: `data-${string}` }> & {
  type: typeof SNAPSHOT_CHUNK_TYPE
  transient: true
  data: {
    runId: string
    cursor: number
    snapshot: SerializedUIMessageStreamSnapshot
  }
}

export function createUIMessageStreamState(): UIMessageStreamState {
  return {
    activeTextParts: new Map(),
    activeReasoningParts: new Map(),
    partialToolCalls: new Map(),
  }
}

export function applyUIMessageChunk(target: UIMessageStreamTarget, chunk: UIMessageChunk): void {
  if (isUIMessageStreamSnapshotChunk(chunk)) {
    const restored = restoreUIMessageStreamSnapshot(chunk.data.snapshot)
    target.message = restored.message
    target.state = restored.state
    return
  }

  const { message, state } = target
  switch (chunk.type) {
    case 'start':
      if (chunk.messageId) {
        message.id = chunk.messageId
      }
      mergeMessageMetadata(message, chunk.messageMetadata)
      return
    case 'message-metadata':
    case 'finish':
      mergeMessageMetadata(message, chunk.messageMetadata)
      return
    case 'text-start':
      startTextPart(message, state.activeTextParts, chunk.id, 'text', chunk.providerMetadata)
      return
    case 'text-delta':
      appendTextDelta(state.activeTextParts, chunk.id, chunk.delta, chunk.providerMetadata)
      return
    case 'text-end':
      finishTextPart(state.activeTextParts, chunk.id, chunk.providerMetadata, chunk.citations)
      return
    case 'reasoning-start':
      startTextPart(message, state.activeReasoningParts, chunk.id, 'reasoning', chunk.providerMetadata)
      return
    case 'reasoning-delta':
      appendTextDelta(state.activeReasoningParts, chunk.id, chunk.delta, chunk.providerMetadata)
      return
    case 'reasoning-end':
      finishTextPart(state.activeReasoningParts, chunk.id, chunk.providerMetadata)
      return
    case 'tool-input-start':
      state.partialToolCalls.set(chunk.toolCallId, {
        deltas: [],
        toolName: chunk.toolName,
        dynamic: chunk.dynamic,
        title: chunk.title,
      })
      upsertToolPart(message, {
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        state: 'input-streaming',
        input: undefined,
        providerExecuted: chunk.providerExecuted,
        providerMetadata: chunk.providerMetadata,
        dynamic: chunk.dynamic,
        title: chunk.title,
      })
      return
    case 'tool-input-delta': {
      const partial = state.partialToolCalls.get(chunk.toolCallId)
      if (partial) {
        partial.deltas.push(chunk.inputTextDelta)
      }
      return
    }
    case 'tool-input-available':
      state.partialToolCalls.delete(chunk.toolCallId)
      upsertToolPart(message, {
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        state: 'input-available',
        input: chunk.input,
        providerExecuted: chunk.providerExecuted,
        providerMetadata: chunk.providerMetadata,
        dynamic: chunk.dynamic,
        title: chunk.title,
      })
      return
    case 'tool-input-error':
      state.partialToolCalls.delete(chunk.toolCallId)
      upsertToolPart(message, {
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        state: 'output-error',
        input: chunk.input,
        errorText: chunk.errorText,
        providerExecuted: chunk.providerExecuted,
        providerMetadata: chunk.providerMetadata,
        dynamic: chunk.dynamic,
        title: chunk.title,
      })
      return
    case 'tool-approval-request':
      updateToolPart(message, chunk.toolCallId, {
        state: 'approval-requested',
        approval: { id: chunk.approvalId },
      })
      return
    case 'tool-output-available':
      updateToolPart(message, chunk.toolCallId, {
        state: 'output-available',
        output: chunk.output,
        providerExecuted: chunk.providerExecuted,
        providerMetadata: chunk.providerMetadata,
        preliminary: chunk.preliminary,
      })
      return
    case 'tool-output-error':
      updateToolPart(message, chunk.toolCallId, {
        state: 'output-error',
        errorText: chunk.errorText,
        providerExecuted: chunk.providerExecuted,
        providerMetadata: chunk.providerMetadata,
      })
      return
    case 'tool-output-denied':
      updateToolPart(message, chunk.toolCallId, { state: 'output-denied' })
      return
    case 'tool-approval-response': {
      // Wire chunks carry the approvalId, not the toolCallId; resolve the
      // part through the approval id recorded by 'tool-approval-request'.
      const part = message.parts.find(
        (candidate): candidate is MutableToolPart =>
          'toolCallId' in candidate
          && typeof candidate === 'object'
          && candidate !== null
          && 'approval' in candidate
          && typeof candidate.approval === 'object'
          && candidate.approval !== null
          && (candidate.approval as { id?: string }).id === chunk.approvalId,
      )
      if (part) {
        const existing = 'approval' in part && typeof part.approval === 'object' && part.approval !== null
          ? part.approval as Record<string, unknown>
          : {}
        Object.assign(part as object, {
          state: 'approval-responded',
          approval: {
            ...existing,
            id: chunk.approvalId,
            approved: chunk.approved,
            ...(chunk.reason !== undefined ? { reason: chunk.reason } : {}),
          },
        })
      }
      return
    }
    case 'custom':
      message.parts.push({
        type: 'custom',
        kind: chunk.kind,
        ...(chunk.providerMetadata ? { providerMetadata: chunk.providerMetadata } : {}),
      } as MessagePart)
      return
    case 'reasoning-file':
      message.parts.push({
        type: 'reasoning-file',
        mediaType: chunk.mediaType,
        url: chunk.url,
        ...(chunk.providerMetadata ? { providerMetadata: chunk.providerMetadata } : {}),
      } as MessagePart)
      return
    case 'steering-message':
      message.parts.push({
        type: 'steering-message',
        id: chunk.id,
        parts: chunk.parts,
      } as MessagePart)
      return
    case 'reset-step':
      rollbackCurrentStep(message, state)
      return
    case 'start-step':
      message.parts.push({ type: 'step-start' })
      return
    case 'finish-step':
      flushUIMessageStreamState(target)
      state.activeTextParts.clear()
      state.activeReasoningParts.clear()
      return
    case 'file':
      message.parts.push({
        type: 'file',
        mediaType: chunk.mediaType,
        url: chunk.url,
        ...(chunk.providerMetadata ? { providerMetadata: chunk.providerMetadata } : {}),
      })
      return
    case 'source-url':
      message.parts.push({
        type: 'source-url',
        sourceId: chunk.sourceId,
        url: chunk.url,
        title: chunk.title,
        providerMetadata: chunk.providerMetadata,
      })
      return
    case 'source-document':
      message.parts.push({
        type: 'source-document',
        sourceId: chunk.sourceId,
        mediaType: chunk.mediaType,
        title: chunk.title,
        filename: chunk.filename,
        providerMetadata: chunk.providerMetadata,
      })
      return
    case 'abort':
    case 'error':
      return
    default: {
      // All concrete chunk types are handled above; what remains is the
      // open-ended `data-${string}` family.
      const dataChunk = chunk as Extract<UIMessageChunk, { type: `data-${string}` }>
      if (dataChunk.type.startsWith('data-') && !dataChunk.transient) {
        const existing = dataChunk.id
          ? message.parts.find(part => part.type === dataChunk.type && 'id' in part && part.id === dataChunk.id)
          : undefined
        if (existing && 'data' in existing) {
          existing.data = dataChunk.data
        }
        else {
          message.parts.push(dataChunk as MessagePart)
        }
      }
    }
  }
}

export function flushUIMessageStreamState(target: UIMessageStreamTarget): void {
  for (const active of target.state.activeTextParts.values()) {
    flushTextPart(active)
  }
  for (const active of target.state.activeReasoningParts.values()) {
    flushTextPart(active)
  }
}

export function finalizeUIMessageStreamState(target: UIMessageStreamTarget): void {
  flushUIMessageStreamState(target)
  for (const active of target.state.activeTextParts.values()) {
    active.part.state = 'done'
  }
  for (const active of target.state.activeReasoningParts.values()) {
    active.part.state = 'done'
  }
  target.state.activeTextParts.clear()
  target.state.activeReasoningParts.clear()
}

export async function flushUIMessageStreamToolInputs(target: UIMessageStreamTarget): Promise<void> {
  for (const [toolCallId, partial] of target.state.partialToolCalls) {
    const inputText = partial.deltas.join('')
    const parsed = await parsePartialJson(inputText)
    upsertToolPart(target.message, {
      toolCallId,
      toolName: partial.toolName,
      state: 'input-streaming',
      input: parsed.state === 'failed-parse' || parsed.value === undefined ? inputText : parsed.value,
      dynamic: partial.dynamic,
      title: partial.title,
    })
  }
}

export function exportUIMessageStreamSnapshot(target: UIMessageStreamTarget): SerializedUIMessageStreamSnapshot {
  flushUIMessageStreamState(target)
  return {
    version: 1,
    message: structuredClone(target.message),
    activeTextParts: serializeActiveParts(target.message, target.state.activeTextParts),
    activeReasoningParts: serializeActiveParts(target.message, target.state.activeReasoningParts),
    partialToolCalls: Array.from(target.state.partialToolCalls, ([toolCallId, partial]) => ({
      toolCallId,
      inputText: partial.deltas.join(''),
      toolName: partial.toolName,
      ...(partial.dynamic === undefined ? {} : { dynamic: partial.dynamic }),
      ...(partial.title === undefined ? {} : { title: partial.title }),
    })),
  }
}

export function restoreUIMessageStreamSnapshot(
  snapshot: SerializedUIMessageStreamSnapshot,
): UIMessageStreamTarget {
  if (snapshot.version !== 1) {
    throw new Error(`Unsupported UI message stream snapshot version: ${String(snapshot.version)}`)
  }
  const message = structuredClone(snapshot.message)
  const state = createUIMessageStreamState()
  restoreActiveParts(message, state.activeTextParts, snapshot.activeTextParts, 'text')
  restoreActiveParts(message, state.activeReasoningParts, snapshot.activeReasoningParts, 'reasoning')
  for (const partial of snapshot.partialToolCalls) {
    state.partialToolCalls.set(partial.toolCallId, {
      deltas: partial.inputText ? [partial.inputText] : [],
      toolName: partial.toolName,
      dynamic: partial.dynamic,
      title: partial.title,
    })
  }
  return { message, state }
}

export function createUIMessageStreamSnapshotChunk(input: {
  runId: string
  cursor: number
  target: UIMessageStreamTarget
}): UIMessageStreamSnapshotChunk {
  return {
    type: SNAPSHOT_CHUNK_TYPE,
    transient: true,
    data: {
      runId: input.runId,
      cursor: input.cursor,
      snapshot: exportUIMessageStreamSnapshot(input.target),
    },
  } as UIMessageStreamSnapshotChunk
}

export function isUIMessageStreamSnapshotChunk(
  chunk: UIMessageChunk,
): chunk is UIMessageStreamSnapshotChunk {
  return chunk.type === SNAPSHOT_CHUNK_TYPE
    && chunk.transient === true
    && typeof chunk.data === 'object'
    && chunk.data !== null
    && 'snapshot' in chunk.data
}

/**
 * Reset-step rollback: drop the parts accumulated for the current step
 * (everything after the most recent 'step-start' boundary, or the whole
 * message when no step has started) and discard in-flight stream state.
 */
function rollbackCurrentStep(message: UIMessage, state: UIMessageStreamState): void {
  let boundary = -1
  for (let index = message.parts.length - 1; index >= 0; index--) {
    if (message.parts[index]!.type === 'step-start') {
      boundary = index
      break
    }
  }
  message.parts.splice(boundary + 1)
  state.activeTextParts.clear()
  state.activeReasoningParts.clear()
  state.partialToolCalls.clear()
}

function startTextPart(
  message: UIMessage,
  parts: Map<string, ActiveTextPart>,
  id: string,
  type: 'text' | 'reasoning',
  providerMetadata?: ProviderMetadata,
): void {
  const part = {
    type,
    text: '',
    state: 'streaming',
    ...(providerMetadata ? { providerMetadata } : {}),
  } as MutableTextPart | MutableReasoningPart
  message.parts.push(part)
  parts.set(id, { part, deltas: [] })
}

function appendTextDelta(
  parts: Map<string, ActiveTextPart>,
  id: string,
  delta: string,
  providerMetadata?: ProviderMetadata,
): void {
  const active = parts.get(id)
  if (!active) {
    throw new Error(`Received stream delta for missing part ${id}`)
  }
  active.deltas.push(delta)
  active.part.providerMetadata = providerMetadata ?? active.part.providerMetadata
}

function finishTextPart(
  parts: Map<string, ActiveTextPart>,
  id: string,
  providerMetadata?: ProviderMetadata,
  citations?: Array<Citation>,
): void {
  const active = parts.get(id)
  if (!active) {
    throw new Error(`Received stream end for missing part ${id}`)
  }
  flushTextPart(active)
  active.part.state = 'done'
  if (citations && active.part.type === 'text') {
    ;(active.part as Extract<MessagePart, { type: 'text' }>).citations = citations
  }
  active.part.providerMetadata = providerMetadata ?? active.part.providerMetadata
  parts.delete(id)
}

function flushTextPart(active: ActiveTextPart): void {
  if (active.deltas.length === 0) {
    return
  }
  active.part.text += active.deltas.join('')
  active.deltas = []
}

function serializeActiveParts(
  message: UIMessage,
  parts: Map<string, ActiveTextPart>,
): Array<{ id: string, partIndex: number }> {
  return Array.from(parts, ([id, active]) => {
    const partIndex = message.parts.indexOf(active.part)
    if (partIndex < 0) {
      throw new Error(`Active stream part ${id} is missing from its message`)
    }
    return { id, partIndex }
  })
}

function restoreActiveParts(
  message: UIMessage,
  target: Map<string, ActiveTextPart>,
  serialized: Array<{ id: string, partIndex: number }>,
  expectedType: 'text' | 'reasoning',
): void {
  for (const item of serialized) {
    const part = message.parts[item.partIndex]
    if (!part || part.type !== expectedType) {
      throw new Error(`Invalid ${expectedType} stream part index ${item.partIndex}`)
    }
    target.set(item.id, { part, deltas: [] })
  }
}

function upsertToolPart(
  message: UIMessage,
  options: {
    toolCallId: string
    toolName: string
    state: string
    input: unknown
    errorText?: string
    providerExecuted?: boolean
    providerMetadata?: ProviderMetadata
    dynamic?: boolean
    title?: string
  },
): void {
  const existing = findToolPart(message, options.toolCallId)
  if (existing) {
    Object.assign(existing as object, {
      state: options.state,
      input: options.input,
      ...(options.errorText === undefined ? {} : { errorText: options.errorText }),
      ...(options.providerExecuted === undefined ? {} : { providerExecuted: options.providerExecuted }),
      ...(options.title === undefined ? {} : { title: options.title }),
      ...(options.providerMetadata === undefined ? {} : { callProviderMetadata: options.providerMetadata }),
    })
    return
  }
  message.parts.push({
    type: options.dynamic ? 'dynamic-tool' : `tool-${options.toolName}`,
    ...(options.dynamic ? { toolName: options.toolName } : {}),
    toolCallId: options.toolCallId,
    state: options.state,
    input: options.input,
    ...(options.errorText === undefined ? {} : { errorText: options.errorText }),
    ...(options.providerExecuted === undefined ? {} : { providerExecuted: options.providerExecuted }),
    ...(options.title === undefined ? {} : { title: options.title }),
    ...(options.providerMetadata === undefined ? {} : { callProviderMetadata: options.providerMetadata }),
  } as MessagePart)
}

function updateToolPart(
  message: UIMessage,
  toolCallId: string,
  values: Record<string, unknown>,
): void {
  const part = findToolPart(message, toolCallId)
  if (!part) {
    return
  }
  const target = part as MutableToolPart & Record<string, unknown>
  const providerMetadata = values.providerMetadata
  delete values.providerMetadata
  Object.assign(target, values)
  if (providerMetadata !== undefined) {
    target.resultProviderMetadata = providerMetadata
  }
  if (values.preliminary === false) {
    delete target.preliminary
  }
}

function findToolPart(message: UIMessage, toolCallId: string): MutableToolPart | undefined {
  return message.parts.find(
    (part): part is MutableToolPart => 'toolCallId' in part && part.toolCallId === toolCallId,
  )
}

function mergeMessageMetadata(message: UIMessage, next: unknown): void {
  if (next === undefined) {
    return
  }
  message.metadata = mergeValue(message.metadata, next)
}

function mergeValue(current: unknown, next: unknown): unknown {
  if (isRecord(current) && isRecord(next)) {
    const merged: Record<string, unknown> = { ...current }
    for (const [key, value] of Object.entries(next)) {
      merged[key] = mergeValue(merged[key], value)
    }
    return merged
  }
  if (Array.isArray(current) && Array.isArray(next)) {
    return [...current, ...next]
  }
  return structuredClone(next)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
