import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ChatSessionTailEvent } from '@cradle/chat-runtime-contracts'
import { chatMessagePayloads, messages, sessionEvents, sessions, workspaces } from '@cradle/db'
import { describe, expect, it, vi } from 'vitest'

import { db, shutdownInfra } from '../../../infra'
import { subscribeChatRunActivity } from './activity-tail'
import {
  openGlobalSessionEventTailStream,
  openSessionEventTailStream,
  openTailStream,
  publishSessionTailEvents,
  readGlobalSessionTailEvents,
  readSessionTailEvents,
  readTailStreamBufferLimits,
  subscribeChatGlobalSessionTail,
  subscribeChatSessionTail,
  toChatSessionTailEvent,
} from './event-tail'
import type { StoredChatSessionEvent } from './events'

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

function restoreEnv(name: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = previousValue
}

async function withTempDataDir<T>(callback: () => Promise<T> | T): Promise<T> {
  const dataDir = mkdtempSync(join(tmpdir(), 'cradle-data-'))
  const previousDataDir = process.env.CRADLE_DATA_DIR
  process.env.CRADLE_DATA_DIR = dataDir

  try {
    return await callback()
  }
 finally {
    shutdownInfra()
    rmSync(dataDir, { recursive: true, force: true })
    restoreEnv('CRADLE_DATA_DIR', previousDataDir)
  }
}

function seedSession(sessionId: string, workspaceId: string | null = null): void {
  db()
    .insert(sessions)
    .values({
      id: sessionId,
      title: 'Event Tail Test',
      titleSource: 'initial',
      runtimeKind: 'standard',
      workspaceId,
      createdAt: 1700000000,
      updatedAt: 1700000000,
    })
    .run()
}

function seedWorkspace(workspaceId: string): void {
  db()
    .insert(workspaces)
    .values({
      id: workspaceId,
      name: workspaceId,
      locatorJson: JSON.stringify({ kind: 'local', path: `/tmp/${workspaceId}` }),
    })
    .run()
}

function seedTitleChangedEvent(input: {
  sessionId: string
  version: number
  title?: string
  occurredAt?: number
}): void {
  db()
    .insert(sessionEvents)
    .values({
      aggregateId: input.sessionId,
      aggregateType: 'ChatSession',
      version: input.version,
      eventType: 'TitleChanged',
      payload: JSON.stringify({
        sessionId: input.sessionId,
        title: input.title ?? `Title ${input.version}`,
        titleSource: 'provider',
        updatedAt: input.occurredAt ?? 1700000000 + input.version,
      }),
      occurredAt: input.occurredAt ?? 1700000000 + input.version,
    })
    .run()
}

async function readSseMessages(
  stream: ReadableStream<Uint8Array>,
  count: number,
): Promise<unknown[]> {
  const reader = stream.getReader()
  try {
    const messages: unknown[] = []
    while (messages.length < count) {
      const result = await reader.read()
      if (result.done) {
        throw new Error('Expected SSE chunk')
      }
      const text = new TextDecoder().decode(result.value)
      const dataLine = text.split('\n').find(line => line.startsWith('data: '))
      if (!dataLine) {
        throw new Error(`Expected SSE data line: ${text}`)
      }
      messages.push(JSON.parse(dataLine.slice('data: '.length)) as unknown)
    }
    return messages
  }
 finally {
    await reader.cancel()
  }
}

async function readSseMessage(stream: ReadableStream<Uint8Array>): Promise<unknown> {
  return (await readSseMessages(stream, 1))[0]
}

