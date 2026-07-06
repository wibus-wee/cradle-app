import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  backendRuns,
  chatSessionQueueItems,
  messages,
  sessionEvents,
  sessions
} from '@cradle/db'
import { asc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db, shutdownInfra } from '../../../infra'
import { commitSessionEventsInTransaction } from './commands'
import {
  CHAT_SESSION_AGGREGATE_TYPE,
  CHAT_SESSION_EVENT_SCHEMA_VERSION,
  parseStoredChatSessionEvent,
  type ChatSessionEvent,
  type UserMessageAppendedPayload
} from './events'
import { checkChatSessionProjectionParity } from './parity'
import { projectSessionEvent } from './projectors'
import { rebuildSessionProjections } from './rebuild'
import {
  abortProjectedStreamingRun,
  finalizeInterruptedSessionEventStream
} from './recovery'

function restoreEnv(name: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = previousValue
}

async function withTempDataDir<T>(callback: () => Promise<T> | T): Promise<T> {
  const dataDir = mkdtempSync(join(tmpdir(), 'cradle-chat-es-parity-'))
  const previousDataDir = process.env.CRADLE_DATA_DIR
  const previousDbPath = process.env.CRADLE_DB_PATH
  process.env.CRADLE_DATA_DIR = dataDir
  delete process.env.CRADLE_DB_PATH

  try {
    return await callback()
  } finally {
    shutdownInfra()
    rmSync(dataDir, { recursive: true, force: true })
    restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    restoreEnv('CRADLE_DB_PATH', previousDbPath)
  }
}

function seedSession(sessionId: string): void {
  db()
    .insert(sessions)
    .values({
      id: sessionId,
      title: 'Parity Test',
      titleSource: 'initial',
      runtimeKind: 'standard',
      createdAt: 100,
      updatedAt: 100
    })
    .run()
}

function userMessagePayload(
  id: string,
  sessionId: string,
  content: string,
  createdAt: number
): UserMessageAppendedPayload['message'] {
  return {
    id,
    sessionId,
    parentMessageId: null,
    parentToolCallId: null,
    taskId: null,
    depth: 0,
    role: 'user',
    status: 'complete',
    content,
    messageJson: JSON.stringify({ id, role: 'user', parts: [{ type: 'text', text: content }] }),
    errorText: null,
    createdAt,
    updatedAt: createdAt
  }
}

function userMessageEvent(id: string, sessionId: string, content: string, createdAt: number): ChatSessionEvent {
  return {
    type: 'UserMessageAppended',
    payload: {
      message: userMessagePayload(id, sessionId, content, createdAt)
    }
  }
}

function assistantMessage(
  id: string,
  sessionId: string,
  content: string,
  status: 'streaming',
  createdAt: number
) {
  return {
    id,
    sessionId,
    parentMessageId: null,
    parentToolCallId: null,
    taskId: null,
    depth: 0,
    role: 'assistant' as const,
    status,
    content,
    messageJson: JSON.stringify({ id, role: 'assistant', parts: content ? [{ type: 'text', text: content }] : [] }),
    errorText: null,
    createdAt,
    updatedAt: createdAt
  }
}

function runStartedEvent(input: {
  sessionId: string
  runId: string
  messageId: string
  queueItemId?: string | null
  startedAt: number
}): ChatSessionEvent {
  return {
    type: 'RunStarted',
    payload: {
      run: {
        id: input.runId,
        bindingId: null,
        chatSessionId: input.sessionId,
        messageId: input.messageId,
        origin: 'user',
        status: 'streaming',
        stopReason: null,
        errorText: null,
        startedAt: input.startedAt,
        finishedAt: null
      },
      assistantMessage: assistantMessage(input.messageId, input.sessionId, '', 'streaming', input.startedAt),
      queueItemId: input.queueItemId ?? null
    }
  }
}

function assistantCompletedEvent(
  sessionId: string,
  messageId: string,
  content: string,
  updatedAt: number
): ChatSessionEvent {
  return {
    type: 'AssistantMessageCompleted',
    payload: {
      message: {
        id: messageId,
        sessionId,
        content,
        messageJson: JSON.stringify({ id: messageId, role: 'assistant', parts: [{ type: 'text', text: content }] }),
        status: 'complete',
        errorText: null,
        updatedAt
      }
    }
  }
}

