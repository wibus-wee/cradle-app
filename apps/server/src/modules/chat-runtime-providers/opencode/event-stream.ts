import type {
  AssistantMessage as OpencodeAssistantMessage,
  Event as OpencodeEvent,
  Part as OpencodePart,
  ToolPart as OpencodeToolPart,
} from '@opencode-ai/sdk'
import type { UIMessageChunk } from 'ai'

import type { TokenUsage } from '../../chat-runtime/runtime-provider-types'
import { providerChunk } from '../kit/chunk-mapper'
import { buildOpencodeToolInput, buildOpencodeToolOutput } from './tools/mapper'

type OpencodeMessagePartDeltaEvent = {
  type: 'message.part.delta'
  properties: {
    sessionID: string
    messageID: string
    partID: string
    delta: string
  }
}

export type OpencodeStreamEvent = OpencodeEvent | OpencodeMessagePartDeltaEvent

interface TextPartProjection {
  kind: 'text' | 'reasoning'
  emittedText: string
  started: boolean
  ended: boolean
}

interface ToolPartProjection {
  inputAvailable: boolean
  outputKey: string | null
}

export class OpencodeEventStreamProjector {
  private ignoredMessageIds: ReadonlySet<string> = new Set()
  private readonly messageRoles = new Map<string, 'user' | 'assistant'>()
  private readonly partsById = new Map<string, OpencodePart>()
  private readonly pendingTextDeltas = new Map<string, string>()
  private readonly textParts = new Map<string, TextPartProjection>()
  private readonly toolParts = new Map<string, ToolPartProjection>()
  private _usage: TokenUsage | null = null

  constructor(private readonly sessionId: string) {}

  get usage(): TokenUsage | null {
    return this._usage
  }

  ignoreMessages(messageIds: ReadonlySet<string>): void {
    this.ignoredMessageIds = messageIds
  }

  projectEvent(event: OpencodeStreamEvent): UIMessageChunk[] {
    switch (event.type) {
      case 'message.updated':
        if (event.properties.info.sessionID !== this.sessionId) {
          return []
        }
        if (this.ignoredMessageIds.has(event.properties.info.id)) {
          return []
        }
        this.messageRoles.set(event.properties.info.id, event.properties.info.role)
        if (event.properties.info.role === 'assistant') {
          this._usage = readTokenUsage(event.properties.info)
          return this.projectKnownMessageParts(event.properties.info.id)
        }
        return []

      case 'message.removed':
        if (event.properties.sessionID !== this.sessionId) {
          return []
        }
        this.messageRoles.delete(event.properties.messageID)
        return []

      case 'message.part.delta':
        if (event.properties.sessionID !== this.sessionId || event.properties.delta.length === 0) {
          return []
        }
        if (this.ignoredMessageIds.has(event.properties.messageID)) {
          return []
        }
        return this.projectPartDelta(event.properties.partID, event.properties.delta)

      case 'message.part.updated':
        if (event.properties.part.sessionID !== this.sessionId) {
          return []
        }
        if (this.ignoredMessageIds.has(event.properties.part.messageID)) {
          return []
        }
        return this.projectPart(event.properties.part)

      case 'message.part.removed':
        if (event.properties.sessionID !== this.sessionId) {
          return []
        }
        this.partsById.delete(event.properties.partID)
        this.pendingTextDeltas.delete(event.properties.partID)
        this.textParts.delete(event.properties.partID)
        return []

      case 'session.error':
        if (event.properties.sessionID && event.properties.sessionID !== this.sessionId) {
          return []
        }
        return [{
          type: 'error',
          errorText: formatOpencodeStreamError(event.properties.error),
        }]

      case 'todo.updated':
      case 'command.executed':
      case 'permission.updated':
      case 'permission.replied':
      case 'session.status':
      case 'session.idle':
      case 'session.compacted':
      case 'session.diff':
        if ('sessionID' in event.properties && event.properties.sessionID !== this.sessionId) {
          return []
        }
        return [{
          type: 'data-runtime-event',
          data: {
            kind: `opencode.${event.type}`,
            event,
          },
        }]

      default:
        return []
    }
  }