describe('chat session event tail', () => {
  it('projects stored events to slim DTOs without transcript content', () => {
    const event = storedEvent({
      type: 'AssistantMessageCompleted',
      payload: {
        message: {
          id: 'assistant-1',
          sessionId: 'session-1',
          content: 'secret transcript content',
          messageJson: '{"id":"assistant-1","role":"assistant","parts":[]}',
          status: 'complete',
          errorText: null,
          updatedAt: 120,
        },
      },
    })

    const tailEvent = toChatSessionTailEvent(event)

    expect(tailEvent).toMatchObject({
      scope: 'session',
      sessionId: 'session-1',
      sequenceId: 1,
      version: 1,
      type: 'AssistantMessageCompleted',
      payload: {
        messageId: 'assistant-1',
        status: 'complete',
      },
    })
    expect(JSON.stringify(tailEvent.payload)).not.toContain('secret transcript content')
    expect(tailEvent).toMatchInlineSnapshot(`
      {
        "occurredAt": 100,
        "payload": {
          "messageId": "assistant-1",
          "status": "complete",
        },
        "scope": "session",
        "sequenceId": 1,
        "sessionId": "session-1",
        "type": "AssistantMessageCompleted",
        "version": 1,
      }
    `)
  })

  it('projects interaction events without approval reasons or user answers', () => {
    const event = storedEvent({
      type: 'InteractionResolved',
      payload: {
        sessionId: 'session-1',
        runId: 'run-1',
        requestId: 'request-1',
        interactionKind: 'toolApproval',
        resolution: 'submitted',
        approved: true,
        updatedAt: 130,
      },
    })

    const tailEvent = toChatSessionTailEvent(event)

    expect(tailEvent).toMatchObject({
      type: 'InteractionResolved',
      payload: {
        runId: 'run-1',
        requestId: 'request-1',
        interactionKind: 'toolApproval',
        resolution: 'submitted',
        approved: true,
      },
    })
    expect(JSON.stringify(tailEvent.payload)).not.toContain('reason')
    expect(JSON.stringify(tailEvent.payload)).not.toContain('answers')
  })

  it('projects plan implementation responses to the message refresh DTO', () => {
    const event = storedEvent({
      type: 'PlanImplementationResponded',
      payload: {
        sessionId: 'session-1',
        messageId: 'assistant-1',
        approvalId: 'implement-plan:tool-1',
        approved: true,
        updatedAt: 140,
      },
    })

    const tailEvent = toChatSessionTailEvent(event)

    expect(tailEvent).toMatchObject({
      type: 'PlanImplementationResponded',
      payload: {
        messageId: 'assistant-1',
        approvalId: 'implement-plan:tool-1',
        approved: true,
      },
    })
    expect(JSON.stringify(tailEvent.payload)).not.toContain('messageJson')
  })

  it('projects assistant message completed events to slim message refresh DTOs', () => {
    const event = storedEvent({
      type: 'AssistantMessageCompleted',
      payload: {
        message: {
          id: 'assistant-1',
          sessionId: 'session-1',
          content: 'final secret transcript content',
          messageJson: '{"id":"assistant-1","role":"assistant","parts":[]}',
          status: 'complete',
          errorText: null,
          updatedAt: 150,
        },
      },
    })

    const tailEvent = toChatSessionTailEvent(event)

    expect(tailEvent).toMatchObject({
      type: 'AssistantMessageCompleted',
      payload: {
        messageId: 'assistant-1',
        status: 'complete',
      },
    })
    expect(JSON.stringify(tailEvent.payload)).not.toContain('final secret transcript content')
    expect(JSON.stringify(tailEvent.payload)).not.toContain('messageJson')
  })

  it('emits SnapshotRequired instead of truncating replay when the requested gap exceeds the limit', async () => {
    await withTempDataDir(async () => {
      const sessionId = 'session-gap'
      seedSession(sessionId)
      seedTitleChangedEvent({ sessionId, version: 1, title: 'First' })
      seedTitleChangedEvent({ sessionId, version: 2, title: 'Second' })

      const stream = openSessionEventTailStream({
        sessionId,
        afterVersion: 0,
        limit: 1,
      })

      await expect(readSseMessage(stream)).resolves.toMatchObject({
        scope: 'session',
        sessionId,
        version: 2,
        type: 'SnapshotRequired',
        payload: {
          reason: 'tail_gap',
          latestVersion: 2,
        },
      })
    })
  })

  it('reads global message events from headers without hydrating missing message payloads', async () => {
    await withTempDataDir(() => {
      const sessionId = 'session-global-header-only'
      seedSession(sessionId)
      db()
        .insert(sessionEvents)
        .values({
          aggregateId: sessionId,
          aggregateType: 'ChatSession',
          version: 1,
          eventType: 'UserMessageAppended',
          payload: JSON.stringify({
            v: 4,
            message: {
              id: 'missing-message-payload',
              sessionId,
              payloadId: 'does-not-exist',
              parentMessageId: null,
              parentToolCallId: null,
              taskId: null,
              depth: 0,
              role: 'user',
              status: 'complete',
              createdAt: 100,
              updatedAt: 100,
            },
          }),
          occurredAt: 100,
        })
        .run()

      expect(readGlobalSessionTailEvents({ afterSequenceId: 0 })).toEqual([
        expect.objectContaining({
          scope: 'sessions',
          sessionId,
          type: 'UserMessageAppended',
          payload: { messageId: 'missing-message-payload' },
        }),
      ])
    })
  })

  it('hydrates a scoped replay with one payload batch and one structural batch', async () => {
    await withTempDataDir(() => {
      const sessionId = 'session-batched-tail-hydration'
      seedSession(sessionId)
      const messageIds = ['user-batch-1', 'user-batch-2', 'assistant-batch-1', 'assistant-batch-2']
      db().insert(chatMessagePayloads).values(messageIds.map((id, index) => ({
        id,
        sessionId,
        content: `message ${index}`,
        messageJson: JSON.stringify({
          id,
          role: id.startsWith('user') ? 'user' : 'assistant',
          parts: [{ type: 'text', text: `message ${index}` }],
        }),
        errorText: null,
        createdAt: 100 + index,
        updatedAt: 100 + index,
      }))).run()
      db().insert(messages).values(messageIds.slice(2).map((id, index) => ({
        id,
        sessionId,
        parentMessageId: null,
        parentToolCallId: null,
        taskId: null,
        depth: 0,
        role: 'assistant' as const,
        status: 'complete' as const,
        payloadId: id,
        createdAt: 102 + index,
        updatedAt: 102 + index,
      }))).run()
      db().insert(sessionEvents).values(messageIds.map((id, index) => ({
        aggregateId: sessionId,
        aggregateType: 'ChatSession',
        version: index + 1,
        eventType: index < 2 ? 'UserMessageAppended' : 'AssistantMessageCompleted',
        payload: index < 2
          ? JSON.stringify({
              v: 4,
              message: {
                id,
                sessionId,
                payloadId: id,
                parentMessageId: null,
                parentToolCallId: null,
                taskId: null,
                depth: 0,
                role: 'user',
                status: 'complete',
                createdAt: 100 + index,
                updatedAt: 100 + index,
              },
            })
          : JSON.stringify({
              v: 4,
              message: {
                id,
                sessionId,
                payloadId: id,
                status: 'complete',
                updatedAt: 100 + index,
              },
            }),
        occurredAt: 100 + index,
      }))).run()

      const selectSpy = vi.spyOn(db(), 'select')
      try {
        const events = readSessionTailEvents({ sessionId, afterVersion: 0 })
        expect(events).toHaveLength(4)
        expect(events.every(event => 'snapshot' in event.payload)).toBe(true)
        expect(selectSpy).toHaveBeenCalledTimes(3)
      }
      finally {
        selectSpy.mockRestore()
      }
    })
  })

  it('replaces a slow reader backlog with one terminal reconnect cursor', async () => {
    const { maxEvents } = readTailStreamBufferLimits()
    let publish: ((event: ChatSessionTailEvent) => void) | null = null
    let unsubscribed = false
    const stream = openTailStream<ChatSessionTailEvent>({
      replay: { events: [], cursor: 0, snapshotRequired: null },
      subscribe: (subscriber) => {
        publish = subscriber
        return () => {
          unsubscribed = true
        }
      },
      readCatchupReplay: () => ({ events: [], cursor: 0, snapshotRequired: null }),
    })

    for (let version = 1; version <= maxEvents + 1; version += 1) {
      publish!({
        scope: 'session',
        sessionId: 'session-slow-reader',
        sequenceId: version,
        version,
        type: 'TitleChanged',
        occurredAt: 100 + version,
        payload: { title: `Title ${version}`, titleSource: 'provider' },
      })
    }

    const reader = stream.getReader()
    const terminal = await reader.read()
    expect(terminal.done).toBe(false)
    const text = new TextDecoder().decode(terminal.value)
    const dataLine = text.split('\n').find(line => line.startsWith('data: '))
    expect(JSON.parse(dataLine!.slice('data: '.length))).toMatchObject({
      sessionId: 'session-slow-reader',
      sequenceId: maxEvents + 1,
      version: maxEvents + 1,
      type: 'SnapshotRequired',
      payload: {
        reason: 'tail_gap',
        latestVersion: maxEvents + 1,
        latestSequenceId: maxEvents + 1,
      },
    })
    await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
    expect(unsubscribed).toBe(true)
  })

  it('publishes header-only global message events when no session subscriber needs hydration', () => {
    const received: unknown[] = []
    const unsubscribe = subscribeChatGlobalSessionTail(null, event => received.push(event))
    try {
      publishSessionTailEvents([
        storedEvent({
          aggregateId: 'session-global-live-header',
          type: 'UserMessageAppended',
          payload: {
            message: {
              id: 'message-global-live',
              sessionId: 'session-global-live-header',
              parentMessageId: null,
              parentToolCallId: null,
              taskId: null,
              depth: 0,
              role: 'user',
              status: 'complete',
              content: 'must not be published',
              messageJson: '{not valid JSON',
              errorText: null,
              createdAt: 100,
              updatedAt: 100,
            },
          },
        }),
      ])
    }
    finally {
      unsubscribe()
    }

    expect(received).toEqual([
      expect.objectContaining({
        scope: 'sessions',
        payload: { messageId: 'message-global-live' },
      }),
    ])
  })

  it('runs catch-up replay after subscription to close the read/subscribe race', async () => {
    const replayEvent: ChatSessionTailEvent = {
      scope: 'session',
      sessionId: 'session-catchup',
      sequenceId: 1,
      version: 1,
      type: 'TitleChanged',
      occurredAt: 100,
      payload: { title: 'Replay', titleSource: 'provider' },
    }
    const catchupEvent: ChatSessionTailEvent = {
      ...replayEvent,
      sequenceId: 2,
      version: 2,
      occurredAt: 101,
      payload: { title: 'Catch-up', titleSource: 'provider' },
    }
    let subscribed = false
    let unsubscribed = false

    const stream = openTailStream({
      replay: {
        events: [replayEvent],
        cursor: replayEvent.version,
        snapshotRequired: null,
      },
      subscribe: () => {
        subscribed = true
        return () => {
          unsubscribed = true
        }
      },
      readCatchupReplay: (cursor) => {
        expect(subscribed).toBe(true)
        expect(cursor).toBe(replayEvent.version)
        return {
          events: [catchupEvent],
          cursor: catchupEvent.version,
          snapshotRequired: null,
        }
      },
    })

    await expect(readSseMessages(stream, 2)).resolves.toMatchObject([
      { version: 1, type: 'TitleChanged' },
      { version: 2, type: 'TitleChanged' },
    ])
    expect(unsubscribed).toBe(true)
  })

  it('publishes live session tail events to active subscribers', async () => {
    const stream = openSessionEventTailStream({
      sessionId: 'session-live',
      afterVersion: 999,
    })

    const message = readSseMessage(stream)
    publishSessionTailEvents([
      storedEvent({
        aggregateId: 'session-live',
        sequenceId: 10,
        version: 3,
        type: 'RunStarted',
        payload: {
          run: {
            id: 'run-1',
            bindingId: null,
            chatSessionId: 'session-live',
            messageId: 'assistant-1',
            origin: 'user',
            status: 'streaming',
            stopReason: null,
            errorText: null,
            startedAt: 101,
            finishedAt: null,
          },
          assistantMessage: null,
          queueItemId: null,
        },
      }),
    ])

    await expect(message).resolves.toMatchObject({
      scope: 'session',
      sessionId: 'session-live',
      sequenceId: 10,
      version: 3,
      type: 'RunStarted',
      payload: {
        runId: 'run-1',
        assistantMessageId: 'assistant-1',
        queueItemId: null,
      },
    })
  })

  it('publishes chat run activity exactly once after the session tail', () => {
    const order: string[] = []
    const unsubscribeTail = subscribeChatSessionTail('session-activity', () => {
      order.push('tail')
    })
    const unsubscribeActivity = subscribeChatRunActivity(() => {
      order.push('activity')
    })

    try {
      publishSessionTailEvents([
        storedEvent({
          aggregateId: 'session-activity',
          sequenceId: 11,
          version: 1,
          type: 'RunStarted',
          payload: {
            run: {
              id: 'run-activity',
              bindingId: null,
              chatSessionId: 'session-activity',
              messageId: 'assistant-activity',
              origin: 'user',
              status: 'streaming',
              stopReason: null,
              errorText: null,
              startedAt: 101,
              finishedAt: null,
            },
            assistantMessage: null,
            queueItemId: null,
          },
        }),
      ])

      expect(order).toEqual(['tail', 'activity'])
    }
    finally {
      unsubscribeActivity()
      unsubscribeTail()
    }
  })

  it('filters live global tail events by workspace without changing the event DTO', async () => {
    await withTempDataDir(async () => {
      seedWorkspace('workspace-other')
      seedWorkspace('workspace-match')
      seedSession('session-other', 'workspace-other')
      seedSession('session-match', 'workspace-match')
      const stream = openGlobalSessionEventTailStream({
        afterSequenceId: 999,
        workspaceId: 'workspace-match',
      })

      const message = readSseMessage(stream)
      publishSessionTailEvents([
        storedEvent({
          aggregateId: 'session-other',
          sequenceId: 1001,
          version: 1,
          type: 'TitleChanged',
          payload: {
            sessionId: 'session-other',
            title: 'Other',
            titleSource: 'provider',
            updatedAt: 1700001001,
          },
        }),
        storedEvent({
          aggregateId: 'session-match',
          sequenceId: 1002,
          version: 1,
          type: 'TitleChanged',
          payload: {
            sessionId: 'session-match',
            title: 'Match',
            titleSource: 'provider',
            updatedAt: 1700001002,
          },
        }),
      ])

      const received = await message
      expect(received).toMatchObject({
        scope: 'sessions',
        sessionId: 'session-match',
        sequenceId: 1002,
        type: 'TitleChanged',
        payload: {
          title: 'Match',
        },
      })
      expect(received).not.toHaveProperty('workspaceId')
    })
  })
})
