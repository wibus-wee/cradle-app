import { describe, expect, it } from 'vitest'

import { reduceChatSessionEvents } from './aggregate'
import type { StoredChatSessionEvent } from './events'

function event(
  version: number,
  type: StoredChatSessionEvent['type'],
  payload: StoredChatSessionEvent['payload'],
): StoredChatSessionEvent {
  return {
    sequenceId: version,
    aggregateId: 'session-1',
    aggregateType: 'ChatSession',
    version,
    type,
    payload,
    occurredAt: version,
  } as StoredChatSessionEvent
}

describe('reduceChatSessionEvents', () => {
  it('keeps the active run when the event stream has no terminal fact', () => {
    const state = reduceChatSessionEvents([
      event(1, 'RunStarted', {
        run: {
          id: 'run-1',
          bindingId: null,
          chatSessionId: 'session-1',
          messageId: 'assistant-1',
          origin: 'user',
          status: 'streaming',
          stopReason: null,
          errorText: null,
          startedAt: 100,
          finishedAt: null,
        },
        assistantMessage: {
          id: 'assistant-1',
          sessionId: 'session-1',
          parentMessageId: null,
          parentToolCallId: null,
          taskId: null,
          depth: 0,
          role: 'assistant',
          status: 'streaming',
          content: '',
          messageJson: '{"id":"assistant-1","role":"assistant","parts":[]}',
          errorText: null,
          createdAt: 100,
          updatedAt: 100,
        },
        queueItemId: 'queue-1',
      }),
    ])

    expect(state.version).toBe(1)
    expect(state.activeRun).toEqual({
      runId: 'run-1',
      messageId: 'assistant-1',
      queueItemId: 'queue-1',
      startedAt: 100,
    })
  })

  it('clears the active run after a terminal event', () => {
    const state = reduceChatSessionEvents([
      event(1, 'RunStarted', {
        run: {
          id: 'run-1',
          bindingId: null,
          chatSessionId: 'session-1',
          messageId: 'assistant-1',
          origin: 'user',
          status: 'streaming',
          stopReason: null,
          errorText: null,
          startedAt: 100,
          finishedAt: null,
        },
        assistantMessage: null,
        queueItemId: null,
      }),
      event(2, 'RunFailed', {
        runId: 'run-1',
        sessionId: 'session-1',
        queueItemId: null,
        status: 'failed',
        stopReason: 'response.interrupted',
        errorText: 'interrupted',
        finishedAt: 120,
      }),
    ])

    expect(state.version).toBe(2)
    expect(state.activeRun).toBeNull()
  })

  it('removes rolled-back messages from aggregate state', () => {
    const state = reduceChatSessionEvents([
      event(1, 'UserMessageAppended', {
        message: {
          id: 'user-1',
          sessionId: 'session-1',
          parentMessageId: null,
          parentToolCallId: null,
          taskId: null,
          depth: 0,
          role: 'user',
          status: 'complete',
          content: 'previous',
          messageJson: '{"id":"user-1","role":"user","parts":[]}',
          errorText: null,
          createdAt: 100,
          updatedAt: 100,
        },
      }),
      event(2, 'RunStarted', {
        run: {
          id: 'run-1',
          bindingId: null,
          chatSessionId: 'session-1',
          messageId: 'assistant-1',
          origin: 'user',
          status: 'streaming',
          stopReason: null,
          errorText: null,
          startedAt: 101,
          finishedAt: null,
        },
        assistantMessage: {
          id: 'assistant-1',
          sessionId: 'session-1',
          parentMessageId: null,
          parentToolCallId: null,
          taskId: null,
          depth: 0,
          role: 'assistant',
          status: 'streaming',
          content: '',
          messageJson: '{"id":"assistant-1","role":"assistant","parts":[]}',
          errorText: null,
          createdAt: 101,
          updatedAt: 101,
        },
        queueItemId: null,
      }),
      event(3, 'AssistantMessageCompleted', {
        message: {
          id: 'assistant-1',
          sessionId: 'session-1',
          content: 'done',
          messageJson: '{"id":"assistant-1","role":"assistant","parts":[]}',
          status: 'complete',
          errorText: null,
          updatedAt: 110,
        },
      }),
      event(4, 'RunCompleted', {
        runId: 'run-1',
        sessionId: 'session-1',
        queueItemId: null,
        status: 'complete',
        stopReason: 'response.completed',
        errorText: null,
        finishedAt: 110,
      }),
      event(5, 'LastTurnRolledBack', {
        sessionId: 'session-1',
        messageIds: ['user-1', 'assistant-1'],
        providerRuntimeKind: 'codex',
        providerSessionId: 'codex-thread-1',
        providerRolledBackTurns: 1,
        fileChangesReverted: false,
        updatedAt: 120,
      }),
    ])

    expect(state.version).toBe(5)
    expect(state.messageStatusById.has('user-1')).toBe(false)
    expect(state.messageStatusById.has('assistant-1')).toBe(false)
    expect(state.assistantMessageById.has('assistant-1')).toBe(false)
    expect(state.activeRun).toBeNull()
  })
})
