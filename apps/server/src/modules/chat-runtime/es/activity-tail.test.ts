import type { PluginActivity } from '@cradle/plugin-sdk/server'
import { afterEach, describe, expect, it } from 'vitest'

import { publishChatRunActivities, subscribeChatRunActivity } from './activity-tail'
import type { StoredChatSessionEvent } from './events'

const cleanups: Array<() => void> = []

function subscribe(subscriber: (activity: PluginActivity) => void): void {
  cleanups.push(subscribeChatRunActivity(subscriber))
}

function storedEvent(
  overrides: Partial<StoredChatSessionEvent> & Pick<StoredChatSessionEvent, 'type' | 'payload'>,
): StoredChatSessionEvent {
  return {
    sequenceId: overrides.sequenceId ?? 1,
    aggregateId: overrides.aggregateId ?? 'session-1',
    aggregateType: 'ChatSession',
    version: overrides.version ?? 1,
    occurredAt: overrides.occurredAt ?? 100,
    ...overrides,
  } as StoredChatSessionEvent
}

function runStarted(): StoredChatSessionEvent {
  return storedEvent({
    type: 'RunStarted',
    payload: {
      run: {
        id: 'run-1',
        bindingId: null,
        chatSessionId: 'session-1',
        messageId: 'assistant-1',
        origin: 'issue-agent',
        status: 'streaming',
        stopReason: null,
        errorText: null,
        startedAt: 99,
        finishedAt: null,
      },
      assistantMessage: null,
      queueItemId: null,
    },
  })
}

function runFinished(
  type: 'RunCompleted' | 'RunFailed' | 'RunAborted',
  sequenceId: number,
): StoredChatSessionEvent {
  return storedEvent({
    type,
    sequenceId,
    version: sequenceId,
    occurredAt: 100 + sequenceId,
    payload: {
      runId: 'run-1',
      sessionId: 'session-1',
      queueItemId: null,
      bindingId: null,
      status: type === 'RunCompleted' ? 'complete' : type === 'RunFailed' ? 'failed' : 'aborted',
      stopReason: 'response.finished',
      errorText: null,
      finishedAt: 100 + sequenceId,
    },
  })
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    cleanup()
  }
})

describe('chat run activity tail', () => {
  it('maps committed run facts and ignores unrelated session facts', () => {
    const activities: PluginActivity[] = []
    subscribe(activity => activities.push(activity))

    publishChatRunActivities([
      runStarted(),
      storedEvent({
        type: 'TitleChanged',
        sequenceId: 2,
        version: 2,
        payload: {
          sessionId: 'session-1',
          title: 'Ignored',
          titleSource: 'provider',
          updatedAt: 102,
        },
      }),
      runFinished('RunCompleted', 3),
      runFinished('RunFailed', 4),
      runFinished('RunAborted', 5),
    ])

    expect(activities).toEqual([
      {
        kind: 'chat.run.started',
        occurredAt: 100,
        sessionId: 'session-1',
        runId: 'run-1',
        origin: 'issue-agent',
      },
      {
        kind: 'chat.run.finished',
        occurredAt: 103,
        sessionId: 'session-1',
        runId: 'run-1',
        outcome: 'completed',
      },
      {
        kind: 'chat.run.finished',
        occurredAt: 104,
        sessionId: 'session-1',
        runId: 'run-1',
        outcome: 'failed',
      },
      {
        kind: 'chat.run.finished',
        occurredAt: 105,
        sessionId: 'session-1',
        runId: 'run-1',
        outcome: 'aborted',
      },
    ])
  })

  it('isolates throwing subscribers and supports unsubscribe', () => {
    const activities: PluginActivity[] = []
    subscribe(() => {
      throw new Error('broken subscriber')
    })
    const unsubscribe = subscribeChatRunActivity(activity => activities.push(activity))

    publishChatRunActivities([runStarted()])
    unsubscribe()
    publishChatRunActivities([runFinished('RunCompleted', 2)])

    expect(activities).toEqual([
      expect.objectContaining({ kind: 'chat.run.started', runId: 'run-1' }),
    ])
  })
})