  projectPromptResult(input: {
    info: OpencodeAssistantMessage
    parts: OpencodePart[]
  }): UIMessageChunk[] {
    if (input.info.sessionID !== this.sessionId) {
      return []
    }
    this.messageRoles.set(input.info.id, 'assistant')
    this._usage = readTokenUsage(input.info)
    return input.parts.flatMap(part => this.projectPart(part))
  }

  finish(input: OpencodeAssistantMessage): UIMessageChunk {
    return providerChunk.finish(readFinishReason(input.finish))
  }

  private projectKnownMessageParts(messageId: string): UIMessageChunk[] {
    const chunks: UIMessageChunk[] = []
    for (const part of this.partsById.values()) {
      if (part.messageID === messageId) {
        chunks.push(...this.projectPart(part))
      }
    }
    return chunks
  }

  private projectPart(part: OpencodePart): UIMessageChunk[] {
    this.partsById.set(part.id, part)
    switch (part.type) {
      case 'text':
      case 'reasoning':
        return this.projectTextPart(part)
      case 'tool':
        return this.projectToolPart(part)
      case 'file':
        return [providerChunk.file({
          mediaType: part.mime,
          url: part.url,
        })]
      case 'patch':
      case 'snapshot':
      case 'step-start':
      case 'step-finish':
      case 'agent':
      case 'retry':
      case 'compaction':
      case 'subtask':
        return [{
          type: 'data-runtime-event',
          data: {
            kind: `opencode.${part.type}`,
            part,
          },
        }]
    }
  }

  private projectPartDelta(partId: string, delta: string): UIMessageChunk[] {
    const part = this.partsById.get(partId)
    if (!part || (part.type !== 'text' && part.type !== 'reasoning')) {
      this.pendingTextDeltas.set(partId, `${this.pendingTextDeltas.get(partId) ?? ''}${delta}`)
      return []
    }
    if (this.messageRoles.get(part.messageID) !== 'assistant') {
      this.pendingTextDeltas.set(partId, `${this.pendingTextDeltas.get(partId) ?? ''}${delta}`)
      return []
    }
    const projection = this.ensureTextProjection(part)
    projection.emittedText += delta
    return [
      this.startTextChunk(part, projection),
      this.deltaTextChunk(part, delta),
    ].filter((chunk): chunk is UIMessageChunk => chunk !== null)
  }

  private projectTextPart(part: Extract<OpencodePart, { type: 'text' | 'reasoning' }>): UIMessageChunk[] {
    if (this.messageRoles.get(part.messageID) !== 'assistant') {
      return []
    }
    if (part.type === 'text' && (part.synthetic === true || part.ignored === true)) {
      return []
    }

    const pendingDelta = this.pendingTextDeltas.get(part.id) ?? ''
    this.pendingTextDeltas.delete(part.id)
    const text = `${pendingDelta}${part.text}`
    const projection = this.ensureTextProjection(part)
    const delta = readTextDelta(projection.emittedText, text)
    projection.emittedText = text

    const chunks: UIMessageChunk[] = []
    const startChunk = this.startTextChunk(part, projection)
    if (startChunk) {
      chunks.push(startChunk)
    }
    if (delta.length > 0) {
      chunks.push(this.deltaTextChunk(part, delta))
    }
    if (part.time?.end !== undefined && !projection.ended) {
      projection.ended = true
      chunks.push(part.type === 'text'
        ? providerChunk.textEnd(part.id)
        : providerChunk.reasoningEnd(part.id))
    }
    return chunks
  }

  private projectToolPart(part: OpencodeToolPart): UIMessageChunk[] {
    const projection = this.toolParts.get(part.callID) ?? {
      inputAvailable: false,
      outputKey: null,
    }
    this.toolParts.set(part.callID, projection)

    const chunks: UIMessageChunk[] = []
    if (!projection.inputAvailable) {
      projection.inputAvailable = true
      chunks.push(
        providerChunk.toolInputStart(part.callID, part.tool),
        providerChunk.toolInputAvailable({
          toolCallId: part.callID,
          toolName: part.tool,
          input: buildOpencodeToolInput(part),
        }),
      )
    }

    const outputKey = readToolOutputKey(part)
    if (outputKey !== projection.outputKey) {
      projection.outputKey = outputKey
      if (part.state.status === 'error') {
        chunks.push(providerChunk.toolOutputError(part.callID, part.state.error))
      }
      else if (part.state.status === 'running' || part.state.status === 'completed') {
        chunks.push(providerChunk.toolOutputAvailable({
          toolCallId: part.callID,
          output: buildOpencodeToolOutput(part),
          preliminary: part.state.status === 'running',
        }))
      }
    }
    return chunks
  }

