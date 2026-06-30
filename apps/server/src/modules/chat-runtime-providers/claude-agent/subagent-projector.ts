/**
 * Output: nested Claude subagent stream projections as AI SDK UIMessage tool outputs.
 * Input: UIMessageChunk sequences emitted by child Claude Agent SDK messages.
 * Position: Claude Agent provider package projector for subagent-owned presentation payloads.
 */

import type { ProviderMetadata, UIMessage, UIMessageChunk } from 'ai'

type MutableTextPart = Extract<UIMessage['parts'][number], { type: 'text' }>
type MutableReasoningPart = Extract<UIMessage['parts'][number], { type: 'reasoning' }>
type MutableToolPart = Extract<UIMessage['parts'][number], { toolCallId: string }>

interface ClaudeAgentSubagentProjectorState {
  activeTextParts: Map<string, ProjectedTextPart<MutableTextPart>>
  activeReasoningParts: Map<string, ProjectedTextPart<MutableReasoningPart>>
  partialToolCalls: Map<string, ProjectedPartialToolCall>
}

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

interface ClaudeAgentSubagentOutput {
  type: 'cradle.subagent-output.v1'
  message: UIMessage
  result?: unknown
  truncated?: boolean
}

export interface ClaudeAgentSubagentProjection {
  message: UIMessage | null
  projector: ClaudeAgentSubagentProjectorState
  chunkCount: number
  emittedChunkCount: number
}

const PRELIMINARY_SUBAGENT_TEXT_LIMIT = 64 * 1024

export function createClaudeAgentSubagentProjection(parentToolUseId: string): ClaudeAgentSubagentProjection {
  return {
    message: createSubagentMessage(parentToolUseId),
    projector: createSubagentProjectorState(),
    chunkCount: 0,
    emittedChunkCount: 0,
  }
}

export function projectClaudeAgentSubagentOutputChunk(
  parentToolUseId: string,
  streamState: ClaudeAgentSubagentProjection,
  chunks: UIMessageChunk[],
): UIMessageChunk | null {
  projectSubagentChunks(streamState, chunks)

  if (!shouldEmitSubagentProjection(streamState)) {
    return null
  }

  const latestMessage = projectClaudeAgentSubagentMessage(parentToolUseId, streamState)
  const preliminaryMessage = compactPreliminarySubagentMessage(latestMessage)
  streamState.message = latestMessage
  streamState.emittedChunkCount = streamState.chunkCount
  return {
    type: 'tool-output-available',
    toolCallId: parentToolUseId,
    output: {
      ...createClaudeAgentSubagentOutput(preliminaryMessage, undefined, {
        truncated: preliminaryMessage !== latestMessage,
      }),
    },
    preliminary: true,
  }
}

export function projectClaudeAgentSubagentMessage(
  parentToolUseId: string,
  streamState: ClaudeAgentSubagentProjection,
): UIMessage {
  flushSubagentProjection(streamState)
  streamState.emittedChunkCount = streamState.chunkCount
  return streamState.message ?? createSubagentMessage(parentToolUseId)
}

export function compactClaudeAgentSubagentProjection(
  streamState: ClaudeAgentSubagentProjection,
  message: UIMessage | null,
): void {
  streamState.message = message
  streamState.projector = createSubagentProjectorState()
  streamState.chunkCount = 0
  streamState.emittedChunkCount = 0
}

export function createClaudeAgentSubagentOutput(
  message: UIMessage,
  result?: unknown,
  options: { truncated?: boolean } = {},
): ClaudeAgentSubagentOutput {
  return {
    type: 'cradle.subagent-output.v1',
    message,
    ...(options.truncated ? { truncated: true } : {}),
    ...(result === undefined ? {} : { result }),
  }
}

