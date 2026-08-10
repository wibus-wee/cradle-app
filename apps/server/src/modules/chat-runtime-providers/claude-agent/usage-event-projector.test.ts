import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'

import {
  ClaudeUsageEventProjectionError,
  createClaudeLiveUsageProjectionState,
  createClaudeUsageEventId,
  projectClaudeAssistantUsageEvent,
  projectClaudeLiveUsageEvent,
} from './usage-event-projector'


describe('projectClaudeLiveUsageEvent', () => {
  it('waits for the final message delta instead of recording the interim assistant snapshot', () => {
    const state = createClaudeLiveUsageProjectionState()
    const project = (message: SDKMessage) => projectClaudeLiveUsageEvent({
      message,
      state,
      fallbackModelId: null,
      occurredAt: 123,
    })

    expect(project({
      type: 'stream_event',
      session_id: 'session-root',
      parent_tool_use_id: null,
      event: {
        type: 'message_start',
        message: {
          id: 'msg-root',
          model: 'claude-opus-4-8',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      },
    } as unknown as SDKMessage)).toBeNull()

    expect(project({
      type: 'assistant',
      session_id: 'session-root',
      message: {
        id: 'msg-root',
        model: 'claude-opus-4-8',
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    } as unknown as SDKMessage)).toBeNull()

    expect(project({
      type: 'stream_event',
      session_id: 'session-root',
      parent_tool_use_id: null,
      event: {
        type: 'message_delta',
        usage: { input_tokens: 1, output_tokens: 3 },
      },
    } as unknown as SDKMessage)).toEqual({
      id: createClaudeUsageEventId('session-root', 'session-root', 'msg-root'),
      providerThreadId: 'session-root',
      providerTurnId: 'msg-root',
      modelId: 'claude-opus-4-8',
      occurredAt: 123,
      usage: {
        promptTokens: 1,
        completionTokens: 3,
        totalTokens: 4,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
      },
      providerTotal: {
        promptTokens: 1,
        completionTokens: 3,
        totalTokens: 4,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
      },
    })
  })

  it('retains message-start cache usage and child-thread identity', () => {
    const state = createClaudeLiveUsageProjectionState()
    projectClaudeLiveUsageEvent({
      message: {
        type: 'stream_event',
        session_id: 'session-root',
        parent_tool_use_id: 'toolu-parent',
        event: {
          type: 'message_start',
          message: {
            id: 'msg-child',
            model: 'claude-sonnet-5',
            usage: {
              input_tokens: 100,
              output_tokens: 1,
              cache_read_input_tokens: 40,
              cache_creation_input_tokens: 20,
            },
          },
        },
      } as unknown as SDKMessage,
      state,
      fallbackModelId: null,
      occurredAt: 456,
    })

    expect(projectClaudeLiveUsageEvent({
      message: {
        type: 'stream_event',
        session_id: 'session-root',
        parent_tool_use_id: 'toolu-parent',
        event: { type: 'message_delta', usage: { output_tokens: 50 } },
      } as unknown as SDKMessage,
      state,
      fallbackModelId: null,
    })).toEqual(expect.objectContaining({
      id: createClaudeUsageEventId('session-root', 'toolu-parent', 'msg-child'),
      providerThreadId: 'toolu-parent',
      providerTurnId: 'msg-child',
      usage: expect.objectContaining({
        promptTokens: 160,
        completionTokens: 50,
        totalTokens: 210,
      }),
    }))
  })
})

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
        promptTokens: 160,
        completionTokens: 50,
        totalTokens: 210,
        cachedInputTokens: 40,
        cacheWriteInputTokens: 20,
      },
      providerTotal: {
        promptTokens: 160,
        completionTokens: 50,
        totalTokens: 210,
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

  it('uses the originating assistant timestamp with receive-time fallback semantics', () => {
    const event = projectClaudeAssistantUsageEvent({
      message: {
        type: 'assistant',
        session_id: 'session-root',
        timestamp: '2026-07-29T00:01:02.345Z',
        message: {
          id: 'msg-timestamped',
          model: 'claude-opus-4-8',
          usage: { input_tokens: 4, output_tokens: 6 },
        },
      } as unknown as SDKMessage,
      fallbackModelId: null,
    })

    expect(event?.occurredAt).toBe(1_785_283_262)
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

  it('rejects missing immutable identity', () => {
    expect(() => projectClaudeAssistantUsageEvent({
      message: {
        type: 'assistant',
        session_id: 'session-root',
        message: { usage: { input_tokens: 4, output_tokens: 6 } },
      } as unknown as SDKMessage,
      fallbackModelId: 'claude-sonnet-5',
    })).toThrow(ClaudeUsageEventProjectionError)
  })

  it('ignores a zero-token assistant snapshot while usage is pending', () => {
    expect(projectClaudeAssistantUsageEvent({
      message: {
        type: 'assistant',
        session_id: 'session-root',
        message: { id: 'msg-empty', usage: { input_tokens: 0, output_tokens: 0 } },
      } as unknown as SDKMessage,
      fallbackModelId: 'claude-sonnet-5',
    })).toBeNull()
  })
})
