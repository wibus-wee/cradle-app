import type { UIMessageChunk } from 'ai'

export type TerminalChatMessageStatus = 'complete' | 'aborted' | 'failed'
export type ChatMessageStatus = 'streaming' | TerminalChatMessageStatus

export function isTerminalUIMessageChunk(chunk: UIMessageChunk): boolean {
  return chunk.type === 'finish' || chunk.type === 'abort' || chunk.type === 'error'
}

export function readTerminalStatus(chunk: UIMessageChunk): TerminalChatMessageStatus {
  if (chunk.type === 'abort') {
    return 'aborted'
  }
  if (chunk.type === 'error') {
    return 'failed'
  }
  return 'complete'
}

export function readRunDeltaCoalesceKey(chunk: UIMessageChunk): string | null {
  switch (chunk.type) {
    case 'text-delta':
      return `text-delta:${chunk.id}`
    case 'reasoning-delta':
      return `reasoning-delta:${chunk.id}`
    case 'tool-input-delta':
      return `tool-input-delta:${chunk.toolCallId}`
    default:
      return null
  }
}

export function mergeRuntimeDeltaChunk(
  existing: UIMessageChunk,
  next: UIMessageChunk,
): UIMessageChunk | null {
  if (existing.type === 'text-delta' && next.type === 'text-delta' && existing.id === next.id) {
    return {
      ...next,
      delta: `${existing.delta}${next.delta}`,
      providerMetadata: next.providerMetadata ?? existing.providerMetadata,
    }
  }
  if (
    existing.type === 'reasoning-delta'
    && next.type === 'reasoning-delta'
    && existing.id === next.id
  ) {
    return {
      ...next,
      delta: `${existing.delta}${next.delta}`,
      providerMetadata: next.providerMetadata ?? existing.providerMetadata,
    }
  }
  if (
    existing.type === 'tool-input-delta'
    && next.type === 'tool-input-delta'
    && existing.toolCallId === next.toolCallId
  ) {
    return {
      ...next,
      inputTextDelta: `${existing.inputTextDelta}${next.inputTextDelta}`,
    }
  }
  return null
}

export function readDeltaChunkTextLength(chunk: UIMessageChunk): number {
  switch (chunk.type) {
    case 'text-delta':
    case 'reasoning-delta':
      return chunk.delta.length
    case 'tool-input-delta':
      return chunk.inputTextDelta.length
    default:
      return 0
  }
}

export function readReplayCoalesceKey(chunk: UIMessageChunk): string | null {
  switch (chunk.type) {
    case 'text-delta':
      return `text-delta:${chunk.id}`
    case 'reasoning-delta':
      return `reasoning-delta:${chunk.id}`
    case 'tool-input-delta':
      return `tool-input-delta:${chunk.toolCallId}`
    case 'tool-output-available':
      return `tool-output-available:${chunk.toolCallId}`
    default:
      return null
  }
}

export function mergeBufferedStreamChunk(
  existing: UIMessageChunk,
  next: UIMessageChunk,
  maxDeltaChars: number,
): UIMessageChunk | null {
  if (existing.type === 'text-delta' && next.type === 'text-delta' && existing.id === next.id) {
    if (existing.delta.length + next.delta.length > maxDeltaChars) {
      return null
    }
    return {
      ...next,
      delta: `${existing.delta}${next.delta}`,
      providerMetadata: next.providerMetadata ?? existing.providerMetadata,
    }
  }
  if (
    existing.type === 'reasoning-delta'
    && next.type === 'reasoning-delta'
    && existing.id === next.id
  ) {
    if (existing.delta.length + next.delta.length > maxDeltaChars) {
      return null
    }
    return {
      ...next,
      delta: `${existing.delta}${next.delta}`,
      providerMetadata: next.providerMetadata ?? existing.providerMetadata,
    }
  }
  if (
    existing.type === 'tool-input-delta'
    && next.type === 'tool-input-delta'
    && existing.toolCallId === next.toolCallId
  ) {
    if (existing.inputTextDelta.length + next.inputTextDelta.length > maxDeltaChars) {
      return null
    }
    return {
      ...next,
      inputTextDelta: `${existing.inputTextDelta}${next.inputTextDelta}`,
    }
  }
  if (
    existing.type === 'tool-output-available'
    && next.type === 'tool-output-available'
    && existing.toolCallId === next.toolCallId
  ) {
    return next
  }
  return null
}
