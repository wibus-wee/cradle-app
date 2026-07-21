import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'

import {
  ClaudeUsageEventProjectionError,
  createClaudeUsageEventId,
  projectClaudeAssistantUsageEvent,
} from './usage-event-projector'

describe('projectClaudeAssistantUsageEvent', () => {
  it('projects a root assistant message with complete cache usage', () => {
    const message = {
      type: 'assistant',
      session_id: 'session-root',
      message: {
        id: 'msg-root',
        model: 'claude-opus-4-8',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 40,
          cache_creation_input_tokens: 20,
        },
      },
    } as unknown as SDKMessage

    expect(projectClaudeAssistantUsageEvent({
      message,
      fallbackModelId: null,
      occurredAt: 123,
    })).toEqual({
      id: createClaudeUsageEventId('session-root', 'session-root', 'msg-root'),
      providerThreadId: 'session-root',
      providerTurnId: 'msg-root',
      modelId: 'claude-opus-4-8',
      occurredAt: 123,
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cachedInputTokens: 40,
        cacheWriteInputTokens: 20,
      },
      providerTotal: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cachedInputTokens: 40,
        cacheWriteInputTokens: 20,
      },
    })
  })

  it('attributes child assistant usage to its parent tool call', () => {
    const message = {
      type: 'assistant',
      session_id: 'session-root',
      parent_tool_use_id: 'toolu_parent',
      message: {
        id: 'msg-child',
        usage: { input_tokens: 4, output_tokens: 6 },
      },
    } as unknown as SDKMessage

    const event = projectClaudeAssistantUsageEvent({
      message,
      fallbackModelId: 'claude-sonnet-5',
      occurredAt: 456,
    })

    expect(event).toEqual(expect.objectContaining({
      id: createClaudeUsageEventId('session-root', 'toolu_parent', 'msg-child'),
      providerThreadId: 'toolu_parent',
      providerTurnId: 'msg-child',
      modelId: 'claude-sonnet-5',
    }))
  })

  it('ignores non-final assistant SDK messages', () => {
    expect(projectClaudeAssistantUsageEvent({
      message: {
        type: 'result',
        session_id: 'session-root',
        usage: { input_tokens: 4, output_tokens: 6 },
      } as unknown as SDKMessage,
      fallbackModelId: 'claude-sonnet-5',
    })).toBeNull()
  })

  it('rejects missing immutable identity and nonpositive totals', () => {
    expect(() => projectClaudeAssistantUsageEvent({
      message: {
        type: 'assistant',
        session_id: 'session-root',
        message: { usage: { input_tokens: 4, output_tokens: 6 } },
      } as unknown as SDKMessage,
      fallbackModelId: 'claude-sonnet-5',
    })).toThrow(ClaudeUsageEventProjectionError)

    expect(() => projectClaudeAssistantUsageEvent({
      message: {
        type: 'assistant',
        session_id: 'session-root',
        message: { id: 'msg-empty', usage: { input_tokens: 0, output_tokens: 0 } },
      } as unknown as SDKMessage,
      fallbackModelId: 'claude-sonnet-5',
    })).toThrow('positive model-call total')
  })
})
