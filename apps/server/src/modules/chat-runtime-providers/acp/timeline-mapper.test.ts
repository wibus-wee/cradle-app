import type { SessionUpdate } from '@agentclientprotocol/sdk'
import { describe, expect, it } from 'vitest'

import { assertValidProviderChunkSequence } from '../kit/testing/chunk-contract'
import { AcpChunkMapper } from './timeline-mapper'

describe('acp chunk mapper', () => {
  it('projects scripted ACP timeline updates into a valid provider chunk sequence', () => {
    const mapper = new AcpChunkMapper()

    const chunks = [
      ...mapper.convert({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Working' },
      } as SessionUpdate),
      ...mapper.convert({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: ' done' },
      } as SessionUpdate),
      ...mapper.convert({
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-1',
        title: 'read_file',
        status: 'pending',
      } as SessionUpdate),
      ...mapper.convert({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tool-1',
        status: 'completed',
        rawOutput: 'file contents',
      } as SessionUpdate),
      ...mapper.flush(),
    ]

    // tool_call without rawInput only emits tool-input-start; input deltas /
    // tool-input-available appear only when rawInput is present on the call
    // or a later tool_call_update.
    expect(chunks.map(chunk => chunk.type)).toEqual([
      'text-start',
      'text-delta',
      'text-delta',
      'tool-input-start',
      'tool-output-available',
      'text-end',
    ])
    assertValidProviderChunkSequence(chunks)
  })
})
