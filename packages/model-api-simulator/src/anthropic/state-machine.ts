import grammar from '../../protocol/anthropic/stream-grammar.json'
import scope from '../../protocol/core-scope.json'
import type { JsonObject, JsonValue, StreamStep } from '../contract'
import { isJsonArray, isJsonObject } from '../contract'

export class AnthropicProtocolError extends Error {
  override readonly name = 'AnthropicProtocolError'
}

export interface ProtocolTrace {
  readonly transitions: readonly string[]
  readonly correlations: readonly string[]
  readonly terminal: boolean
}

type Phase = 'idle' | 'message' | 'content' | 'message_delta' | 'terminal'

const transitionByEvent = new Map(
  grammar.transitions.map(transition => [transition.event, transition]),
)

assertRegistry()

export function validateAnthropicStream(steps: readonly StreamStep[]): ProtocolTrace {
  let phase: Phase = 'idle'
  let nextIndex = 0
  const openBlocks = new Set<number>()
  let outputTokens = 0
  const transitions = new Set<string>()
  const correlations = new Set<string>()

  for (const step of steps) {
    if (step.kind === 'disconnect') {
      takeTransition('disconnect', phase, transitions)
      phase = 'terminal'
      correlations.add('terminal-forbids-events')
      continue
    }
    if (step.kind !== 'event') { continue }
    const event = record(step.event)
    const type = string(event.type)
    if (!scope.anthropic.events.includes(type as never)) {
      throw new AnthropicProtocolError(`Unsupported Anthropic event type "${type}"`)
    }
    if (phase === 'terminal') {
      correlations.add('terminal-forbids-events')
      throw new AnthropicProtocolError(`Event "${type}" follows a terminal event`)
    }
    const transition = takeTransition(type, phase, transitions)

    if (type === 'error') {
      phase = 'terminal'
      correlations.add('terminal-forbids-events')
      continue
    }
    if (type === 'ping') { continue }
    if (type === 'message_start') {
      const message = record(event.message)
      if (!message.content || !isJsonArray(message.content) || message.content.length !== 0) {
        throw new AnthropicProtocolError('message_start content must be empty')
      }
      correlations.add('message-start-empty-content')
      phase = 'message'
      continue
    }
    if (type === 'content_block_start') {
      const index = number(event.index)
      if (index !== nextIndex) {
        throw new AnthropicProtocolError(`Expected content index ${nextIndex}, got ${index}`)
      }
      correlations.add('content-index-contiguous')
      const block = record(event.content_block)
      const blockType = string(block.type)
      if (!scope.anthropic.contentBlocks.includes(blockType as never)) {
        throw new AnthropicProtocolError(`Unsupported Anthropic content block "${blockType}"`)
      }
      openBlocks.add(index)
      nextIndex += 1
      phase = 'content'
      continue
    }
    if (type === 'content_block_delta' || type === 'content_block_stop') {
      const index = number(event.index)
      if (!openBlocks.has(index)) {
        throw new AnthropicProtocolError(`Unknown content index ${index}`)
      }
      correlations.add('content-index-open')
      if (type === 'content_block_delta') {
        const deltaType = string(record(event.delta).type)
        if (!scope.anthropic.deltas.includes(deltaType as never)) {
          throw new AnthropicProtocolError(`Unsupported Anthropic delta "${deltaType}"`)
        }
      }
      else {
        openBlocks.delete(index)
        phase = 'message'
      }
      continue
    }
    if (type === 'message_delta') {
      const usage = record(event.usage)
      if (typeof usage.output_tokens === 'number') {
        if (usage.output_tokens < outputTokens) {
          throw new AnthropicProtocolError('Cumulative output token usage decreased')
        }
        outputTokens = usage.output_tokens
      }
      correlations.add('usage-monotonic')
      phase = 'message_delta'
      continue
    }
    if (type === 'message_stop') {
      phase = 'terminal'
      correlations.add('terminal-forbids-events')
      continue
    }
    phase = transition.to === 'same' ? phase : transition.to as Phase
  }

  return {
    transitions: [...transitions].sort(),
    correlations: [...correlations].sort(),
    terminal: phase === 'terminal',
  }
}

function takeTransition(
  event: string,
  phase: Phase,
  trace: Set<string>,
): (typeof grammar.transitions)[number] {
  const transition = transitionByEvent.get(event)
  if (!transition) { throw new AnthropicProtocolError(`No transition registry entry for "${event}"`) }
  if (!(transition.from as string[]).includes(phase)) {
    throw new AnthropicProtocolError(`Event "${event}" is illegal from phase "${phase}"`)
  }
  trace.add(`anthropic:transition:${transition.id}`)
  return transition
}

function assertRegistry(): void {
  const registered = new Set(grammar.transitions.map(transition => transition.event))
  const missing = [...scope.anthropic.events].filter(event => !registered.has(event))
  if (missing.length > 0) {
    throw new AnthropicProtocolError(`Missing Anthropic transition families: ${missing.join(', ')}`)
  }
  for (const item of [...grammar.transitions, ...grammar.correlations]) {
    if (!item.evidence.startsWith('documented:') && !item.evidence.startsWith('simulator:')) {
      throw new AnthropicProtocolError(`Invalid evidence tag for "${item.id}"`)
    }
  }
}

function record(value: JsonValue | undefined): JsonObject {
  if (value === undefined || !isJsonObject(value)) {
    throw new AnthropicProtocolError('Expected object event payload')
  }
  return value
}

function string(value: JsonValue | undefined): string {
  if (typeof value !== 'string') {
    throw new AnthropicProtocolError('Expected string event field')
  }
  return value
}

function number(value: JsonValue | undefined): number {
  if (typeof value !== 'number') {
    throw new AnthropicProtocolError('Expected numeric event field')
  }
  return value
}