function assistantSnapshottedEvent(
  sessionId: string,
  runId: string,
  messageId: string,
  content: string,
  updatedAt: number
): ChatSessionEvent {
  const messageJson = JSON.stringify({
    id: messageId,
    role: 'assistant',
    parts: [{ type: 'text', text: content }]
  })
  return {
    type: 'AssistantMessageSnapshotted',
    payload: {
      runId,
      message: {
        id: messageId,
        sessionId,
        content,
        messageJson,
        status: 'streaming',
        errorText: null,
        updatedAt
      },
      messageJsonBytes: Buffer.byteLength(messageJson)
    }
  }
}

function runCompletedEvent(input: {
  sessionId: string
  runId: string
  queueItemId?: string | null
  finishedAt: number
}): ChatSessionEvent {
  return {
    type: 'RunCompleted',
    payload: {
      runId: input.runId,
      sessionId: input.sessionId,
      queueItemId: input.queueItemId ?? null,
      bindingId: null,
      status: 'complete',
      stopReason: 'response.completed',
      errorText: null,
      finishedAt: input.finishedAt
    }
  }
}

function queueItemEnqueuedEvent(input: {
  sessionId: string
  queueItemId: string
  text: string
  position: number
  createdAt: number
}): ChatSessionEvent {
  return {
    type: 'QueueItemEnqueued',
    payload: {
      item: {
        id: input.queueItemId,
        sessionId: input.sessionId,
        mode: 'queue',
        status: 'pending',
        text: input.text,
        filesJson: '[]',
        contextPartsJson: '[]',
        providerTargetId: null,
        modelId: null,
        thinkingEffort: null,
        permissionMode: null,
        runtimeAccessMode: 'approval-required',
        runtimeInteractionMode: 'default',
        position: input.position,
        sourceRunId: null,
        startedRunId: null,
        errorText: null,
        createdAt: input.createdAt,
        updatedAt: input.createdAt
      }
    }
  }
}

function readProjectionSnapshot(sessionId: string): {
  messages: unknown[]
  backendRuns: unknown[]
  queueItems: unknown[]
} {
  return {
    messages: db()
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(asc(messages.id))
      .all(),
    backendRuns: db()
      .select()
      .from(backendRuns)
      .where(eq(backendRuns.chatSessionId, sessionId))
      .orderBy(asc(backendRuns.id))
      .all(),
    queueItems: db()
      .select()
      .from(chatSessionQueueItems)
      .where(eq(chatSessionQueueItems.sessionId, sessionId))
      .orderBy(asc(chatSessionQueueItems.id))
      .all()
  }
}

function readEventTypes(sessionId: string): string[] {
  return db()
    .select({ eventType: sessionEvents.eventType })
    .from(sessionEvents)
    .where(eq(sessionEvents.aggregateId, sessionId))
    .orderBy(asc(sessionEvents.version))
    .all()
    .map(row => row.eventType)
}

function appendV1EventAndProject(
  sessionId: string,
  version: number,
  event: { type: ChatSessionEvent['type']; payload: object }
): void {
  db().transaction((tx) => {
    const row = tx
      .insert(sessionEvents)
      .values({
        aggregateId: sessionId,
        aggregateType: CHAT_SESSION_AGGREGATE_TYPE,
        version,
        eventType: event.type,
        payload: JSON.stringify(event.payload),
        occurredAt: 100 + version
      })
      .returning()
      .get()
    projectSessionEvent(tx, parseStoredChatSessionEvent(row))
  })
}

