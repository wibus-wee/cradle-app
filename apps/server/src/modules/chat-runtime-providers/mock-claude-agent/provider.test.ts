import type { UIMessage, UIMessageChunk } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RuntimeProviderTargetProfile, RuntimeSession } from '../../chat-runtime/runtime-provider-types'
import { assertValidProviderChunkSequence } from '../kit/testing/chunk-contract'
import { MockClaudeAgentProvider } from './provider'

describe('mock claude agent provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('streams mock Claude SSE events as a valid provider chunk sequence', async () => {
    const fetchMock = vi.fn(async () => sseResponse([
      {
        type: 'stream_event',
        session_id: 'mock-session-1',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text' },
        },
      },
      {
        type: 'stream_event',
        session_id: 'mock-session-1',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Mock answer' },
        },
      },
      {
        type: 'stream_event',
        session_id: 'mock-session-1',
        event: { type: 'content_block_stop', index: 0 },
      },
      {
        type: 'stream_event',
        session_id: 'mock-session-1',
        event: { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
      },
    ]))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new MockClaudeAgentProvider()
    const chunks: UIMessageChunk[] = []

    for await (const chunk of provider.streamTurn({
      runId: 'run-mock-claude',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: createUserMessage('Hello mock'),
      workspaceId: 'workspace-1',
      workspacePath: '/tmp/workspace',
    })) {
      chunks.push(chunk)
    }

    expect(chunks.map(chunk => chunk.type)).toEqual([
      'text-start',
      'text-delta',
      'text-end',
      'finish',
    ])
    assertValidProviderChunkSequence(chunks)
    expect(fetchMock).toHaveBeenCalledWith('http://mock.local/v1/claude-agent/query', expect.objectContaining({
      body: JSON.stringify({ prompt: 'Hello mock' }),
    }))
  })
})

function createProfile(): RuntimeProviderTargetProfile {
  return {
    id: 'profile-mock-claude',
    name: 'Mock Claude Agent',
    providerKind: 'anthropic',
    enabled: true,
    configJson: JSON.stringify({ baseUrl: 'http://mock.local' }),
    credentialRef: null,
    customModels: '[]',
    iconSlug: null,
    providerTargetKind: 'manual',
    providerTargetId: 'profile-mock-claude',
  }
}

function createRuntimeSession(): RuntimeSession {
  return {
    id: 'runtime-session-1',
    chatSessionId: 'chat-session-1',
    providerTargetId: 'profile-mock-claude',
    runtimeKind: 'claude-agent',
    providerSessionId: null,
    providerStateSnapshot: JSON.stringify({
      workspacePath: '/tmp/workspace',
      models: { currentModelId: null },
    }),
  }
}

function createUserMessage(text: string): UIMessage {
  return {
    id: 'user-1',
    role: 'user',
    parts: [{ type: 'text', text }],
  }
}

function sseResponse(messages: readonly object[]): Response {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const message of messages) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(message)}\n\n`))
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  }), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}
