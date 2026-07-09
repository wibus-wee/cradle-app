import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  messages,
  runStreamCheckpoints,
  sessionEvents,
  sessions,
} from '@cradle/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db, shutdownInfra } from '../../../infra'
import * as Session from '../../session/service'
import { commitSessionEventsInTransaction } from '../es/commands'
import { readSessionEvents } from '../es/event-store'
import {
  CHAT_SESSION_AGGREGATE_TYPE,
  LEGACY_ASSISTANT_MESSAGE_SNAPSHOTTED_EVENT_TYPE,
} from '../es/events'
import { finalizeInterruptedRun } from '../es/recovery'
import { getMessageGroups } from '../history-api'
import {
  deleteRunStreamCheckpoint,
  readRunStreamCheckpoint,
  upsertRunStreamCheckpoint,
} from './checkpoint-store'

function restoreEnv(name: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = previousValue
}

async function withTempDataDir<T>(callback: () => Promise<T> | T): Promise<T> {
  const dataDir = mkdtempSync(join(tmpdir(), 'cradle-chat-checkpoint-'))
  const previousDataDir = process.env.CRADLE_DATA_DIR
  const previousDbPath = process.env.CRADLE_DB_PATH
  process.env.CRADLE_DATA_DIR = dataDir
  delete process.env.CRADLE_DB_PATH

  try {
    return await callback()
  }
 finally {
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
      title: 'Checkpoint Test',
      titleSource: 'initial',
      runtimeKind: 'standard',
      createdAt: 100,
      updatedAt: 100,
    })
    .run()
}

function seedStreamingRun(input: {
  sessionId: string
  runId: string
  messageId: string
  content?: string
}): void {
  const content = input.content ?? ''
  const messageJson = JSON.stringify({
    id: input.messageId,
    role: 'assistant',
    parts: content ? [{ type: 'text', text: content }] : [],
  })
  commitSessionEventsInTransaction(input.sessionId, [
    {
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
          startedAt: 100,
          finishedAt: null,
        },
        assistantMessage: {
          id: input.messageId,
          sessionId: input.sessionId,
          parentMessageId: null,
          parentToolCallId: null,
          taskId: null,
          depth: 0,
          role: 'assistant',
          status: 'streaming',
          content,
          messageJson,
          errorText: null,
          createdAt: 100,
          updatedAt: 100,
        },
        queueItemId: null,
      },
    },
  ])
}

