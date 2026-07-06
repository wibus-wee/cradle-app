import type { ProviderMetadata, UIMessage, UIMessageChunk } from 'ai'
import { parsePartialJson } from 'ai'

export interface FinalMessageProjectionState {
  activeTextParts: Map<string, ProjectedTextPart<MutableTextPart>>
  activeReasoningParts: Map<string, ProjectedTextPart<MutableReasoningPart>>
  partialToolCalls: Map<string, ProjectedPartialToolCall>
}

export interface FinalMessageProjectionRun {
  finalMessage: UIMessage
  finalProjection: FinalMessageProjectionState
}

type MutableTextPart = Extract<UIMessage['parts'][number], { type: 'text' }>
type MutableReasoningPart = Extract<UIMessage['parts'][number], { type: 'reasoning' }>
type MutableToolPart = Extract<UIMessage['parts'][number], { toolCallId: string }>

interface ProjectedTextPart<TPart extends MutableTextPart | MutableReasoningPart> {
  part: TPart
  deltas: string[]
}

interface ProjectedPartialToolCall {
  deltas: string[]
  toolName: string
  dynamic?: boolean
  title?: string
}

type MutableApprovalToolPart = MutableToolPart & {
  approval?: {
    id?: unknown
    approved?: unknown
    reason?: unknown
  }
  input?: unknown
  state?: string
  toolName?: string
  type: string
}

export function createFinalMessageProjectionState(): FinalMessageProjectionState {
  return {
    activeTextParts: new Map(),
    activeReasoningParts: new Map(),
    partialToolCalls: new Map(),
  }
}

export function projectFinalMessageChunk(
  activeRun: FinalMessageProjectionRun,
  chunk: UIMessageChunk,
): void {
  const message = activeRun.finalMessage
  const projection = activeRun.finalProjection

  switch (chunk.type) {
    case 'start':
    case 'message-metadata':
    case 'finish':
      mergeFinalMessageMetadata(message, chunk.messageMetadata)
      break
    case 'text-start': {
      const part = {
        type: 'text',
        text: '',
        state: 'streaming',
        ...(chunk.providerMetadata ? { providerMetadata: chunk.providerMetadata } : {}),
      } satisfies MutableTextPart
      projection.activeTextParts.set(chunk.id, { part, deltas: [] })
      message.parts.push(part)
      break
    }
    case 'text-delta': {
      const activePart = projection.activeTextParts.get(chunk.id)
      if (activePart) {
        activePart.deltas.push(chunk.delta)
        activePart.part.providerMetadata
          = chunk.providerMetadata ?? activePart.part.providerMetadata
      }
      break
    }
    case 'text-end': {
      const activePart = projection.activeTextParts.get(chunk.id)
      if (activePart) {
        flushProjectedTextPart(activePart)
        activePart.part.state = 'done'
        activePart.part.providerMetadata
          = chunk.providerMetadata ?? activePart.part.providerMetadata
        projection.activeTextParts.delete(chunk.id)
      }
      break
    }
    case 'reasoning-start': {
      const part = {
        type: 'reasoning',
        text: '',
        state: 'streaming',
        ...(chunk.providerMetadata ? { providerMetadata: chunk.providerMetadata } : {}),
      } satisfies MutableReasoningPart
      projection.activeReasoningParts.set(chunk.id, { part, deltas: [] })
      message.parts.push(part)
      break
    }
    case 'reasoning-delta': {
      const activePart = projection.activeReasoningParts.get(chunk.id)
      if (activePart) {
        activePart.deltas.push(chunk.delta)
        activePart.part.providerMetadata
          = chunk.providerMetadata ?? activePart.part.providerMetadata
      }
      break
    }
    case 'reasoning-end': {
      const activePart = projection.activeReasoningParts.get(chunk.id)
      if (activePart) {
        flushProjectedTextPart(activePart)
        activePart.part.state = 'done'
        activePart.part.providerMetadata
          = chunk.providerMetadata ?? activePart.part.providerMetadata
        projection.activeReasoningParts.delete(chunk.id)
      }
      break
    }
    case 'tool-input-start': {
      projection.partialToolCalls.set(chunk.toolCallId, {
        deltas: [],
        toolName: chunk.toolName,
        dynamic: chunk.dynamic,
        title: chunk.title,
      })
      upsertProjectedToolPart(message, {
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        state: 'input-streaming',
        input: undefined,
        providerExecuted: chunk.providerExecuted,
        providerMetadata: chunk.providerMetadata,
        dynamic: chunk.dynamic,
        title: chunk.title,
      })
      break
    }
    case 'tool-input-delta': {
      const partialToolCall = projection.partialToolCalls.get(chunk.toolCallId)
      if (partialToolCall) {
        partialToolCall.deltas.push(chunk.inputTextDelta)
        upsertProjectedToolPart(message, {
          toolCallId: chunk.toolCallId,
          toolName: partialToolCall.toolName,
          state: 'input-streaming',
          input: undefined,
          dynamic: partialToolCall.dynamic,
          title: partialToolCall.title,
        })
      }
      break
    }
    case 'tool-input-available':
      projection.partialToolCalls.delete(chunk.toolCallId)
      upsertProjectedToolPart(message, {
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        state: 'input-available',
        input: chunk.input,
        providerExecuted: chunk.providerExecuted,
        providerMetadata: chunk.providerMetadata,
        dynamic: chunk.dynamic,
        title: chunk.title,
      })
      break
    case 'tool-approval-request':
      updateProjectedToolApproval(message, chunk.toolCallId, chunk.approvalId)
      break
    case 'tool-output-available':
      updateProjectedToolOutput(message, chunk.toolCallId, {
        state: 'output-available',
        output: chunk.output,
        providerExecuted: chunk.providerExecuted,
        providerMetadata: chunk.providerMetadata,
        preliminary: chunk.preliminary === true,
      })
      break
    case 'tool-output-error':
      updateProjectedToolOutput(message, chunk.toolCallId, {
        state: 'output-error',
        errorText: chunk.errorText,
        providerExecuted: chunk.providerExecuted,
        providerMetadata: chunk.providerMetadata,
        preliminary: false,
      })
      break
    case 'tool-output-denied':
      updateProjectedToolOutput(message, chunk.toolCallId, { state: 'output-denied', preliminary: false })
      break
    case 'start-step':
      message.parts.push({ type: 'step-start' })
      break
    case 'finish-step':
      flushFinalMessageProjection(activeRun)
      break
    case 'file':
      message.parts.push({
        type: 'file',
        mediaType: chunk.mediaType,
        url: chunk.url,
        ...(chunk.providerMetadata ? { providerMetadata: chunk.providerMetadata } : {}),
      })
      break
    case 'source-url':
      message.parts.push({
        type: 'source-url',
        sourceId: chunk.sourceId,
        url: chunk.url,
        title: chunk.title,
        providerMetadata: chunk.providerMetadata,
      })
      break
    case 'source-document':
      message.parts.push({
        type: 'source-document',
        sourceId: chunk.sourceId,
        mediaType: chunk.mediaType,
        title: chunk.title,
        filename: chunk.filename,
        providerMetadata: chunk.providerMetadata,
      })
      break
  }
}

