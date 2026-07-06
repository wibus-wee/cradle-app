import { describe, expect, it } from 'vitest'

import { createInitialChatSessionState, evolveChatSessionState } from './aggregate'
import { decide, decideChatSessionEvents } from './decide'
import type { ChatSessionEvent, StoredChatSessionEvent } from './events'

function stored(
  version: number,
  event: ChatSessionEvent,
): StoredChatSessionEvent {
  return {
    sequenceId: version,
    aggregateId: 'session-1',
    aggregateType: 'ChatSession',
    version,
    type: event.type,
    payload: event.payload,
    subjectRunId: event.type === 'RunStarted' ? event.payload.run.id : null,
    occurredAt: 100 + version,
  } as StoredChatSessionEvent
}

function runStarted(runId: string, messageId: string): Extract<ChatSessionEvent, { type: 'RunStarted' }> {
  return {
    type: 'RunStarted',
    payload: {
      run: {
        id: runId,
        bindingId: null,
        chatSessionId: 'session-1',
        messageId,
        origin: 'user',
        status: 'streaming',
        stopReason: null,
        errorText: null,
        startedAt: 100,
        finishedAt: null,
      },
      assistantMessage: {
        id: messageId,
        sessionId: 'session-1',
        parentMessageId: null,
        parentToolCallId: null,
        taskId: null,
        depth: 0,
        role: 'assistant',
        status: 'streaming',
        content: '',
        messageJson: JSON.stringify({ id: messageId, role: 'assistant', parts: [] }),
        errorText: null,
        createdAt: 100,
        updatedAt: 100,
      },
      queueItemId: null,
    },
  }
}

function queueItemEnqueued(queueItemId: string): Extract<ChatSessionEvent, { type: 'QueueItemEnqueued' }> {
  return {
    type: 'QueueItemEnqueued',
    payload: {
      item: {
        id: queueItemId,
        sessionId: 'session-1',
        mode: 'queue',
        status: 'pending',
        text: 'queued',
        filesJson: '[]',
        contextPartsJson: '[]',
        providerTargetId: null,
        modelId: null,
        thinkingEffort: null,
        permissionMode: null,
        runtimeAccessMode: 'approval-required',
        runtimeInteractionMode: 'default',
        position: 1,
        sourceRunId: null,
        startedRunId: null,
        errorText: null,
        createdAt: 100,
        updatedAt: 100,
      },
    },
  }
}

function queueItemClaimed(queueItemId: string): Extract<ChatSessionEvent, { type: 'QueueItemClaimed' }> {
  return {
    type: 'QueueItemClaimed',
    payload: {
      queueItemId,
      sessionId: 'session-1',
      updatedAt: 110,
    },
  }
}

function runCompleted(runId: string): Extract<ChatSessionEvent, { type: 'RunCompleted' }> {
  return {
    type: 'RunCompleted',
    payload: {
      runId,
      sessionId: 'session-1',
      queueItemId: null,
      bindingId: null,
      status: 'complete',
      stopReason: 'response.completed',
      errorText: null,
      finishedAt: 120,
    },
  }
}

function assistantSnapshotted(
  runId: string,
  messageId: string,
): Extract<ChatSessionEvent, { type: 'AssistantMessageSnapshotted' }> {
  const messageJson = JSON.stringify({
    id: messageId,
    role: 'assistant',
    parts: [{ type: 'text', text: 'partial' }],
  })
  return {
    type: 'AssistantMessageSnapshotted',
    payload: {
      runId,
      message: {
        id: messageId,
        sessionId: 'session-1',
        content: 'partial',
        messageJson,
        status: 'streaming',
        errorText: null,
        updatedAt: 110,
      },
      messageJsonBytes: Buffer.byteLength(messageJson),
    },
  }
}

describe('decide', () => {
  it('rejects starting a second active top-level run', () => {
    const state = createInitialChatSessionState('session-1')
    evolveChatSessionState(state, stored(1, runStarted('run-1', 'assistant-1')))

    const result = decide(state, {
      type: 'startRun',
      event: runStarted('run-2', 'assistant-2'),
    })

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'run_already_active',
        details: { activeRunId: 'run-1', runId: 'run-2' },
      },
    })
  })

  it('rejects terminal events that do not match the active run', () => {
    const state = createInitialChatSessionState('session-1')
    evolveChatSessionState(state, stored(1, runStarted('run-1', 'assistant-1')))

    const result = decide(state, {
      type: 'completeRun',
      event: runCompleted('run-2'),
    })

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'run_not_active',
        details: { activeRunId: 'run-1', runId: 'run-2' },
      },
    })
  })

  it('accepts assistant message snapshots for a streaming run', () => {
    const state = createInitialChatSessionState('session-1')
    evolveChatSessionState(state, stored(1, runStarted('run-1', 'assistant-1')))
    const event = assistantSnapshotted('run-1', 'assistant-1')

    expect(decide(state, { type: 'snapshotAssistantMessage', event })).toEqual({
      ok: true,
      events: [event],
    })
  })

  it('rejects assistant message snapshots after the run is terminal', () => {
    const state = createInitialChatSessionState('session-1')
    evolveChatSessionState(state, stored(1, runStarted('run-1', 'assistant-1')))
    evolveChatSessionState(state, stored(2, runCompleted('run-1')))

    const result = decide(state, {
      type: 'snapshotAssistantMessage',
      event: assistantSnapshotted('run-1', 'assistant-1'),
    })

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'run_not_active',
        details: { activeRunId: null, runId: 'run-1' },
      },
    })
  })

  it('rejects assistant message snapshots for a different run message', () => {
    const state = createInitialChatSessionState('session-1')
    evolveChatSessionState(state, stored(1, runStarted('run-1', 'assistant-1')))

    const result = decide(state, {
      type: 'snapshotAssistantMessage',
      event: assistantSnapshotted('run-1', 'assistant-2'),
    })

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'run_message_mismatch',
        details: {
          runId: 'run-1',
          messageId: 'assistant-2',
          expectedMessageId: 'assistant-1',
        },
      },
    })
  })

  it('rejects queue claims unless the queue item is pending', () => {
    const state = createInitialChatSessionState('session-1')
    const claim: Extract<ChatSessionEvent, { type: 'QueueItemClaimed' }> = {
      type: 'QueueItemClaimed',
      payload: {
        queueItemId: 'queue-1',
        sessionId: 'session-1',
        updatedAt: 120,
      },
    }

    expect(decide(state, { type: 'claimQueueItem', event: claim })).toMatchObject({
      ok: false,
      error: {
        code: 'queue_item_not_pending',
        details: { queueItemId: 'queue-1', status: 'missing' },
      },
    })
  })

  it('allows starting a run for an already claimed queue item without a started run', () => {
    const state = createInitialChatSessionState('session-1')
    evolveChatSessionState(state, stored(1, queueItemEnqueued('queue-1')))
    evolveChatSessionState(state, stored(2, queueItemClaimed('queue-1')))
    const event = runStarted('run-1', 'assistant-1')
    event.payload.queueItemId = 'queue-1'

    expect(decide(state, { type: 'startRun', event })).toEqual({
      ok: true,
      events: [event],
    })
  })

  it('validates a multi-event start and terminal batch without changing event order', () => {
    const state = createInitialChatSessionState('session-1')
    const events = [
      runStarted('run-1', 'assistant-1'),
      assistantSnapshotted('run-1', 'assistant-1'),
      runCompleted('run-1'),
    ]

    const result = decideChatSessionEvents(state, events)

    expect(result).toEqual({
      ok: true,
      events,
    })
  })
})
