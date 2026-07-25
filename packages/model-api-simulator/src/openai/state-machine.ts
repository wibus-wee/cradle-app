import scope from '../../protocol/core-scope.json'
import type { JsonObject, JsonValue, StreamStep } from '../contract'
import { isJsonObject } from '../contract'

export class UnsupportedProtocolVariantError extends Error {
  override readonly name: string = 'UnsupportedProtocolVariantError'
}

export class OpenAiProtocolError extends Error {
  override readonly name: string = 'OpenAiProtocolError'
}

const terminalTypes = new Set([
  'response.completed',
  'response.failed',
  'response.incomplete',
  'error',
])

export function validateOpenAiStream(steps: readonly StreamStep[]): void {
  let terminal = false
  let previousSequence = -1
  let responseId: string | undefined
  const itemIds = new Set<string>()

  for (const step of steps) {
    if (step.kind !== 'event') { continue }
    const event = record(step.event)
    const type = string(event.type)
    if (!scope.openai.events.includes(type as (typeof scope.openai.events)[number])) { throw new UnsupportedProtocolVariantError(`Unsupported OpenAI event type "${type}"`) }
    if (terminal) { throw new OpenAiProtocolError(`Event "${type}" follows a terminal event`) }
    if (typeof event.sequence_number === 'number') {
      if (event.sequence_number <= previousSequence) { throw new OpenAiProtocolError('sequence_number must increase') }
      previousSequence = event.sequence_number
    }
    if (typeof event.response_id === 'string') {
      responseId ??= event.response_id
      if (event.response_id !== responseId) { throw new OpenAiProtocolError('response_id changed') }
    }
    if (type === 'response.output_item.added') {
      const item = record(event.item)
      if (typeof item.id === 'string') { itemIds.add(item.id) }
      if (typeof item.type === 'string' && !scope.openai.outputTypes.includes(item.type as never)) { throw new UnsupportedProtocolVariantError(`Unsupported OpenAI output type "${item.type}"`) }
    }
    if (typeof event.item_id === 'string' && !itemIds.has(event.item_id)) { throw new OpenAiProtocolError(`Unknown item_id "${event.item_id}"`) }
    if (terminalTypes.has(type)) { terminal = true }
  }
}

function record(value: JsonValue | undefined): JsonObject {
  if (value === undefined || !isJsonObject(value)) { throw new OpenAiProtocolError('Expected object event payload') }
  return value
}

function string(value: JsonValue | undefined): string {
  if (typeof value !== 'string') { throw new OpenAiProtocolError('Expected string event field') }
  return value
}
