import type { UIMessageChunk } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ClaudeAgentProvider } from '../provider'
import {
  createAsyncQuery,
  createProfile,
  createRuntimeSession,
} from '../test-kit'

const sdkMocks = vi.hoisted(() => ({
  query: vi.fn(),
  getSessionInfo: vi.fn(),
  getSubagentMessages: vi.fn(),
  listSubagents: vi.fn(),
  renameSession: vi.fn(),
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => sdkMocks)

describe('claudeAgentProviderThreadTurns', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('emits final message-delta usage instead of the interim assistant snapshot', async () => {
    const provider = new ClaudeAgentProvider({
      readSecret: () => 'sk-ant-test',
    })

    const activeQuery = createAsyncQuery([
      {
        type: 'stream_event',
        event: {
          type: 'message_start',
          message: {
            id: 'msg-final',
            model: 'claude-opus-4-8',
            usage: { input_tokens: 1, output_tokens: 1 },
          },
        },
        session_id: 'claude-session-1',
      },
      {
        type: 'assistant',
        session_id: 'claude-session-1',
        message: {
          id: 'msg-final',
          model: 'claude-opus-4-8',
          content: [{ type: 'text', text: 'Hello' }],
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      },
      {
        type: 'stream_event',
        session_id: 'claude-session-1',
        event: { type: 'message_delta', usage: { input_tokens: 1, output_tokens: 3 } },
      },
      {
        type: 'result',
        usage: { input_tokens: 1, output_tokens: 3 },
        session_id: 'claude-session-1',
      },
    ])
    sdkMocks.query.mockReturnValue(activeQuery)
    const usageEvents: unknown[] = []

    const chunks: UIMessageChunk[] = []
    for await (const chunk of provider.streamTurn({
      runId: 'run-test',
      runtimeSession: createRuntimeSession(),
      profile: createProfile(),
      message: { id: 'user-1', role: 'user', parts: [{ type: 'text', text: 'Test' }] },
      workspaceId: 'workspace-1',
      onUsageEvent: (event) => { usageEvents.push(event) },
    })) {
      chunks.push(chunk)
    }

    expect(chunks).toContainEqual(expect.objectContaining({ type: 'finish' }))

    expect(usageEvents).toEqual([
      expect.objectContaining({
        providerThreadId: 'claude-session-1',
        providerTurnId: 'msg-final',
        modelId: 'claude-opus-4-8',
        usage: expect.objectContaining({ totalTokens: 4 }),
      }),
    ])
  })
})
