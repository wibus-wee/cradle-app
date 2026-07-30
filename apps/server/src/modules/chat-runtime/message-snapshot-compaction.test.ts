import type { UIMessage } from 'ai'
import { afterEach, describe, expect, it } from 'vitest'

import { compactTransientMessageSnapshot } from './message-snapshot-compaction'

const ENV_NAMES = [
  'CRADLE_CHAT_STORED_TEXT_MAX_CHARS',
  'CRADLE_CHAT_STORED_REASONING_MAX_CHARS',
  'CRADLE_CHAT_STORED_TOOL_PAYLOAD_MAX_CHARS',
] as const

const previousEnv = Object.fromEntries(
  ENV_NAMES.map(name => [name, process.env[name]]),
)

afterEach(() => {
  for (const name of ENV_NAMES) {
    const value = previousEnv[name]
    if (value === undefined) {
      delete process.env[name]
    }
    else {
      process.env[name] = value
    }
  }
})

describe('compactTransientMessageSnapshot', () => {
  it('keeps a valid UIMessage while bounding repeated checkpoint payloads', () => {
    process.env.CRADLE_CHAT_STORED_TEXT_MAX_CHARS = '8'
    process.env.CRADLE_CHAT_STORED_REASONING_MAX_CHARS = '6'
    process.env.CRADLE_CHAT_STORED_TOOL_PAYLOAD_MAX_CHARS = '12'

    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [
        { type: 'text', text: '1234567890' },
        { type: 'reasoning', text: 'abcdefgh' },
        {
          type: 'dynamic-tool',
          toolCallId: 'call-1',
          toolName: 'large-tool',
          state: 'output-available',
          input: { query: 'long input payload' },
          output: { result: 'long output payload' },
        },
      ],
    } as UIMessage

    const compacted = compactTransientMessageSnapshot(message)
    const [textPart, reasoningPart, toolPart] = compacted.parts

    expect(compacted).toMatchObject({
      id: 'assistant-1',
      role: 'assistant',
    })
    expect(textPart).toMatchObject({
      type: 'text',
      text: '12345678',
      providerMetadata: {
        cradle: { truncated: true, originalChars: 10 },
      },
    })
    expect(reasoningPart).toMatchObject({
      type: 'reasoning',
      text: 'abcdef',
      providerMetadata: {
        cradle: { truncated: true, originalChars: 8 },
      },
    })
    expect(toolPart).toMatchObject({
      type: 'dynamic-tool',
      toolCallId: 'call-1',
      input: {
        type: 'cradle.truncated-json-payload.v1',
      },
      output: {
        type: 'cradle.truncated-json-payload.v1',
      },
    })
    expect(JSON.stringify(compacted)).not.toContain('long input payload')
    expect(JSON.stringify(compacted)).not.toContain('long output payload')
    expect(message.parts[0]).toEqual({ type: 'text', text: '1234567890' })
  })
})
