import { describe, expect, it } from 'vitest'

import type { StreamStep } from '../src/contract'
import { validateOpenAiStream } from '../src/openai/state-machine'

const event = (type: string, sequence_number: number, extra = {}): StreamStep => ({
  kind: 'event',
  event: { type, sequence_number, ...extra },
})

describe('openAI Responses stream grammar', () => {
  it('accepts every retained core event family', () => {
    const types = [
      'response.queued',
      'response.created',
      'response.in_progress',
      'response.output_item.added',
      'response.output_item.done',
      'response.content_part.added',
      'response.content_part.done',
      'response.output_text.delta',
      'response.output_text.done',
      'response.refusal.delta',
      'response.refusal.done',
      'response.reasoning_summary_part.added',
      'response.reasoning_summary_part.done',
      'response.reasoning_summary_text.delta',
      'response.reasoning_summary_text.done',
      'response.reasoning_text.delta',
      'response.reasoning_text.done',
      'response.function_call_arguments.delta',
      'response.function_call_arguments.done',
      'response.completed',
    ]
    const steps = types.map((type, index) =>
      event(type, index, {
        ...(type === 'response.output_item.added'
          ? { item: { id: 'item_1', type: 'message' } }
          : {}),
        ...(type.includes('content_part') || type.includes('output_text') || type.includes('refusal')
          ? { item_id: 'item_1' }
          : {}),
      }))
    expect(() => validateOpenAiStream(steps)).not.toThrow()
  })

  it('accepts each terminal outcome and rejects bad correlations or excluded variants', () => {
    for (const terminal of ['response.failed', 'response.incomplete', 'error']) { expect(() => validateOpenAiStream([event(terminal, 0)])).not.toThrow() }
    expect(() =>
      validateOpenAiStream([
        event('response.output_text.delta', 0, { item_id: 'missing' }),
      ])).toThrow('Unknown item_id')
    expect(() =>
      validateOpenAiStream([event('response.image_generation_call.in_progress', 0)])).toThrow('Unsupported')
    expect(() =>
      validateOpenAiStream([event('response.completed', 0), event('response.created', 1)])).toThrow('terminal')
  })
})