describe('checkChatSessionProjectionParity', () => {
  it('replays the event log through projection tables and reports no clean drift', async () => {
    await withTempDataDir(() => {
      const sessionId = 'session-parity-clean'
      seedSession(sessionId)

      const events: ChatSessionEvent[] = [
        userMessageEvent('user-1', sessionId, 'hello', 101),
        {
          type: 'QueueItemEnqueued',
          payload: {
            item: {
              id: 'queue-1',
              sessionId,
              mode: 'queue',
              status: 'pending',
              text: 'queued hello',
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
              createdAt: 102,
              updatedAt: 102
            }
          }
        },
        runStartedEvent({
          sessionId,
          runId: 'run-1',
          messageId: 'assistant-1',
          queueItemId: 'queue-1',
          startedAt: 103
        }),
        assistantCompletedEvent(sessionId, 'assistant-1', 'done', 110),
        runCompletedEvent({ sessionId, runId: 'run-1', queueItemId: 'queue-1', finishedAt: 110 }),
        {
          type: 'SteerApplied',
          payload: {
            message: {
              ...userMessagePayload('steer-1', sessionId, 'steer', 111),
              parentMessageId: 'assistant-1'
            }
          }
        },
        {
          type: 'LastTurnRolledBack',
          payload: {
            sessionId,
            messageIds: ['user-1', 'assistant-1'],
            providerRuntimeKind: 'codex',
            providerSessionId: 'provider-session-1',
            providerRolledBackTurns: 1,
            fileChangesReverted: false,
            updatedAt: 120
          }
        }
      ]

      commitSessionEventsInTransaction(sessionId, events)

      const report = checkChatSessionProjectionParity(sessionId)
      expect(report).toMatchObject({
        sessionId,
        eventsReplayed: events.length,
        diffCount: 0,
        expectedLoglessDiffs: [],
        unexplainedDiffs: []
      })
      expect(db().select().from(messages).where(eq(messages.sessionId, sessionId)).all()).toEqual([
        expect.objectContaining({ id: 'steer-1' })
      ])
      expect(readEventTypes(sessionId)).toEqual(events.map(event => event.type))
    })
  })

  it('rebuilds session projections byte-for-byte from the event log', async () => {
    await withTempDataDir(async () => {
      const sessionId = 'session-rebuild'
      seedSession(sessionId)

      const events: ChatSessionEvent[] = [
        userMessageEvent('user-1', sessionId, 'hello', 101),
        queueItemEnqueuedEvent({
          sessionId,
          queueItemId: 'queue-1',
          text: 'queued hello',
          position: 1,
          createdAt: 102
        }),
        runStartedEvent({
          sessionId,
          runId: 'run-1',
          messageId: 'assistant-1',
          queueItemId: 'queue-1',
          startedAt: 103
        }),
        assistantCompletedEvent(sessionId, 'assistant-1', 'done', 110),
        runCompletedEvent({ sessionId, runId: 'run-1', queueItemId: 'queue-1', finishedAt: 110 }),
        queueItemEnqueuedEvent({
          sessionId,
          queueItemId: 'queue-cancelled',
          text: 'cancel me',
          position: 2,
          createdAt: 111
        }),
        {
          type: 'QueueItemCancelled',
          payload: {
            queueItemId: 'queue-cancelled',
            sessionId,
            updatedAt: 112
          }
        },
        {
          type: 'SteerApplied',
          payload: {
            message: {
              ...userMessagePayload('steer-1', sessionId, 'steer', 113),
              parentMessageId: 'assistant-1'
            }
          }
        },
        {
          type: 'LastTurnRolledBack',
          payload: {
            sessionId,
            messageIds: ['user-1', 'assistant-1'],
            providerRuntimeKind: 'codex',
            providerSessionId: 'provider-session-1',
            providerRolledBackTurns: 1,
            fileChangesReverted: false,
            updatedAt: 120
          }
        }
      ]

      commitSessionEventsInTransaction(sessionId, events)
      const before = readProjectionSnapshot(sessionId)

      const result = await rebuildSessionProjections(sessionId)

      expect(result).toMatchObject({
        sessionId,
        eventsReplayed: events.length,
        parity: {
          diffCount: 0,
          expectedLoglessDiffs: [],
          unexplainedDiffs: []
        }
      })
      expect(readProjectionSnapshot(sessionId)).toEqual(before)
    })
  })

  it('characterizes aborting a projected streaming run', async () => {
    await withTempDataDir(async () => {
      const sessionId = 'session-parity-abort'
      seedSession(sessionId)
      commitSessionEventsInTransaction(sessionId, [
        runStartedEvent({
          sessionId,
          runId: 'run-abort',
          messageId: 'assistant-abort',
          startedAt: 101
        })
      ])

      const run = db()
        .select()
        .from(backendRuns)
        .where(eq(backendRuns.id, 'run-abort'))
        .get()
      expect(run).toBeDefined()
      await abortProjectedStreamingRun(run!)

      expect(readEventTypes(sessionId)).toEqual([
        'RunStarted',
        'AssistantMessageCompleted',
        'RunAborted'
      ])
      expect(
        db()
          .select()
          .from(messages)
          .where(eq(messages.id, 'assistant-abort'))
          .get()
      ).toMatchObject({
        status: 'aborted',
        errorText: null
      })
      expect(
        db()
          .select()
          .from(backendRuns)
          .where(eq(backendRuns.id, 'run-abort'))
          .get()
      ).toMatchObject({
        status: 'aborted',
        stopReason: 'response.cancelled',
        errorText: null
      })
      expect(checkChatSessionProjectionParity(sessionId).unexplainedDiffs).toEqual([])
    })
  })

  it('characterizes interrupted-run recovery', async () => {
    await withTempDataDir(async () => {
      const sessionId = 'session-parity-interrupted'
      seedSession(sessionId)
      commitSessionEventsInTransaction(sessionId, [
        runStartedEvent({
          sessionId,
          runId: 'run-interrupted',
          messageId: 'assistant-interrupted',
          startedAt: 101
        })
      ])

      await expect(finalizeInterruptedSessionEventStream(sessionId)).resolves.toBe(true)

      expect(readEventTypes(sessionId)).toEqual([
        'RunStarted',
        'AssistantMessageCompleted',
        'RunFailed'
      ])
      expect(
        db()
          .select()
          .from(messages)
          .where(eq(messages.id, 'assistant-interrupted'))
          .get()
      ).toMatchObject({
        status: 'failed',
        errorText: expect.stringContaining('server process exited')
      })
      expect(
        db()
          .select()
          .from(backendRuns)
          .where(eq(backendRuns.id, 'run-interrupted'))
          .get()
      ).toMatchObject({
        status: 'failed',
        stopReason: 'response.interrupted',
        errorText: expect.stringContaining('server process exited')
      })
      expect(checkChatSessionProjectionParity(sessionId).unexplainedDiffs).toEqual([])
    })
  })

  it('replays v1 fixture events through the upcaster without projection drift', async () => {
    await withTempDataDir(() => {
      const sessionId = 'session-parity-v1'
      seedSession(sessionId)
      const runStarted = runStartedEvent({
        sessionId,
        runId: 'run-v1',
        messageId: 'assistant-v1',
        startedAt: 102
      })
      const events: Array<{ type: ChatSessionEvent['type']; payload: object }> = [
        userMessageEvent('user-v1', sessionId, 'hello from v1', 101),
        {
          type: runStarted.type,
          payload: {
            ...runStarted.payload,
            assistantMessageProjection: 'insert' as const
          }
        },
        assistantCompletedEvent(sessionId, 'assistant-v1', 'done from v1', 110),
        runCompletedEvent({ sessionId, runId: 'run-v1', finishedAt: 110 })
      ]

      events.forEach((event, index) => appendV1EventAndProject(sessionId, index + 1, event))

      const report = checkChatSessionProjectionParity(sessionId)
      expect(report.unexplainedDiffs).toEqual([])
      expect(report.diffCount).toBe(0)
      expect(
        db()
          .select()
          .from(sessionEvents)
          .where(eq(sessionEvents.aggregateId, sessionId))
          .all()
          .map(row => parseStoredChatSessionEvent(row).payload.v)
      ).toEqual(events.map(() => CHAT_SESSION_EVENT_SCHEMA_VERSION))
    })
  })

  it('replays streaming assistant message snapshots without projection drift', async () => {
    await withTempDataDir(() => {
      const sessionId = 'session-parity-streaming-snapshot'
      seedSession(sessionId)
      commitSessionEventsInTransaction(sessionId, [
        runStartedEvent({
          sessionId,
          runId: 'run-streaming-snapshot',
          messageId: 'assistant-streaming-snapshot',
          startedAt: 101
        }),
        assistantSnapshottedEvent(
          sessionId,
          'run-streaming-snapshot',
          'assistant-streaming-snapshot',
          'partial',
          105
        )
      ])

      expect(
        db()
          .select()
          .from(messages)
          .where(eq(messages.id, 'assistant-streaming-snapshot'))
          .get()
      ).toMatchObject({
        status: 'streaming',
        content: 'partial',
        updatedAt: 105
      })

      const report = checkChatSessionProjectionParity(sessionId)
      expect(report.expectedLoglessDiffs).toEqual([])
      expect(report.unexplainedDiffs).toEqual([])
      expect(report.diffCount).toBe(0)
    })
  })

  it('reports logless streaming message updates as unexplained drift', async () => {
    await withTempDataDir(() => {
      const sessionId = 'session-parity-streaming'
      seedSession(sessionId)
      commitSessionEventsInTransaction(sessionId, [
        runStartedEvent({
          sessionId,
          runId: 'run-streaming',
          messageId: 'assistant-streaming',
          startedAt: 101
        })
      ])

      db()
        .update(messages)
        .set({
          content: 'partial',
          messageJson: JSON.stringify({
            id: 'assistant-streaming',
            role: 'assistant',
            parts: [{ type: 'text', text: 'partial' }]
          }),
          updatedAt: 105
        })
        .where(eq(messages.id, 'assistant-streaming'))
        .run()

      const report = checkChatSessionProjectionParity(sessionId)
      expect(report.expectedLoglessDiffs).toEqual([])
      expect(report.unexplainedDiffs).toEqual([
        expect.objectContaining({
          table: 'messages',
          rowId: 'assistant-streaming',
          kind: 'changed_projection_row',
          category: 'unexplained_projection_drift',
          changedFields: ['content', 'messageJson', 'updatedAt']
        })
      ])
    })
  })

  it('reports non-streaming message mutations as unexplained drift', async () => {
    await withTempDataDir(() => {
      const sessionId = 'session-parity-complete-drift'
      seedSession(sessionId)
      commitSessionEventsInTransaction(sessionId, [
        userMessageEvent('user-complete', sessionId, 'original', 101)
      ])

      db()
        .update(messages)
        .set({
          content: 'mutated',
          messageJson: JSON.stringify({
            id: 'user-complete',
            role: 'user',
            parts: [{ type: 'text', text: 'mutated' }]
          }),
          updatedAt: 105
        })
        .where(eq(messages.id, 'user-complete'))
        .run()

      const report = checkChatSessionProjectionParity(sessionId)
      expect(report.expectedLoglessDiffs).toEqual([])
      expect(report.unexplainedDiffs).toEqual([
        expect.objectContaining({
          table: 'messages',
          rowId: 'user-complete',
          kind: 'changed_projection_row',
          category: 'unexplained_projection_drift',
          changedFields: ['content', 'messageJson', 'updatedAt']
        })
      ])
    })
  })

  it('reports logless imported messages as unexplained drift', async () => {
    await withTempDataDir(() => {
      const sessionId = 'session-parity-import'
      seedSession(sessionId)
      db()
        .insert(messages)
        .values({
          id: 'imported-message-1',
          sessionId,
          role: 'user',
          status: 'complete',
          content: 'imported',
          messageJson: JSON.stringify({
            id: 'imported-message-1',
            role: 'user',
            parts: [{ type: 'text', text: 'imported' }]
          }),
          createdAt: 101,
          updatedAt: 101
        })
        .run()

      const report = checkChatSessionProjectionParity(sessionId)
      expect(report.expectedLoglessDiffs).toEqual([])
      expect(report.unexplainedDiffs).toEqual([
        expect.objectContaining({
          table: 'messages',
          rowId: 'imported-message-1',
          kind: 'extra_projection_row',
          category: 'unexplained_projection_drift'
        })
      ])
    })
  })

  it('reports unexplained projection drift separately from expected bypasses', async () => {
    await withTempDataDir(() => {
      const sessionId = 'session-parity-unexplained'
      seedSession(sessionId)
      commitSessionEventsInTransaction(sessionId, [
        runStartedEvent({
          sessionId,
          runId: 'run-1',
          messageId: 'assistant-1',
          startedAt: 101
        }),
        assistantCompletedEvent(sessionId, 'assistant-1', 'done', 110),
        runCompletedEvent({ sessionId, runId: 'run-1', finishedAt: 110 })
      ])

      db()
        .update(backendRuns)
        .set({ status: 'failed', errorText: 'mutated out of band' })
        .where(eq(backendRuns.id, 'run-1'))
        .run()

      const report = checkChatSessionProjectionParity(sessionId)
      expect(report.expectedLoglessDiffs).toEqual([])
      expect(report.unexplainedDiffs).toEqual([
        expect.objectContaining({
          table: 'backend_runs',
          rowId: 'run-1',
          kind: 'changed_projection_row',
          category: 'unexplained_projection_drift',
          changedFields: ['errorText', 'status']
        })
      ])
    })
  })
})
