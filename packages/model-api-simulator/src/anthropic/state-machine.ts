import scope from '../../protocol/core-scope.json'
import type { JsonObject, JsonValue, StreamStep } from '../contract'
import {
  isJsonArray,
  isJsonObject,
} from '../contract'

export class AnthropicProtocolError extends Error {
  override readonly name = 'AnthropicProtocolError'
}

export function validateAnthropicStream(steps: readonly StreamStep[]): void {
  let started = false
  let terminal = false
  let messageDelta = false
  let nextIndex = 0
  const openBlocks = new Set<number>()
  let outputTokens = 0

  for (const step of steps) {
    if (step.kind !== 'event') { continue }
    const event = record(step.event)
    const type = string(event.type)
    if (!scope.anthropic.events.includes(type as (typeof scope.anthropic.events)[number])) { throw new AnthropicProtocolError(`Unsupported Anthropic event type "${type}"`) }
    if (terminal) { throw new AnthropicProtocolError(`Event "${type}" follows a terminal event`) }
    if (type === 'error') {
      terminal = true
      continue
    }
    if (type === 'ping') {
      if (!started) { throw new AnthropicProtocolError('ping before message_start') }
      continue
    }
    if (!started) {
      if (type !== 'message_start') { throw new AnthropicProtocolError(`${type} before message_start`) }
      const message = record(event.message)
      if (!message.content || !isJsonArray(message.content) || message.content.length !== 0) { throw new AnthropicProtocolError('message_start content must be empty') }
      started = true
      continue
    }
    if (type === 'message_start') { throw new AnthropicProtocolError('duplicate message_start') }
    if (type === 'content_block_start') {
      const index = number(event.index)
      if (index !== nextIndex) { throw new AnthropicProtocolError(`Expected content index ${nextIndex}, got ${index}`) }
      const block = record(event.content_block)
      const blockType = string(block.type)
      if (!scope.anthropic.contentBlocks.includes(blockType as never)) { throw new AnthropicProtocolError(`Unsupported Anthropic content block "${blockType}"`) }
      openBlocks.add(index)
      nextIndex += 1
      continue
    }
    if (type === 'content_block_delta' || type === 'content_block_stop') {
      const index = number(event.index)
      if (!openBlocks.has(index)) { throw new AnthropicProtocolError(`Unknown content index ${index}`) }
      if (type === 'content_block_delta') {
        const deltaType = string(record(event.delta).type)
        if (!scope.anthropic.deltas.includes(deltaType as never)) { throw new AnthropicProtocolError(`Unsupported Anthropic delta "${deltaType}"`) }
      }
 else { openBlocks.delete(index) }
      continue
    }
    if (type === 'message_delta') {
      if (openBlocks.size > 0) { throw new AnthropicProtocolError('message_delta while a content block is open') }
      const usage = record(event.usage)
      if (typeof usage.output_tokens === 'number') {
        if (usage.output_tokens < outputTokens) { throw new AnthropicProtocolError('Cumulative output token usage decreased') }
        outputTokens = usage.output_tokens
      }
      messageDelta = true
      continue
    }
    if (type === 'message_stop') {
      if (!messageDelta) { throw new AnthropicProtocolError('message_stop before message_delta') }
      terminal = true
    }
  }
}

function record(value: JsonValue | undefined): JsonObject {
  if (value === undefined || !isJsonObject(value)) { throw new AnthropicProtocolError('Expected object event payload') }
  return value
}

function string(value: JsonValue | undefined): string {
  if (typeof value !== 'string') { throw new AnthropicProtocolError('Expected string event field') }
  return value
}

function number(value: JsonValue | undefined): number {
  if (typeof value !== 'number') { throw new AnthropicProtocolError('Expected numeric event field') }
  return value
}
