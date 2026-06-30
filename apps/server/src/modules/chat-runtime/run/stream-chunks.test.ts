import { describe, expect, it } from 'vitest'

import { mergeBufferedStreamChunk } from './stream-chunks'

describe('mergeBufferedStreamChunk', () => {
  it('keeps only the latest replay tool output snapshot for a tool call', () => {
    const merged = mergeBufferedStreamChunk(
      {
        type: 'tool-output-available',
        toolCallId: 'toolu_subagent',
        output: { partCount: 2 },
        preliminary: true,
      },
      {
        type: 'tool-output-available',
        toolCallId: 'toolu_subagent',
        output: { partCount: 24 },
      },
      8_192,
    )

    expect(merged).toEqual({
      type: 'tool-output-available',
      toolCallId: 'toolu_subagent',
      output: { partCount: 24 },
    })
  })

  it('does not merge replay tool outputs from different tool calls', () => {
    const merged = mergeBufferedStreamChunk(
      {
        type: 'tool-output-available',
        toolCallId: 'toolu_first',
        output: { partCount: 2 },
      },
      {
        type: 'tool-output-available',
        toolCallId: 'toolu_second',
        output: { partCount: 24 },
      },
      8_192,
    )

    expect(merged).toBeNull()
  })
})
