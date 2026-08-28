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

    // Every native call publishes canonical input, including calls without raw input.
    expect(chunks.map(chunk => chunk.type)).toEqual([
      'text-start',
      'text-delta',
      'text-delta',
      'tool-input-start',
      'tool-input-available',
      'tool-output-available',
      'text-end',
    ])
    assertValidProviderChunkSequence(chunks)
    expect(chunks.find(chunk => chunk.type === 'tool-input-available')).toMatchObject({
      input: {
        type: 'cradle.builtin-tool-call.input.v1',
        identifier: 'acp',
        kind: 'generic',
      },
    })
  })

  it('projects image, audio, resource-link, and embedded-resource content', () => {
    const mapper = new AcpChunkMapper()
    const chunks = [
      ...mapper.convert({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' },
      } as SessionUpdate),
      ...mapper.convert({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'audio', mimeType: 'audio/wav', data: 'YXVkaW8=' },
      } as SessionUpdate),
      ...mapper.convert({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'resource_link', uri: 'https://example.test/file', mimeType: 'text/plain', name: 'file' },
      } as SessionUpdate),
      ...mapper.convert({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'resource', resource: { uri: 'file:///result.bin', mimeType: 'application/octet-stream', blob: 'YmxvYg==' } },
      } as SessionUpdate),
    ]

    expect(chunks).toEqual([
      { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,aW1hZ2U=' },
      { type: 'file', mediaType: 'audio/wav', url: 'data:audio/wav;base64,YXVkaW8=' },
      { type: 'file', mediaType: 'text/plain', url: 'https://example.test/file' },
      { type: 'file', mediaType: 'application/octet-stream', url: 'data:application/octet-stream;base64,YmxvYg==' },
    ])
  })
})
