import { describe, expect, it } from 'vitest'

import { validateAnthropicStream } from '../src/anthropic/state-machine'
import type { StreamStep } from '../src/contract'

const event = (value: Record<string, unknown>): StreamStep => ({
  kind: 'event',
  event: value as never,
})

function validStream(): StreamStep[] {
  return [
    event({
      type: 'message_start',
      message: { id: 'msg_1', type: 'message', role: 'assistant', content: [] },
    }),
    event({ type: 'ping' }),
    event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }),
    event({ type: 'content_block_stop', index: 0 }),
    event({
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'tool_use', id: 'tool_1', name: 'read', input: {} },
    }),
    event({
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'input_json_delta', partial_json: '{"path":' },
    }),
    event({ type: 'content_block_stop', index: 1 }),
    event({
      type: 'content_block_start',
      index: 2,
      content_block: { type: 'thinking', thinking: '', signature: '' },
    }),
    event({
      type: 'content_block_delta',
      index: 2,
      delta: { type: 'thinking_delta', thinking: 'reason', estimated_tokens: null },
    }),
    event({
      type: 'content_block_delta',
      index: 2,
      delta: { type: 'signature_delta', signature: 'sig' },
    }),
    event({ type: 'content_block_stop', index: 2 }),
    event({
      type: 'content_block_start',
      index: 3,
      content_block: { type: 'redacted_thinking', data: 'redacted' },
    }),
    event({ type: 'content_block_stop', index: 3 }),
    event({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } }),
    event({ type: 'message_stop' }),
  ]
}

describe('anthropic stream grammar', () => {
  it('accepts every retained core variant in documented order', () => {
    expect(() => validateAnthropicStream(validStream())).not.toThrow()
  })

  it('rejects invalid indices, decreasing usage, duplicate stop, and excluded events', () => {
    const invalidIndex = validStream()
    invalidIndex[2] = event({
      type: 'content_block_start',
      index: 2,
      content_block: { type: 'text', text: '' },
    })
    expect(() => validateAnthropicStream(invalidIndex)).toThrow('Expected content index')

    const decreasing = validStream()
    decreasing.splice(
      -1,
      0,
      event({ type: 'message_delta', delta: {}, usage: { output_tokens: 0 } }),
    )
    expect(() => validateAnthropicStream(decreasing)).toThrow('decreased')

    expect(() => validateAnthropicStream([...validStream(), event({ type: 'message_stop' })])).toThrow(
      'terminal',
    )
    expect(() =>
      validateAnthropicStream([
        event({ type: 'message_start', message: { content: [] } }),
        event({ type: 'content_block_delta', index: 0, delta: { type: 'citation_delta' } }),
      ])).toThrow()
  })
})
