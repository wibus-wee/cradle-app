import { describe, expect, it } from 'vitest'

import type { ChatSessionEventRow } from './events'
import {
  CHAT_SESSION_EVENT_SCHEMA_VERSION,
  parseStoredChatSessionEvent,
  serializeChatSessionEventPayload,
  upcastChatSessionEventPayload,
} from './events'

function eventRow(input: {
  eventType: string
  payload: string
}): ChatSessionEventRow {
  return {
    sequenceId: 1,
    aggregateId: 'session-1',
    aggregateType: 'ChatSession',
    version: 1,
    eventType: input.eventType,
    payload: input.payload,
    subjectRunId: null,
    occurredAt: 100,
  }
}

describe('chat session event payload versioning', () => {
  it('writes the current schema version into stored payload JSON', () => {
    const payload = serializeChatSessionEventPayload({
      type: 'QueueItemReleased',
      payload: {
        queueItemId: 'queue-1',
        sessionId: 'session-1',
        updatedAt: 120,
      },
    })

    expect(JSON.parse(payload)).toEqual({
      v: CHAT_SESSION_EVENT_SCHEMA_VERSION,
      queueItemId: 'queue-1',
      sessionId: 'session-1',
      updatedAt: 120,
    })
  })

  it('upcasts captured v1 RunStarted JSON and drops the old projection hint', () => {
    const v1Payload = {
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
      assistantMessageProjection: 'update',
      queueItemId: null,
    } as const

    const upcasted = upcastChatSessionEventPayload('RunStarted', v1Payload)

    expect(upcasted).toMatchObject({
      v: CHAT_SESSION_EVENT_SCHEMA_VERSION,
      run: { id: 'run-1' },
      assistantMessage: { id: 'assistant-1' },
      queueItemId: null,
    })
    expect('assistantMessageProjection' in upcasted).toBe(false)
  })

  it('parses captured v1 UserMessageAppended JSON through the upcaster', () => {
    const stored = parseStoredChatSessionEvent(eventRow({
      eventType: 'UserMessageAppended',
      payload: JSON.stringify({
        message: {
          id: 'user-1',
          sessionId: 'session-1',
          parentMessageId: null,
          parentToolCallId: null,
          taskId: null,
          depth: 0,
          role: 'user',
          status: 'complete',
          content: 'hello',
          messageJson: '{"id":"user-1","role":"user","parts":[{"type":"text","text":"hello"}]}',
          errorText: null,
          createdAt: 100,
          updatedAt: 100,
        },
      }),
    }))

    expect(stored).toMatchObject({
      type: 'UserMessageAppended',
      payload: {
        v: CHAT_SESSION_EVENT_SCHEMA_VERSION,
        message: {
          id: 'user-1',
          sessionId: 'session-1',
          content: 'hello',
        },
      },
    })
  })
})
