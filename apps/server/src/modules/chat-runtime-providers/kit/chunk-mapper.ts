import type { UIMessageChunk } from 'ai'

import type { RuntimeWarningPartData } from '../../chat-runtime/runtime-provider-types'

type TextStartChunk = Extract<UIMessageChunk, { type: 'text-start' }>
type TextDeltaChunk = Extract<UIMessageChunk, { type: 'text-delta' }>
type TextEndChunk = Extract<UIMessageChunk, { type: 'text-end' }>
type ReasoningStartChunk = Extract<UIMessageChunk, { type: 'reasoning-start' }>
type ReasoningDeltaChunk = Extract<UIMessageChunk, { type: 'reasoning-delta' }>
type ReasoningEndChunk = Extract<UIMessageChunk, { type: 'reasoning-end' }>
type ToolInputStartChunk = Extract<UIMessageChunk, { type: 'tool-input-start' }>
type ToolInputAvailableChunk = Extract<UIMessageChunk, { type: 'tool-input-available' }>
type ToolInputDeltaChunk = Extract<UIMessageChunk, { type: 'tool-input-delta' }>
type ToolOutputAvailableChunk = Extract<UIMessageChunk, { type: 'tool-output-available' }>
type ToolOutputErrorChunk = Extract<UIMessageChunk, { type: 'tool-output-error' }>
type ToolApprovalRequestChunk = Extract<UIMessageChunk, { type: 'tool-approval-request' }>
type FinishChunk = Extract<UIMessageChunk, { type: 'finish' }>
type FileChunk = Extract<UIMessageChunk, { type: 'file' }>

function textStart(id: string, providerMetadata?: TextStartChunk['providerMetadata']): TextStartChunk {
  return providerMetadata === undefined
    ? { type: 'text-start', id }
    : { type: 'text-start', id, providerMetadata }
}

function textDelta(id: string, delta: string): TextDeltaChunk {
  return { type: 'text-delta', id, delta }
}

function textEnd(id: string): TextEndChunk {
  return { type: 'text-end', id }
}

function textBlock(id: string, text: string): UIMessageChunk[] {
  return text
    ? [textStart(id), textDelta(id, text), textEnd(id)]
    : []
}

function reasoningStart(id: string): ReasoningStartChunk {
  return { type: 'reasoning-start', id }
}

function reasoningDelta(id: string, delta: string): ReasoningDeltaChunk {
  return { type: 'reasoning-delta', id, delta }
}

function reasoningEnd(id: string): ReasoningEndChunk {
  return { type: 'reasoning-end', id }
}

function reasoningBlock(id: string, delta: string): UIMessageChunk[] {
  return delta
    ? [reasoningStart(id), reasoningDelta(id, delta), reasoningEnd(id)]
    : []
}

function toolInputStart(toolCallId: string, toolName: string): ToolInputStartChunk {
  return { type: 'tool-input-start', toolCallId, toolName }
}

function toolInputAvailable({
  toolCallId,
  toolName,
  input,
}: {
  toolCallId: string
  toolName: string
  input: unknown
}): ToolInputAvailableChunk {
  return { type: 'tool-input-available', toolCallId, toolName, input }
}

function toolInputDelta(toolCallId: string, inputTextDelta: string): ToolInputDeltaChunk {
  return { type: 'tool-input-delta', toolCallId, inputTextDelta }
}

function toolOutputAvailable({
  toolCallId,
  output,
  preliminary,
}: {
  toolCallId: string
  output: unknown
  preliminary?: boolean
}): ToolOutputAvailableChunk {
  return preliminary === undefined
    ? { type: 'tool-output-available', toolCallId, output }
    : { type: 'tool-output-available', toolCallId, output, preliminary }
}

function toolOutputError(toolCallId: string, errorText: string): ToolOutputErrorChunk {
  return { type: 'tool-output-error', toolCallId, errorText }
}

function toolApprovalRequest(toolCallId: string, approvalId: string = toolCallId): ToolApprovalRequestChunk {
  return { type: 'tool-approval-request', toolCallId, approvalId }
}

function finish(finishReason: FinishChunk['finishReason']): FinishChunk {
  return { type: 'finish', finishReason }
}

function file({
  mediaType,
  url,
}: {
  mediaType: string
  url: string
}): FileChunk {
  return { type: 'file', mediaType, url }
}

function runtimeWarning(data: RuntimeWarningPartData): UIMessageChunk {
  return { type: 'data-runtime-warning', data }
}

export const providerChunk = {
  file,
  finish,
  reasoningBlock,
  reasoningDelta,
  reasoningEnd,
  reasoningStart,
  runtimeWarning,
  textBlock,
  textDelta,
  textEnd,
  textStart,
  toolApprovalRequest,
  toolInputAvailable,
  toolInputDelta,
  toolInputStart,
  toolOutputAvailable,
  toolOutputError,
}