function mergeFinalMessageMetadata(message: UIMessage, nextMetadata: unknown): void {
  if (nextMetadata === undefined) {
    return
  }

  const nextRecord = readPlainRecord(nextMetadata)
  if (!nextRecord) {
    if (message.metadata === undefined) {
      message.metadata = nextMetadata
    }
    return
  }

  const currentRecord = readPlainRecord(message.metadata)
  if (!currentRecord) {
    message.metadata = { ...nextRecord }
    return
  }

  message.metadata = mergeMetadataRecords(currentRecord, nextRecord)
}

function mergeMetadataRecords(
  currentRecord: Record<string, unknown>,
  nextRecord: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...currentRecord }
  for (const [key, nextValue] of Object.entries(nextRecord)) {
    merged[key] = mergeMetadataValue(merged[key], nextValue)
  }
  return merged
}

function mergeMetadataValue(currentValue: unknown, nextValue: unknown): unknown {
  const currentNested = readPlainRecord(currentValue)
  const nextNested = readPlainRecord(nextValue)
  if (currentNested && nextNested) {
    return mergeMetadataRecords(currentNested, nextNested)
  }
  if (Array.isArray(currentValue) && Array.isArray(nextValue)) {
    return [...currentValue, ...nextValue]
  }
  return nextValue
}

function readPlainRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function flushFinalMessageProjection(activeRun: FinalMessageProjectionRun): void {
  for (const activePart of activeRun.finalProjection.activeTextParts.values()) {
    flushProjectedTextPart(activePart)
  }
  for (const activePart of activeRun.finalProjection.activeReasoningParts.values()) {
    flushProjectedTextPart(activePart)
  }
}

export function finalizeFinalMessageProjection(activeRun: FinalMessageProjectionRun): void {
  flushFinalMessageProjection(activeRun)
  for (const activePart of activeRun.finalProjection.activeTextParts.values()) {
    activePart.part.state = 'done'
  }
  activeRun.finalProjection.activeTextParts.clear()
  for (const activePart of activeRun.finalProjection.activeReasoningParts.values()) {
    activePart.part.state = 'done'
  }
  activeRun.finalProjection.activeReasoningParts.clear()
}

