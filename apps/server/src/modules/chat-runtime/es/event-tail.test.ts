import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ChatSessionTailEvent } from '@cradle/chat-runtime-contracts'
import { sessionEvents, sessions, workspaces } from '@cradle/db'
import { describe, expect, it } from 'vitest'

import { db, shutdownInfra } from '../../../infra'
import type { StoredChatSessionEvent } from './events'
import {
  openGlobalSessionEventTailStream,
  openTailStream,
  openSessionEventTailStream,
  publishSessionTailEvents,
  toChatSessionTailEvent,
} from './event-tail'

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
  } finally {
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
  } finally {
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

  it('projects assistant message snapshots to slim message refresh DTOs', () => {
    const event = storedEvent({
      type: 'AssistantMessageSnapshotted',
      payload: {
        runId: 'run-1',
        message: {
          id: 'assistant-1',
          sessionId: 'session-1',
          content: 'partial secret transcript content',
          messageJson: '{"id":"assistant-1","role":"assistant","parts":[]}',
          status: 'streaming',
          errorText: null,
          updatedAt: 150,
        },
        messageJsonBytes: 52,
      },
    })

    const tailEvent = toChatSessionTailEvent(event)

    expect(tailEvent).toMatchObject({
      type: 'AssistantMessageSnapshotted',
      payload: {
        messageId: 'assistant-1',
        status: 'streaming',
      },
    })
    expect(JSON.stringify(tailEvent.payload)).not.toContain('partial secret transcript content')
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