describe('run stream checkpoints', () => {
  it('upserts, dedups identical messageJson, and deletes by run id', async () => {
    await withTempDataDir(() => {
      const first = {
        runId: 'run-1',
        sessionId: 'session-1',
        messageId: 'assistant-1',
        messageJson: JSON.stringify({
          id: 'assistant-1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'partial' }],
        }),
        chunkSeq: 0,
        updatedAt: 110,
      }
      upsertRunStreamCheckpoint(first)
      upsertRunStreamCheckpoint({ ...first, updatedAt: 120 })
      expect(readRunStreamCheckpoint('run-1')).toMatchObject({
        messageJson: first.messageJson,
        updatedAt: 120,
      })
      expect(
        db().select().from(runStreamCheckpoints).all(),
      ).toHaveLength(1)

      upsertRunStreamCheckpoint({
        ...first,
        messageJson: JSON.stringify({
          id: 'assistant-1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'partial more' }],
        }),
        updatedAt: 130,
      })
      expect(readRunStreamCheckpoint('run-1')?.updatedAt).toBe(130)

      deleteRunStreamCheckpoint('run-1')
      expect(readRunStreamCheckpoint('run-1')).toBeUndefined()
    })
  })

  it('promotes a checkpoint into AssistantMessageCompleted + RunFailed on recovery', async () => {
    await withTempDataDir(async () => {
      const sessionId = 'session-checkpoint-recovery'
      const runId = 'run-checkpoint-recovery'
      const messageId = 'assistant-checkpoint-recovery'
      seedSession(sessionId)
      seedStreamingRun({ sessionId, runId, messageId, content: '' })

      const checkpointJson = JSON.stringify({
        id: messageId,
        role: 'assistant',
        parts: [{ type: 'text', text: 'checkpoint partial' }],
      })
      upsertRunStreamCheckpoint({
        runId,
        sessionId,
        messageId,
        messageJson: checkpointJson,
        chunkSeq: 0,
        updatedAt: 150,
      })

      expect(await finalizeInterruptedRun(sessionId, runId)).toBe(true)
      expect(readRunStreamCheckpoint(runId)).toBeUndefined()
      expect(
        db().select().from(messages).where(eq(messages.id, messageId)).get(),
      ).toMatchObject({
        status: 'failed',
        content: 'checkpoint partial',
        messageJson: checkpointJson,
      })
      expect(
        db()
          .select({ eventType: sessionEvents.eventType })
          .from(sessionEvents)
          .where(eq(sessionEvents.aggregateId, sessionId))
          .all()
          .map(row => row.eventType),
      ).toEqual(expect.arrayContaining(['AssistantMessageCompleted', 'RunFailed']))
    })
  })

  it('overlays checkpoint content for streaming messages in history reads', async () => {
    await withTempDataDir(async () => {
      const sessionId = 'session-checkpoint-overlay'
      const runId = 'run-checkpoint-overlay'
      const messageId = 'assistant-checkpoint-overlay'
      seedSession(sessionId)
      seedStreamingRun({ sessionId, runId, messageId, content: '' })

      upsertRunStreamCheckpoint({
        runId,
        sessionId,
        messageId,
        messageJson: JSON.stringify({
          id: messageId,
          role: 'assistant',
          parts: [{ type: 'text', text: 'overlay partial' }],
        }),
        chunkSeq: 0,
        updatedAt: 160,
      })

      const groups = await getMessageGroups(sessionId)
      expect(groups).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            messageId,
            status: 'streaming',
            content: 'overlay partial',
          }),
        ]),
      )
      expect(
        db().select().from(messages).where(eq(messages.id, messageId)).get()?.content,
      ).toBe('')
    })
  })

  it('deletes session events and checkpoints when deleting a session', async () => {
    await withTempDataDir(() => {
      const sessionId = 'session-checkpoint-delete'
      const runId = 'run-checkpoint-delete'
      const messageId = 'assistant-checkpoint-delete'
      seedSession(sessionId)
      seedStreamingRun({ sessionId, runId, messageId })
      upsertRunStreamCheckpoint({
        runId,
        sessionId,
        messageId,
        messageJson: JSON.stringify({
          id: messageId,
          role: 'assistant',
          parts: [],
        }),
        chunkSeq: 0,
        updatedAt: 170,
      })

      Session.remove(sessionId)

      expect(
        db().select().from(sessions).where(eq(sessions.id, sessionId)).get(),
      ).toBeUndefined()
      expect(
        db().select().from(sessionEvents).where(eq(sessionEvents.aggregateId, sessionId)).all(),
      ).toEqual([])
      expect(readRunStreamCheckpoint(runId)).toBeUndefined()
    })
  })

  it('filters legacy AssistantMessageSnapshotted rows at the read boundary', async () => {
    await withTempDataDir(() => {
      const sessionId = 'session-legacy-snapshot-filter'
      seedSession(sessionId)
      db()
        .insert(sessionEvents)
        .values([
          {
            aggregateId: sessionId,
            aggregateType: CHAT_SESSION_AGGREGATE_TYPE,
            version: 1,
            eventType: 'TitleChanged',
            payload: JSON.stringify({
              sessionId,
              title: 'Kept',
              titleSource: 'provider',
              updatedAt: 100,
              v: 3,
            }),
            occurredAt: 100,
          },
          {
            aggregateId: sessionId,
            aggregateType: CHAT_SESSION_AGGREGATE_TYPE,
            version: 2,
            eventType: LEGACY_ASSISTANT_MESSAGE_SNAPSHOTTED_EVENT_TYPE,
            payload: JSON.stringify({
              runId: 'run-legacy',
              message: {
                id: 'assistant-legacy',
                sessionId,
                content: 'legacy',
                messageJson: '{}',
                status: 'streaming',
                errorText: null,
                updatedAt: 110,
              },
              messageJsonBytes: 2,
              v: 2,
            }),
            occurredAt: 110,
          },
          {
            aggregateId: sessionId,
            aggregateType: CHAT_SESSION_AGGREGATE_TYPE,
            version: 3,
            eventType: 'TitleChanged',
            payload: JSON.stringify({
              sessionId,
              title: 'Also kept',
              titleSource: 'provider',
              updatedAt: 120,
              v: 3,
            }),
            occurredAt: 120,
          },
        ])
        .run()

      const events = readSessionEvents(sessionId)
      expect(events.map(event => event.type)).toEqual(['TitleChanged', 'TitleChanged'])
      expect(events.map(event => event.version)).toEqual([1, 3])
    })
  })
})