export async function flushProjectedToolInputs(activeRun: FinalMessageProjectionRun): Promise<void> {
  const message = activeRun.finalMessage
  for (const [toolCallId, partialToolCall] of activeRun.finalProjection.partialToolCalls) {
    const inputText = partialToolCall.deltas.join('')
    const parsedInput = await parsePartialJson(inputText)
    upsertProjectedToolPart(message, {
      toolCallId,
      toolName: partialToolCall.toolName,
      state: 'input-streaming',
      input:
        parsedInput.state === 'failed-parse' || parsedInput.value === undefined
          ? inputText
          : parsedInput.value,
      dynamic: partialToolCall.dynamic,
      title: partialToolCall.title,
    })
  }
}

function flushProjectedTextPart<TPart extends MutableTextPart | MutableReasoningPart>(
  activePart: ProjectedTextPart<TPart>,
): void {
  if (activePart.deltas.length === 0) {
    return
  }
  activePart.part.text += activePart.deltas.join('')
  activePart.deltas = []
}

function upsertProjectedToolPart(
  message: UIMessage,
  options: {
    toolCallId: string
    toolName: string
    state: 'input-streaming' | 'input-available'
    input: unknown
    providerExecuted?: boolean
    providerMetadata?: ProviderMetadata
    dynamic?: boolean
    title?: string
  },
): void {
  const part = findProjectedToolPart(message, options.toolCallId)
  if (part) {
    assignProjectedToolPart(part, {
      state: options.state,
      input: options.input,
      providerExecuted: options.providerExecuted,
      title: options.title,
      providerMetadata: options.providerMetadata,
      isResultMetadata: false,
    })
    return
  }

  if (options.dynamic) {
    message.parts.push({
      type: 'dynamic-tool',
      toolName: options.toolName,
      toolCallId: options.toolCallId,
      state: options.state,
      input: options.input,
      providerExecuted: options.providerExecuted,
      title: options.title,
      ...(options.providerMetadata ? { callProviderMetadata: options.providerMetadata } : {}),
    } as UIMessage['parts'][number])
    return
  }

  message.parts.push({
    type: `tool-${options.toolName}`,
    toolCallId: options.toolCallId,
    state: options.state,
    input: options.input,
    providerExecuted: options.providerExecuted,
    title: options.title,
    ...(options.providerMetadata ? { callProviderMetadata: options.providerMetadata } : {}),
  } as UIMessage['parts'][number])
}

function updateProjectedToolOutput(
  message: UIMessage,
  toolCallId: string,
  options: {
    state: 'output-available' | 'output-error' | 'output-denied'
    output?: unknown
    errorText?: string
    providerExecuted?: boolean
    providerMetadata?: ProviderMetadata
    preliminary?: boolean
  },
): void {
  const part = findProjectedToolPart(message, toolCallId)
  if (!part) {
    return
  }

  assignProjectedToolPart(part, {
    state: options.state,
    output: options.output,
    errorText: options.errorText,
    providerExecuted: options.providerExecuted,
    preliminary: options.preliminary,
    providerMetadata: options.providerMetadata,
    isResultMetadata: true,
  })
}

function updateProjectedToolApproval(
  message: UIMessage,
  toolCallId: string,
  approvalId: string,
): void {
  const part = findProjectedToolPart(message, toolCallId)
  if (!part) {
    return
  }

  const target = part as MutableApprovalToolPart
  target.state = 'approval-requested'
  target.approval = { id: approvalId }
}

function findProjectedToolPart(
  message: UIMessage,
  toolCallId: string,
): MutableToolPart | undefined {
  return message.parts.find(
    (part): part is MutableToolPart => 'toolCallId' in part && part.toolCallId === toolCallId,
  )
}

function assignProjectedToolPart(
  part: MutableToolPart,
  values: {
    state:
      | 'input-streaming'
      | 'input-available'
      | 'output-available'
      | 'output-error'
      | 'output-denied'
    input?: unknown
    output?: unknown
    errorText?: string
    providerExecuted?: boolean
    preliminary?: boolean
    title?: string
    providerMetadata?: ProviderMetadata
    isResultMetadata: boolean
  },
): void {
  const target = part as MutableToolPart & Record<string, unknown>
  target.state = values.state
  if ('input' in values) {
    target.input = values.input
  }
  if ('output' in values) {
    target.output = values.output
  }
  if ('errorText' in values) {
    target.errorText = values.errorText
  }
  if (values.providerExecuted !== undefined) {
    target.providerExecuted = values.providerExecuted
  }
  if (values.preliminary !== undefined) {
    if (values.preliminary) {
      target.preliminary = true
    }
    else {
      delete target.preliminary
    }
  }
  if (values.title !== undefined) {
    target.title = values.title
  }
  if (values.providerMetadata !== undefined) {
    target[values.isResultMetadata ? 'resultProviderMetadata' : 'callProviderMetadata']
      = values.providerMetadata
  }
}