function shouldEmitSubagentProjection(streamState: ClaudeAgentSubagentProjection): boolean {
  const unprojectedCount = streamState.chunkCount - streamState.emittedChunkCount
  if (unprojectedCount <= 0) {
    return false
  }
  if (streamState.chunkCount < 32) {
    return true
  }
  return unprojectedCount >= readSubagentProjectionWindow(streamState.chunkCount)
}

function readSubagentProjectionWindow(chunkCount: number): number {
  if (chunkCount < 32) {
    return 1
  }
  return Math.max(16, chunkCount / 4)
}

function createSubagentMessage(parentToolUseId: string): UIMessage {
  return {
    id: `subagent-${parentToolUseId}`,
    role: 'assistant',
    parts: [],
  }
}

function createSubagentProjectorState(): ClaudeAgentSubagentProjectorState {
  return {
    activeTextParts: new Map(),
    activeReasoningParts: new Map(),
    partialToolCalls: new Map(),
  }
}

function projectSubagentChunks(
  streamState: ClaudeAgentSubagentProjection,
  chunks: UIMessageChunk[],
): void {
  for (const chunk of chunks) {
    streamState.chunkCount += 1
    projectSubagentChunk(streamState, chunk)
  }
}

function projectSubagentChunk(
  streamState: ClaudeAgentSubagentProjection,
  chunk: UIMessageChunk,
): void {
  const message = streamState.message ?? createSubagentMessage('unknown')
  streamState.message = message

  switch (chunk.type) {
    case 'text-start': {
      const part = {
        type: 'text',
        text: '',
        state: 'streaming',
        ...(chunk.providerMetadata ? { providerMetadata: chunk.providerMetadata } : {}),
      } satisfies MutableTextPart
      streamState.projector.activeTextParts.set(chunk.id, { part, deltas: [] })
      message.parts.push(part)
      break
    }
    case 'text-delta': {
      const activePart = streamState.projector.activeTextParts.get(chunk.id)
      if (activePart) {
        activePart.deltas.push(chunk.delta)
        activePart.part.providerMetadata = chunk.providerMetadata ?? activePart.part.providerMetadata
      }
      break
    }
    case 'text-end': {
      const activePart = streamState.projector.activeTextParts.get(chunk.id)
      if (activePart) {
        flushProjectedTextPart(activePart)
        activePart.part.state = 'done'
        activePart.part.providerMetadata = chunk.providerMetadata ?? activePart.part.providerMetadata
        streamState.projector.activeTextParts.delete(chunk.id)
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
      streamState.projector.activeReasoningParts.set(chunk.id, { part, deltas: [] })
      message.parts.push(part)
      break
    }
    case 'reasoning-delta': {
      const activePart = streamState.projector.activeReasoningParts.get(chunk.id)
      if (activePart) {
        activePart.deltas.push(chunk.delta)
        activePart.part.providerMetadata = chunk.providerMetadata ?? activePart.part.providerMetadata
      }
      break
    }
    case 'reasoning-end': {
      const activePart = streamState.projector.activeReasoningParts.get(chunk.id)
      if (activePart) {
        flushProjectedTextPart(activePart)
        activePart.part.state = 'done'
        activePart.part.providerMetadata = chunk.providerMetadata ?? activePart.part.providerMetadata
        streamState.projector.activeReasoningParts.delete(chunk.id)
      }
      break
    }
    case 'tool-input-start': {
      streamState.projector.partialToolCalls.set(chunk.toolCallId, {
        deltas: [],
        toolName: chunk.toolName,
        dynamic: chunk.dynamic,
        title: chunk.title,
      })
      upsertSubagentToolPart(message, {
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
      const partialToolCall = streamState.projector.partialToolCalls.get(chunk.toolCallId)
      if (partialToolCall) {
        partialToolCall.deltas.push(chunk.inputTextDelta)
        upsertSubagentToolPart(message, {
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
      streamState.projector.partialToolCalls.delete(chunk.toolCallId)
      upsertSubagentToolPart(message, {
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
    case 'tool-output-available':
      updateSubagentToolOutput(message, chunk.toolCallId, {
        state: 'output-available',
        output: chunk.output,
        providerExecuted: chunk.providerExecuted,
        providerMetadata: chunk.providerMetadata,
        preliminary: chunk.preliminary === true,
        dynamic: chunk.dynamic,
      })
      break
    case 'tool-output-error':
      updateSubagentToolOutput(message, chunk.toolCallId, {
        state: 'output-error',
        errorText: chunk.errorText,
        providerExecuted: chunk.providerExecuted,
        providerMetadata: chunk.providerMetadata,
        preliminary: false,
        dynamic: chunk.dynamic,
      })
      break
    case 'tool-output-denied':
      updateSubagentToolOutput(message, chunk.toolCallId, { state: 'output-denied', preliminary: false })
      break
    case 'start-step':
      message.parts.push({ type: 'step-start' })
      break
    case 'finish-step':
      flushSubagentProjection(streamState)
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

function flushSubagentProjection(streamState: ClaudeAgentSubagentProjection): void {
  for (const activePart of streamState.projector.activeTextParts.values()) {
    flushProjectedTextPart(activePart)
  }
  for (const activePart of streamState.projector.activeReasoningParts.values()) {
    flushProjectedTextPart(activePart)
  }
  const message = streamState.message
  if (!message) {
    return
  }
  for (const [toolCallId, partialToolCall] of streamState.projector.partialToolCalls) {
    upsertSubagentToolPart(message, {
      toolCallId,
      toolName: partialToolCall.toolName,
      state: 'input-streaming',
      input: parseToolInputText(partialToolCall.deltas.join('')),
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

function upsertSubagentToolPart(
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
  const part = findSubagentToolPart(message, options.toolCallId)
  if (part) {
    assignToolPart(part, {
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

function updateSubagentToolOutput(
  message: UIMessage,
  toolCallId: string,
  options: {
    state: 'output-available' | 'output-error' | 'output-denied'
    output?: unknown
    errorText?: string
    providerExecuted?: boolean
    providerMetadata?: ProviderMetadata
    preliminary?: boolean
    dynamic?: boolean
  },
): void {
  const part = findSubagentToolPart(message, toolCallId)
  if (!part) {
    return
  }

  assignToolPart(part, {
    state: options.state,
    output: options.output,
    errorText: options.errorText,
    providerExecuted: options.providerExecuted,
    preliminary: options.preliminary,
    providerMetadata: options.providerMetadata,
    isResultMetadata: true,
  })
}

function findSubagentToolPart(message: UIMessage, toolCallId: string): MutableToolPart | undefined {
  return message.parts.find((part): part is MutableToolPart => 'toolCallId' in part && part.toolCallId === toolCallId)
}

function assignToolPart(
  part: MutableToolPart,
  values: {
    state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error' | 'output-denied'
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
    target[values.isResultMetadata ? 'resultProviderMetadata' : 'callProviderMetadata'] = values.providerMetadata
  }
}

function compactPreliminarySubagentMessage(message: UIMessage): UIMessage {
  let remainingText = PRELIMINARY_SUBAGENT_TEXT_LIMIT
  let truncated = false
  const parts: UIMessage['parts'] = []

  for (const part of message.parts) {
    if (part.type !== 'text' && part.type !== 'reasoning') {
      parts.push(part)
      continue
    }

    if (remainingText <= 0) {
      truncated = true
      continue
    }

    if (part.text.length <= remainingText) {
      remainingText -= part.text.length
      parts.push(part)
      continue
    }

    truncated = true
    parts.push({
      ...part,
      text: part.text.slice(0, remainingText),
    } as UIMessage['parts'][number])
    remainingText = 0
  }

  if (!truncated) {
    return message
  }

  return {
    ...message,
    parts,
  }
}

function parseToolInputText(inputText: string | undefined): unknown {
  if (!inputText) {
    return undefined
  }
  try {
    return JSON.parse(inputText)
  }
  catch {
    return undefined
  }
}
