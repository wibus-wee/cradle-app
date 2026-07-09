import type {
  AssistantMessage as OpencodeAssistantMessage,
  Event as OpencodeLegacyEvent,
  Part as OpencodePart,
  ToolPart as OpencodeToolPart,
} from '@opencode-ai/sdk'
import type { Event as OpencodeRootEvent } from '@opencode-ai/sdk/v2'
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

type OpencodeSessionNextTextDeltaEvent = {
  type: 'session.next.text.delta'
  properties: {
    sessionID: string
    timestamp?: number
    delta: string
  }
}

type OpencodeSessionNextTextEndedEvent = {
  type: 'session.next.text.ended'
  properties: {
    sessionID: string
    timestamp?: number
    text: string
  }
}

type OpencodeSessionNextReasoningDeltaEvent = {
  type: 'session.next.reasoning.delta'
  properties: {
    sessionID: string
    timestamp?: number
    reasoningID: string
    delta: string
  }
}

type OpencodeSessionNextReasoningEndedEvent = {
  type: 'session.next.reasoning.ended'
  properties: {
    sessionID: string
    timestamp?: number
    reasoningID: string
    text?: string
  }
}

type OpencodeSessionNextToolCalledEvent = {
  type: 'session.next.tool.called'
  properties: {
    sessionID: string
    timestamp?: number
    callID: string
    tool: string
    input?: unknown
    provider?: unknown
  }
}

type OpencodeSessionNextToolProgressEvent = {
  type: 'session.next.tool.progress'
  properties: {
    sessionID: string
    timestamp?: number
    callID: string
    content?: unknown
    structured?: unknown
    provider?: unknown
  }
}

type OpencodeSessionNextToolSuccessEvent = {
  type: 'session.next.tool.success'
  properties: {
    sessionID: string
    timestamp?: number
    callID: string
    content?: unknown
    structured?: unknown
    provider?: unknown
  }
}

type OpencodeSessionNextToolFailedEvent = {
  type: 'session.next.tool.failed'
  properties: {
    sessionID: string
    timestamp?: number
    callID: string
    provider?: unknown
    error: {
      message?: string
      [key: string]: unknown
    }
  }
}

type OpencodeSessionNextStepEndedEvent = {
  type: 'session.next.step.ended'
  properties: {
    sessionID: string
    timestamp?: number
    finish?: string
    cost?: number
    tokens?: {
      input?: number
      output?: number
      reasoning?: number
      cache?: {
        read?: number
        write?: number
      }
    }
  }
}

type OpencodeSessionNextStepFailedEvent = {
  type: 'session.next.step.failed'
  properties: {
    sessionID: string
    timestamp?: number
    error: {
      message?: string
      [key: string]: unknown
    }
  }
}

type OpencodeSessionNextRetriedEvent = {
  type: 'session.next.retried'
  properties: {
    sessionID: string
    timestamp?: number
    error: {
      message?: string
      [key: string]: unknown
    }
  }
}

type OpencodeSessionNextEvent
  = | OpencodeSessionNextTextDeltaEvent
    | OpencodeSessionNextTextEndedEvent
    | OpencodeSessionNextReasoningDeltaEvent
    | OpencodeSessionNextReasoningEndedEvent
    | OpencodeSessionNextToolCalledEvent
    | OpencodeSessionNextToolProgressEvent
    | OpencodeSessionNextToolSuccessEvent
    | OpencodeSessionNextToolFailedEvent
    | OpencodeSessionNextStepEndedEvent
    | OpencodeSessionNextStepFailedEvent
    | OpencodeSessionNextRetriedEvent

export type OpencodeStreamEvent
  = | OpencodeLegacyEvent
    | OpencodeRootEvent
    | OpencodeMessagePartDeltaEvent
    | OpencodeSessionNextEvent

interface TextPartProjection {
  kind: 'text' | 'reasoning'
  emittedText: string
  started: boolean
  ended: boolean
}

