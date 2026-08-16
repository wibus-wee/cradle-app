import type { UIMessage, UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import {
  projectChatChunkForClient,
  projectChatMessageForClient,
} from './client-message-projection'

describe('chat client projection', () => {
  it('removes Codex reconstruction items while preserving client-visible message data', () => {
    const message = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [{
        type: 'tool-shell',
        toolCallId: 'tool-1',
        state: 'output-available',
        input: { command: 'pwd' },
        output: '/workspace',
      }],
      metadata: {
        codex: {
          responseItems: [{ item: { type: 'function_call_output', output: '/workspace' } }],
          moderationMetadataByTurnId: { 'turn-1': { flagged: false } },
        },
        cradle: { run: { runId: 'run-1', durationMs: 250 } },
      },
    } as UIMessage

    expect(projectChatMessageForClient(message)).toEqual({
      ...message,
      metadata: {
        codex: {
          moderationMetadataByTurnId: { 'turn-1': { flagged: false } },
        },
        cradle: { run: { runId: 'run-1', durationMs: 250 } },
      },
    })
    expect(message.metadata).toEqual(expect.objectContaining({
      codex: expect.objectContaining({ responseItems: expect.any(Array) }),
    }))
  })

  it('omits private-only metadata chunks without changing durable chunk data', () => {
    const chunk: UIMessageChunk = {
      type: 'message-metadata',
      messageMetadata: {
        codex: { responseItems: [{ turnId: 'turn-1' }] },
      },
    }

    expect(projectChatChunkForClient(chunk)).toBeNull()
    expect(chunk).toEqual({
      type: 'message-metadata',
      messageMetadata: {
        codex: { responseItems: [{ turnId: 'turn-1' }] },
      },
    })
  })

  it('preserves public metadata on start and finish chunks', () => {
    expect(projectChatChunkForClient({
      type: 'start',
      messageId: 'assistant-1',
      messageMetadata: {
        codex: {
          responseItems: [{ turnId: 'turn-1' }],
          model: 'gpt-5',
        },
        cradle: { started: true },
      },
    })).toEqual({
      type: 'start',
      messageId: 'assistant-1',
      messageMetadata: {
        codex: { model: 'gpt-5' },
        cradle: { started: true },
      },
    })

    expect(projectChatChunkForClient({
      type: 'finish',
      finishReason: 'stop',
      messageMetadata: {
        codex: { responseItems: [{ turnId: 'turn-1' }] },
      },
    })).toEqual({
      type: 'finish',
      finishReason: 'stop',
    })
  })
})