  private ensureTextProjection(part: Extract<OpencodePart, { type: 'text' | 'reasoning' }>): TextPartProjection {
    const existing = this.textParts.get(part.id)
    if (existing) {
      return existing
    }
    const next: TextPartProjection = {
      kind: part.type,
      emittedText: '',
      started: false,
      ended: false,
    }
    this.textParts.set(part.id, next)
    return next
  }

  private startTextChunk(
    part: Extract<OpencodePart, { type: 'text' | 'reasoning' }>,
    projection: TextPartProjection,
  ): UIMessageChunk | null {
    if (projection.started) {
      return null
    }
    projection.started = true
    return projection.kind === 'text'
      ? providerChunk.textStart(part.id)
      : providerChunk.reasoningStart(part.id)
  }

  private deltaTextChunk(
    part: Extract<OpencodePart, { type: 'text' | 'reasoning' }>,
    delta: string,
  ): UIMessageChunk {
    return part.type === 'text'
      ? providerChunk.textDelta(part.id, delta)
      : providerChunk.reasoningDelta(part.id, delta)
  }
}

export function readOpencodeTerminalAssistantForTurn(
  event: OpencodeStreamEvent,
  input: {
    sessionId: string
    baselineMessageIds: ReadonlySet<string>
  },
): OpencodeAssistantMessage | null {
  if (event.type !== 'message.updated') {
    return null
  }
  const info = event.properties.info
  if (
    info.role !== 'assistant'
    || info.sessionID !== input.sessionId
    || input.baselineMessageIds.has(info.id)
  ) {
    return null
  }
  return info.time.completed !== undefined || info.finish !== undefined || info.error !== undefined
    ? info
    : null
}

function readTextDelta(previousText: string, nextText: string): string {
  if (nextText.startsWith(previousText)) {
    return nextText.slice(previousText.length)
  }
  return nextText
}

function readToolOutputKey(part: OpencodeToolPart): string {
  switch (part.state.status) {
    case 'pending':
      return 'pending'
    case 'running':
      return `running:${part.state.title ?? ''}:${JSON.stringify(part.state.metadata ?? {})}`
    case 'completed':
      return `completed:${part.state.output}:${JSON.stringify(part.state.metadata)}`
    case 'error':
      return `error:${part.state.error}:${JSON.stringify(part.state.metadata ?? {})}`
  }
}

function readTokenUsage(message: OpencodeAssistantMessage): TokenUsage {
  return {
    promptTokens: message.tokens.input,
    completionTokens: message.tokens.output + message.tokens.reasoning,
    totalTokens: message.tokens.input + message.tokens.output + message.tokens.reasoning,
  }
}

function readFinishReason(finish: string | undefined): Extract<UIMessageChunk, { type: 'finish' }>['finishReason'] {
  switch (finish) {
    case 'length':
      return 'length'
    case 'error':
      return 'error'
    case 'cancelled':
    case 'abort':
      return 'stop'
    default:
      return 'stop'
  }
}

function formatOpencodeStreamError(error: OpencodeAssistantMessage['error'] | undefined): string {
  if (!error) {
    return 'OpenCode session failed.'
  }
  switch (error.name) {
    case 'ProviderAuthError':
      return `Provider authentication failed for ${error.data.providerID}: ${error.data.message}`
    case 'UnknownError':
    case 'MessageAbortedError':
      return error.data.message
    case 'MessageOutputLengthError':
      return `Message output length exceeded: ${JSON.stringify(error.data)}`
    case 'APIError':
      return error.data.statusCode === undefined
        ? error.data.message
        : `${error.data.statusCode}: ${error.data.message}`
  }
}