interface ToolPartProjection {
  inputAvailable: boolean
  inputKey: string | null
  outputKey: string | null
  toolName?: string
}

const OPENCODE_NEXT_TEXT_PART_ID = 'opencode-session-next-text'

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
          const info = event.properties.info as OpencodeAssistantMessage
          this._usage = readTokenUsage(info)
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
        return this.projectPart(event.properties.part as OpencodePart)

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

      case 'session.next.text.delta':
        if (event.properties.sessionID !== this.sessionId || event.properties.delta.length === 0) {
          return []
        }
        return this.projectTextDelta({
          id: OPENCODE_NEXT_TEXT_PART_ID,
          kind: 'text',
          delta: event.properties.delta,
        })

      case 'session.next.text.ended':
        if (event.properties.sessionID !== this.sessionId) {
          return []
        }
        return this.projectTextEnded({
          id: OPENCODE_NEXT_TEXT_PART_ID,
          kind: 'text',
          text: event.properties.text,
        })

      case 'session.next.reasoning.delta':
        if (event.properties.sessionID !== this.sessionId || event.properties.delta.length === 0) {
          return []
        }
        return this.projectTextDelta({
          id: event.properties.reasoningID,
          kind: 'reasoning',
          delta: event.properties.delta,
        })

      case 'session.next.reasoning.ended':
        if (event.properties.sessionID !== this.sessionId) {
          return []
        }
        return this.projectTextEnded({
          id: event.properties.reasoningID,
          kind: 'reasoning',
          text: event.properties.text ?? '',
        })

      case 'session.next.tool.called':
        if (event.properties.sessionID !== this.sessionId) {
          return []
        }
        return this.projectNextToolCalled(event)

      case 'session.next.tool.progress':
      case 'session.next.tool.success':
        if (event.properties.sessionID !== this.sessionId) {
          return []
        }
        return this.projectNextToolOutput(event)

      case 'session.next.tool.failed':
        if (event.properties.sessionID !== this.sessionId) {
          return []
        }
        return this.projectNextToolFailed(event)

      case 'session.next.step.ended':
        if (event.properties.sessionID !== this.sessionId) {
          return []
        }
        this._usage = readStepTokenUsage(event.properties.tokens)
        return isTerminalOpencodeStepFinish(event.properties.finish)
          ? [providerChunk.finish(readFinishReason(event.properties.finish))]
          : [{
              type: 'data-runtime-event',
              data: {
                kind: `opencode.${event.type}`,
                event,
              },
            }]

      case 'session.next.step.failed':
        if (event.properties.sessionID !== this.sessionId) {
          return []
        }
        return [{
          type: 'error',
          errorText: formatOpencodeStepFailedMessage(event),
        }]

      case 'session.next.retried':
        if (event.properties.sessionID !== this.sessionId) {
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
      this.bufferPendingTextDelta(partId, delta)
      return []
    }
    if (this.messageRoles.get(part.messageID) !== 'assistant') {
      this.bufferPendingTextDelta(partId, delta)
      return []
    }
    return this.projectTextDelta({
      id: part.id,
      kind: part.type,
      delta,
    })
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
    const text = pendingDelta.length > 0
      ? appendOpencodeAssistantTextDelta(part.text, pendingDelta).nextText
      : part.text
    const projection = this.ensureTextProjection(part.id, part.type)
    const { latestText, deltaToEmit } = mergeOpencodeAssistantText(projection.emittedText, text)
    projection.emittedText = latestText

    const chunks: UIMessageChunk[] = []
    const startChunk = this.startTextChunk(part.id, part.type, projection)
    if (startChunk) {
      chunks.push(startChunk)
    }
    if (deltaToEmit.length > 0) {
      chunks.push(this.deltaTextChunk(part.id, part.type, deltaToEmit))
    }
    if (part.time?.end !== undefined && !projection.ended) {
      projection.ended = true
      chunks.push(part.type === 'text'
        ? providerChunk.textEnd(part.id)
        : providerChunk.reasoningEnd(part.id))
    }
    return chunks
  }

  private projectTextDelta(input: {
    id: string
    kind: TextPartProjection['kind']
    delta: string
  }): UIMessageChunk[] {
    const projection = this.ensureTextProjection(input.id, input.kind)
    const { nextText, deltaToEmit } = appendOpencodeAssistantTextDelta(projection.emittedText, input.delta)
    if (deltaToEmit.length === 0) {
      return []
    }
    projection.emittedText = nextText
    return [
      this.startTextChunk(input.id, input.kind, projection),
      this.deltaTextChunk(input.id, input.kind, deltaToEmit),
    ].filter((chunk): chunk is UIMessageChunk => chunk !== null)
  }

  private projectTextEnded(input: {
    id: string
    kind: TextPartProjection['kind']
    text: string
  }): UIMessageChunk[] {
    const projection = this.ensureTextProjection(input.id, input.kind)
    const { latestText, deltaToEmit } = mergeOpencodeAssistantText(projection.emittedText, input.text)
    projection.emittedText = latestText
    if (!projection.started && latestText.length === 0) {
      projection.ended = true
      return []
    }

    const chunks: UIMessageChunk[] = []
    const startChunk = this.startTextChunk(input.id, input.kind, projection)
    if (startChunk) {
      chunks.push(startChunk)
    }
    if (deltaToEmit.length > 0) {
      chunks.push(this.deltaTextChunk(input.id, input.kind, deltaToEmit))
    }
    if (!projection.ended) {
      projection.ended = true
      chunks.push(input.kind === 'text'
        ? providerChunk.textEnd(input.id)
        : providerChunk.reasoningEnd(input.id))
    }
    return chunks
  }

  private projectToolPart(part: OpencodeToolPart): UIMessageChunk[] {
    const projection = this.toolParts.get(part.callID) ?? {
      inputAvailable: false,
      inputKey: null,
      outputKey: null,
      toolName: part.tool,
    }
    projection.toolName = part.tool
    this.toolParts.set(part.callID, projection)

    const chunks: UIMessageChunk[] = []
    if (!projection.inputAvailable) {
      projection.inputAvailable = true
      chunks.push(
        providerChunk.toolInputStart(part.callID, part.tool),
      )
    }

    const input = buildOpencodeToolInput(part)
    const inputKey = JSON.stringify(input)
    if (inputKey !== projection.inputKey) {
      projection.inputKey = inputKey
      chunks.push(providerChunk.toolInputAvailable({
        toolCallId: part.callID,
        toolName: part.tool,
        input,
      }))
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

  private projectNextToolCalled(event: OpencodeSessionNextToolCalledEvent): UIMessageChunk[] {
    const projection = this.toolParts.get(event.properties.callID) ?? {
      inputAvailable: false,
      inputKey: null,
      outputKey: null,
      toolName: event.properties.tool,
    }
    projection.toolName = event.properties.tool
    this.toolParts.set(event.properties.callID, projection)

    const chunks = this.ensureNextToolStarted(event.properties.callID, projection)
    const input = {
      args: event.properties.input ?? {},
      ...(event.properties.provider === undefined ? {} : { provider: event.properties.provider }),
    }
    const inputKey = JSON.stringify(input)
    if (inputKey !== projection.inputKey) {
      projection.inputKey = inputKey
      chunks.push(providerChunk.toolInputAvailable({
        toolCallId: event.properties.callID,
        toolName: event.properties.tool,
        input,
      }))
    }
    return chunks
  }

  private projectNextToolOutput(
    event: OpencodeSessionNextToolProgressEvent | OpencodeSessionNextToolSuccessEvent,
  ): UIMessageChunk[] {
    const projection = this.toolParts.get(event.properties.callID) ?? {
      inputAvailable: false,
      inputKey: null,
      outputKey: null,
      toolName: 'opencode_tool',
    }
    this.toolParts.set(event.properties.callID, projection)
    const chunks = this.ensureNextToolStarted(event.properties.callID, projection)
    const output = {
      content: event.properties.content ?? null,
      structured: event.properties.structured ?? null,
      ...(event.properties.provider === undefined ? {} : { provider: event.properties.provider }),
    }
    const outputKey = `${event.type}:${JSON.stringify(output)}`
    if (outputKey !== projection.outputKey) {
      projection.outputKey = outputKey
      chunks.push(providerChunk.toolOutputAvailable({
        toolCallId: event.properties.callID,
        output,
        preliminary: event.type === 'session.next.tool.progress',
      }))
    }
    return chunks
  }

  private projectNextToolFailed(event: OpencodeSessionNextToolFailedEvent): UIMessageChunk[] {
    const projection = this.toolParts.get(event.properties.callID) ?? {
      inputAvailable: false,
      inputKey: null,
      outputKey: null,
      toolName: 'opencode_tool',
    }
    this.toolParts.set(event.properties.callID, projection)
    return [
      ...this.ensureNextToolStarted(event.properties.callID, projection),
      providerChunk.toolOutputError(event.properties.callID, event.properties.error.message ?? 'OpenCode tool failed.'),
    ]
  }

  private ensureNextToolStarted(
    toolCallId: string,
    projection: ToolPartProjection,
  ): UIMessageChunk[] {
    if (projection.inputAvailable) {
      return []
    }
    projection.inputAvailable = true
    return [providerChunk.toolInputStart(toolCallId, projection.toolName ?? 'opencode_tool')]
  }

  private ensureTextProjection(
    id: string,
    kind: TextPartProjection['kind'],
  ): TextPartProjection {
    const existing = this.textParts.get(id)
    if (existing) {
      return existing
    }
    const next: TextPartProjection = {
      kind,
      emittedText: '',
      started: false,
      ended: false,
    }
    this.textParts.set(id, next)
    return next
  }

  private startTextChunk(
    id: string,
    kind: TextPartProjection['kind'],
    projection: TextPartProjection,
  ): UIMessageChunk | null {
    if (projection.started) {
      return null
    }
    projection.started = true
    return kind === 'text'
      ? providerChunk.textStart(id)
      : providerChunk.reasoningStart(id)
  }

  private deltaTextChunk(
    id: string,
    kind: TextPartProjection['kind'],
    delta: string,
  ): UIMessageChunk {
    return kind === 'text'
      ? providerChunk.textDelta(id, delta)
      : providerChunk.reasoningDelta(id, delta)
  }

  private bufferPendingTextDelta(partId: string, delta: string): void {
    const previous = this.pendingTextDeltas.get(partId) ?? ''
    this.pendingTextDeltas.set(partId, appendOpencodeAssistantTextDelta(previous, delta).nextText)
  }
}

/**
 * OpenCode's agent loop continues while `finish` is `tool-calls` or `unknown`.
 * Treating those as terminal closes Cradle turns after the first tool batch.
 */
export function isTerminalOpencodeAssistant(message: OpencodeAssistantMessage): boolean {
  if (message.error !== undefined) {
    return true
  }
  if (message.finish === 'tool-calls' || message.finish === 'unknown') {
    return false
  }
  return message.time.completed !== undefined || message.finish !== undefined
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
  const info = event.properties.info as OpencodeAssistantMessage
  if (
    info.role !== 'assistant'
    || info.sessionID !== input.sessionId
    || input.baselineMessageIds.has(info.id)
  ) {
    return null
  }
  return isTerminalOpencodeAssistant(info) ? info : null
}

export function isTerminalOpencodeStepEndedEvent(event: OpencodeStreamEvent, sessionId: string): boolean {
  return event.type === 'session.next.step.ended'
    && event.properties.sessionID === sessionId
    && isTerminalOpencodeStepFinish(event.properties.finish)
}

export function isOpencodeToolCallStepEndedEvent(event: OpencodeStreamEvent, sessionId: string): boolean {
  return event.type === 'session.next.step.ended'
    && event.properties.sessionID === sessionId
    && isOpenCodeToolCallFinish(event.properties.finish)
}

export function readOpencodeStepFailedMessage(event: OpencodeStreamEvent): string | null {
  return event.type === 'session.next.step.failed'
    ? formatOpencodeStepFailedMessage(event)
    : null
}

function commonPrefixLength(left: string, right: string): number {
  let index = 0
  while (index < left.length && index < right.length && left[index] === right[index]) {
    index += 1
  }
  return index
}

function suffixPrefixOverlap(text: string, delta: string): number {
  const maxLength = Math.min(text.length, delta.length)
  for (let length = maxLength; length > 0; length -= 1) {
    if (text.endsWith(delta.slice(0, length))) {
      return length
    }
  }
  return 0
}

function appendOpencodeAssistantTextDelta(
  previousText: string,
  delta: string,
): { nextText: string, deltaToEmit: string } {
  const deltaToEmit = delta.slice(suffixPrefixOverlap(previousText, delta))
  return {
    nextText: previousText + deltaToEmit,
    deltaToEmit,
  }
}

function resolveLatestAssistantText(previousText: string, nextText: string): string {
  if (previousText.length > nextText.length && previousText.startsWith(nextText)) {
    return previousText
  }
  return nextText
}

function mergeOpencodeAssistantText(
  previousText: string,
  nextText: string,
): { latestText: string, deltaToEmit: string } {
  const latestText = resolveLatestAssistantText(previousText, nextText)
  return {
    latestText,
    deltaToEmit: latestText.slice(commonPrefixLength(previousText, latestText)),
  }
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

function readStepTokenUsage(tokens: OpencodeSessionNextStepEndedEvent['properties']['tokens']): TokenUsage | null {
  if (!tokens) {
    return null
  }
  const promptTokens = tokens.input ?? 0
  const outputTokens = tokens.output ?? 0
  const reasoningTokens = tokens.reasoning ?? 0
  return {
    promptTokens,
    completionTokens: outputTokens + reasoningTokens,
    totalTokens: promptTokens + outputTokens + reasoningTokens,
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

function isTerminalOpencodeStepFinish(finish: string | undefined): boolean {
  if (!finish) {
    return false
  }
  return !isOpenCodeToolCallFinish(finish)
    && finish !== 'function-call'
    && finish !== 'continue'
    && finish !== 'unknown'
}

function isOpenCodeToolCallFinish(finish: string | undefined): boolean {
  return finish === 'tool-call' || finish === 'tool-calls'
}

function formatOpencodeStepFailedMessage(event: OpencodeSessionNextStepFailedEvent): string {
  return event.properties.error.message ?? 'OpenCode session failed.'
}

function formatOpencodeStreamError(error: OpencodeAssistantMessage['error'] | unknown): string {
  const streamError = error as OpencodeAssistantMessage['error'] | undefined
  if (!streamError) {
    return 'OpenCode session failed.'
  }
  switch (streamError.name) {
    case 'ProviderAuthError':
      return `Provider authentication failed for ${streamError.data.providerID}: ${streamError.data.message}`
    case 'UnknownError':
    case 'MessageAbortedError':
      return streamError.data.message
    case 'MessageOutputLengthError':
      return `Message output length exceeded: ${JSON.stringify(streamError.data)}`
    case 'APIError':
      return streamError.data.statusCode === undefined
        ? streamError.data.message
        : `${streamError.data.statusCode}: ${streamError.data.message}`
    default:
      return JSON.stringify(streamError)
  }
}
