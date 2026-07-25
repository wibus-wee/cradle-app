import scope from '../../protocol/core-scope.json'
import grammar from '../../protocol/openai/stream-grammar.json'
import type { ProtocolTrace } from '../anthropic/state-machine'
import type { JsonObject, JsonValue, StreamStep } from '../contract'
import { isJsonObject } from '../contract'

export class UnsupportedProtocolVariantError extends Error {
  override readonly name: string = 'UnsupportedProtocolVariantError'
}

export class OpenAiProtocolError extends Error {
  override readonly name: string = 'OpenAiProtocolError'
}

interface ItemCorrelation {
  readonly outputIndex?: number
  readonly itemIndex?: number
  readonly callId?: string
}

const transitionByEvent = new Map(
  grammar.transitions.map(transition => [transition.event, transition]),
)
const terminalTypes = new Set([
  'response.completed',
  'response.failed',
  'response.incomplete',
  'error',
])

assertRegistry()

export function validateOpenAiStream(steps: readonly StreamStep[]): ProtocolTrace {
  let terminal = false
  let previousSequence = -1
  let responseId: string | undefined
  const items = new Map<string, ItemCorrelation>()
  const contentIndices = new Set<string>()
  const transitions = new Set<string>()
  const correlations = new Set<string>()

  for (const step of steps) {
    if (step.kind === 'disconnect') {
      if (terminal) { throw new OpenAiProtocolError('disconnect follows a terminal event') }
      takeTransition('disconnect', transitions)
      terminal = true
      correlations.add('terminal-forbids-events')
      continue
    }
    if (step.kind !== 'event') { continue }
    const event = record(step.event)
    const type = string(event.type)
    if (!scope.openai.events.includes(type as never)) {
      throw new UnsupportedProtocolVariantError(`Unsupported OpenAI event type "${type}"`)
    }
    if (terminal) {
      throw new OpenAiProtocolError(`Event "${type}" follows a terminal event`)
    }
    takeTransition(type, transitions)

    if (typeof event.sequence_number === 'number') {
      if (event.sequence_number <= previousSequence) {
        throw new OpenAiProtocolError('sequence_number must increase')
      }
      previousSequence = event.sequence_number
      correlations.add('sequence-number-increases')
    }

    const currentResponseId = responseIdentity(event)
    if (currentResponseId) {
      responseId ??= currentResponseId
      if (currentResponseId !== responseId) {
        throw new OpenAiProtocolError('response_id changed')
      }
      correlations.add('response-id-stable')
    }

    if (type === 'response.output_item.added') {
      const item = record(event.item)
      const itemId = string(item.id)
      const outputIndex = optionalNumber(event.output_index)
      const itemIndex = optionalNumber(event.item_index)
      const callId = typeof item.call_id === 'string' ? item.call_id : undefined
      if (
        typeof item.type === 'string'
        && !scope.openai.outputTypes.includes(item.type as never)
      ) {
        throw new UnsupportedProtocolVariantError(
          `Unsupported OpenAI output type "${item.type}"`,
        )
      }
      items.set(itemId, {
        ...(outputIndex === undefined ? {} : { outputIndex }),
        ...(itemIndex === undefined ? {} : { itemIndex }),
        ...(callId === undefined ? {} : { callId }),
      })
      correlations.add('item-id-known')
      if (outputIndex !== undefined) { correlations.add('output-index-stable') }
      if (itemIndex !== undefined) { correlations.add('item-index-stable') }
      if (callId !== undefined) { correlations.add('call-id-stable') }
    }

    const eventItem = event.item
    const itemId = typeof event.item_id === 'string'
      ? event.item_id
      : eventItem !== undefined && isJsonObject(eventItem) && typeof eventItem.id === 'string'
        ? eventItem.id
        : undefined
    if (itemId && type !== 'response.output_item.added') {
      const item = items.get(itemId)
      if (!item) { throw new OpenAiProtocolError(`Unknown item_id "${itemId}"`) }
      correlations.add('item-id-known')
      const outputIndex = optionalNumber(event.output_index)
      if (
        outputIndex !== undefined
        && item.outputIndex !== undefined
        && outputIndex !== item.outputIndex
      ) {
        throw new OpenAiProtocolError(`output_index changed for item "${itemId}"`)
      }
      if (outputIndex !== undefined) { correlations.add('output-index-stable') }
      const itemIndex = optionalNumber(event.item_index)
      if (
        itemIndex !== undefined
        && item.itemIndex !== undefined
        && itemIndex !== item.itemIndex
      ) {
        throw new OpenAiProtocolError(`item_index changed for item "${itemId}"`)
      }
      if (itemIndex !== undefined) { correlations.add('item-index-stable') }
      if (typeof event.call_id === 'string') {
        if (item.callId && event.call_id !== item.callId) {
          throw new OpenAiProtocolError(`call_id changed for item "${itemId}"`)
        }
        correlations.add('call-id-stable')
      }
    }

    const contentIndex = optionalNumber(event.content_index)
    if (contentIndex !== undefined) {
      if (!itemId) {
        throw new OpenAiProtocolError('content_index requires an item_id')
      }
      const key = `${itemId}:${contentIndex}`
      if (type === 'response.content_part.added') { contentIndices.add(key) }
      else if (!contentIndices.has(key)) {
        throw new OpenAiProtocolError(
          `Unknown content_index ${contentIndex} for item "${itemId}"`,
        )
      }
      correlations.add('content-index-stable')
    }

    if (terminalTypes.has(type)) {
      terminal = true
      correlations.add('terminal-forbids-events')
    }
  }

  return {
    transitions: Array.from(transitions, id => `openai:transition:${id}`).sort(),
    correlations: [...correlations].sort(),
    terminal,
  }
}

function takeTransition(event: string, trace: Set<string>): void {
  const transition = transitionByEvent.get(event)
  if (!transition) {
    throw new OpenAiProtocolError(`No transition registry entry for "${event}"`)
  }
  trace.add(transition.id)
}

function assertRegistry(): void {
  const registered = new Set(grammar.transitions.map(transition => transition.event))
  const missing = [...scope.openai.events].filter(event => !registered.has(event))
  if (missing.length > 0) {
    throw new OpenAiProtocolError(`Missing OpenAI transition families: ${missing.join(', ')}`)
  }
  for (const item of [...grammar.transitions, ...grammar.correlations]) {
    if (!item.evidence.startsWith('documented:') && !item.evidence.startsWith('simulator:')) {
      throw new OpenAiProtocolError(`Invalid evidence tag for "${item.id}"`)
    }
  }
}

function responseIdentity(event: JsonObject): string | undefined {
  if (typeof event.response_id === 'string') { return event.response_id }
  const response = event.response
  if (response !== undefined && isJsonObject(response) && typeof response.id === 'string') {
    return response.id
  }
  return undefined
}

function record(value: JsonValue | undefined): JsonObject {
  if (value === undefined || !isJsonObject(value)) {
    throw new OpenAiProtocolError('Expected object event payload')
  }
  return value
}

function string(value: JsonValue | undefined): string {
  if (typeof value !== 'string') {
    throw new OpenAiProtocolError('Expected string event field')
  }
  return value
}

function optionalNumber(value: JsonValue | undefined): number | undefined {
  if (value === undefined) { return undefined }
  if (typeof value !== 'number') {
    throw new OpenAiProtocolError('Expected numeric event field')
  }
  return value
}
