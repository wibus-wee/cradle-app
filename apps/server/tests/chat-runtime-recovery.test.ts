import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  backendRuns,
  backendRunSnapshots,
  chatSessionQueueItems,
  messages,
  sessionEvents,
  sessions,
} from '@cradle/db'
import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db, shutdownInfra } from '../src/infra'
import { checkChatSessionProjectionParity } from '../src/modules/chat-runtime/es/parity'
import {
  recoverChatRuntimeProjections,
  recoverChatRuntimeSession,
} from '../src/modules/chat-runtime/es/recovery'
import { getMessageGroups, getMessageSnapshot } from '../src/modules/chat-runtime/history-api'
import {
  hydrateMessage,
  putMessagePayload,
  readMessagePayload,
  toMessageProjectionValues,
} from '../src/modules/chat-runtime/message-payload-store'
import { recoverPersistedRunProjections } from '../src/modules/chat-runtime/runtime'

const INTERRUPTED_RUN_ERROR_TEXT
  = 'Response interrupted because the Cradle server process exited while the run was streaming.'

function restoreEnv(name: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[name]
  }
 else {
    process.env[name] = previousValue
  }
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

function seedSession(sessionId: string): void {
  db()
    .insert(sessions)
    .values({
      id: sessionId,
      title: 'Recovery Session',
      titleSource: 'initial',
      runtimeKind: 'standard',
      createdAt: 1700000000,
      updatedAt: 1700000000,
    })
    .run()
}

function seedAssistantMessage(input: {
  id: string
  sessionId: string
  status: 'streaming' | 'complete' | 'aborted' | 'failed'
  content?: string
  errorText?: string | null
  createdAt?: number
  updatedAt?: number
}): void {
  const content = input.content ?? 'partial response'
  const message = {
    id: input.id,
    sessionId: input.sessionId,
    parentMessageId: null,
    parentToolCallId: null,
    taskId: null,
    depth: 0,
    role: 'assistant' as const,
    status: input.status,
    content,
    messageJson: JSON.stringify({
      id: input.id,
      role: 'assistant',
      parts: [{ type: 'text', text: content }],
    }),
    errorText: input.errorText ?? null,
    createdAt: input.createdAt ?? 1700000000,
    updatedAt: input.updatedAt ?? 1700000000,
  }
  putMessagePayload(db(), message)
  db()
    .insert(messages)
    .values(toMessageProjectionValues(message))
    .run()
}

function readHydratedMessage(messageId: string) {
  const message = db().select().from(messages).where(eq(messages.id, messageId)).get()
  if (!message) {
    return undefined
  }
  const payload = readMessagePayload(db(), message.payloadId)
  return payload ? hydrateMessage(message, payload) : undefined
}

function seedBackendRun(input: {
  id: string
  sessionId: string
  messageId: string | null
  status: 'streaming' | 'complete' | 'aborted' | 'failed'
  stopReason?: string | null
  errorText?: string | null
  startedAt?: number
  finishedAt?: number | null
  origin?: 'user' | 'issue-agent' | 'system'
}): void {
  db()
    .insert(backendRuns)
    .values({
      id: input.id,
      bindingId: null,
      chatSessionId: input.sessionId,
      messageId: input.messageId,
      origin: input.origin ?? 'user',
      status: input.status,
      stopReason: input.stopReason ?? null,
      errorText: input.errorText ?? null,
      startedAt: input.startedAt ?? 1700000000,
      finishedAt: input.finishedAt ?? null,
    })
    .run()
}

function readMigrationStatements(name: string): string[] {
  return readFileSync(resolve(process.cwd(), '../../packages/db/drizzle', name), 'utf8')
    .split('--> statement-breakpoint')
    .map(statement => statement.trim())
    .filter(statement => statement.length > 0)
}

function seedQueueItem(input: {
  id: string
  sessionId: string
  startedRunId: string | null
  status?: 'pending' | 'running' | 'cancelled' | 'completed' | 'failed'
  position?: number
}): void {
  db()
    .insert(chatSessionQueueItems)
    .values({
      id: input.id,
      sessionId: input.sessionId,
      mode: 'queue',
      status: input.status ?? 'running',
      text: 'queued follow-up',
      filesJson: '[]',
      contextPartsJson: '[]',
      providerTargetId: null,
      modelId: null,
      thinkingEffort: null,
      permissionMode: null,
      runtimeAccessMode: 'approval-required',
      runtimeInteractionMode: 'default',
      position: input.position ?? 1,
      sourceRunId: null,
      startedRunId: input.startedRunId,
      errorText: null,
      createdAt: 1700000000,
      updatedAt: 1700000000,
    })
    .run()
}

function countSessionEvents(sessionId: string): number {
  return db()
    .select({ count: sql<number>`count(*)` })
    .from(sessionEvents)
    .where(eq(sessionEvents.aggregateId, sessionId))
    .get()!
.count
}

describe('chat runtime recovery', () => {
  it('migrates a legacy multi-system-run storm before installing the streaming guard', async () => {
    await withTempDataDir(async () => {
      const sessionId = 'session-legacy-system-storm'
      seedSession(sessionId)
      db().run(sql`drop index backend_runs_one_streaming_per_session_unique`)

      for (const index of [1, 2]) {
        const messageId = `message-legacy-system-${index}`
        seedAssistantMessage({
          id: messageId,
          sessionId,
          status: 'streaming',
          content: `legacy partial ${index}`,
          createdAt: 1700000000 + index,
          updatedAt: 1700000000 + index,
        })
        seedBackendRun({
          id: `run-legacy-system-${index}`,
          sessionId,
          messageId,
          origin: 'system',
          status: 'streaming',
          startedAt: 1700000000 + index,
        })
      }

      for (const statement of readMigrationStatements('0042_sudden_pepper_potts.sql')) {
        db().run(sql.raw(statement))
      }

      expect(
        db().select().from(backendRuns).where(eq(backendRuns.chatSessionId, sessionId)).all(),
      ).toEqual([
        expect.objectContaining({
          id: 'run-legacy-system-1',
          origin: 'system',
          status: 'failed',
          stopReason: 'response.interrupted',
          finishedAt: expect.any(Number),
        }),
        expect.objectContaining({
          id: 'run-legacy-system-2',
          origin: 'system',
          status: 'failed',
          stopReason: 'response.interrupted',
          finishedAt: expect.any(Number),
        }),
      ])

      expect(await recoverChatRuntimeSession(sessionId)).toEqual({
        interruptedRunsFinalized: 0,
        terminalFactsProjected: 2,
        terminalProjectionDriftsRepaired: 0,
      })
      expect(
        db()
          .select({ eventType: sessionEvents.eventType, subjectRunId: sessionEvents.subjectRunId })
          .from(sessionEvents)
          .where(eq(sessionEvents.aggregateId, sessionId))
          .orderBy(sessionEvents.version)
          .all(),
      ).toEqual([
        { eventType: 'RunStarted', subjectRunId: 'run-legacy-system-1' },
        { eventType: 'AssistantMessageCompleted', subjectRunId: null },
        { eventType: 'RunFailed', subjectRunId: 'run-legacy-system-1' },
        { eventType: 'RunStarted', subjectRunId: 'run-legacy-system-2' },
        { eventType: 'AssistantMessageCompleted', subjectRunId: null },
        { eventType: 'RunFailed', subjectRunId: 'run-legacy-system-2' },
      ])
      expect(checkChatSessionProjectionParity(sessionId)).toEqual(
        expect.objectContaining({ diffCount: 0, unexplainedDiffs: [] }),
      )

      seedBackendRun({
        id: 'run-streaming-guard-1',
        sessionId,
        messageId: null,
        origin: 'system',
        status: 'streaming',
      })
      expect(() => seedBackendRun({
        id: 'run-streaming-guard-2',
        sessionId,
        messageId: null,
        origin: 'system',
        status: 'streaming',
      })).toThrow(/UNIQUE constraint failed/)
    })
  })

  it('bounds initial history hydration for a damaged 887-message session', async () => {
    await withTempDataDir(async () => {
      seedSession('session-bounded-history')
      for (let index = 0; index < 887; index += 1) {
        seedAssistantMessage({
          id: `message-${String(index).padStart(4, '0')}`,
          sessionId: 'session-bounded-history',
          status: 'failed',
          createdAt: 1700000000 + index,
          updatedAt: 1700000000 + index,
        })
      }

      const firstPage = await getMessageSnapshot('session-bounded-history')

      expect(firstPage.rows).toHaveLength(100)
      expect(firstPage.rows[0]?.messageId).toBe('message-0787')
      expect(firstPage.rows.at(-1)?.messageId).toBe('message-0886')

      const allIds = [...firstPage.rows.map(row => row.messageId)]
      let cursor = firstPage.nextCursor
      while (cursor) {
        const page = await getMessageSnapshot('session-bounded-history', { cursor })
        allIds.unshift(...page.rows.map(row => row.messageId))
        cursor = page.nextCursor
      }
      expect(allIds).toHaveLength(887)
      expect(new Set(allIds).size).toBe(887)
      expect(allIds[0]).toBe('message-0000')
      expect(allIds.at(-1)).toBe('message-0886')
    })
  })

  it('does not append session events from ordinary message reads', async () => {
    await withTempDataDir(async () => {
      seedSession('session-read-no-repair')
      seedAssistantMessage({
        id: 'message-read-no-repair',
        sessionId: 'session-read-no-repair',
        status: 'streaming',
      })
      seedBackendRun({
        id: 'run-read-no-repair',
        sessionId: 'session-read-no-repair',
        messageId: 'message-read-no-repair',
        status: 'aborted',
        stopReason: 'response.cancelled',
        finishedAt: 1700000100,
      })

      expect(countSessionEvents('session-read-no-repair')).toBe(0)

      const rows = await getMessageGroups('session-read-no-repair')

      expect(rows).toEqual([
        expect.objectContaining({
          messageId: 'message-read-no-repair',
          status: 'streaming',
        }),
      ])
      expect(countSessionEvents('session-read-no-repair')).toBe(0)
    })
  })

  it('projects missing terminal run facts once through generated run identity', async () => {
    await withTempDataDir(async () => {
      seedSession('session-terminal-recovery')
      seedAssistantMessage({
        id: 'message-terminal-recovery',
        sessionId: 'session-terminal-recovery',
        status: 'streaming',
        content: 'terminal projection drift',
      })
      seedBackendRun({
        id: 'run-terminal-recovery',
        sessionId: 'session-terminal-recovery',
        messageId: 'message-terminal-recovery',
        status: 'aborted',
        stopReason: 'response.cancelled',
        finishedAt: 1700000100,
      })
      seedQueueItem({
        id: 'queue-terminal-recovery',
        sessionId: 'session-terminal-recovery',
        startedRunId: 'run-terminal-recovery',
      })

      const first = await recoverChatRuntimeSession('session-terminal-recovery')
      const second = await recoverChatRuntimeSession('session-terminal-recovery')

      expect(first).toEqual({
        interruptedRunsFinalized: 0,
        terminalFactsProjected: 1,
        terminalProjectionDriftsRepaired: 0,
      })
      expect(second).toEqual({
        interruptedRunsFinalized: 0,
        terminalFactsProjected: 0,
        terminalProjectionDriftsRepaired: 0,
      })

      expect(
        readHydratedMessage('message-terminal-recovery'),
      ).toEqual(
        expect.objectContaining({
          status: 'aborted',
          errorText: null,
        }),
      )
      expect(
        db()
          .select()
          .from(chatSessionQueueItems)
          .where(eq(chatSessionQueueItems.id, 'queue-terminal-recovery'))
          .get(),
      ).toEqual(
        expect.objectContaining({
          status: 'cancelled',
          startedRunId: 'run-terminal-recovery',
        }),
      )
      expect(
        db()
          .select({ eventType: sessionEvents.eventType, subjectRunId: sessionEvents.subjectRunId })
          .from(sessionEvents)
          .where(eq(sessionEvents.aggregateId, 'session-terminal-recovery'))
          .orderBy(sessionEvents.version)
          .all(),
      ).toEqual([
        { eventType: 'QueueItemEnqueued', subjectRunId: null },
        { eventType: 'RunStarted', subjectRunId: 'run-terminal-recovery' },
        { eventType: 'AssistantMessageCompleted', subjectRunId: null },
        { eventType: 'RunAborted', subjectRunId: 'run-terminal-recovery' },
      ])
    })
  })

  it('finalizes persisted streaming runs from backend_runs without event replay', async () => {
    await withTempDataDir(async () => {
      seedSession('session-streaming-recovery')
      seedAssistantMessage({
        id: 'message-streaming-recovery',
        sessionId: 'session-streaming-recovery',
        status: 'streaming',
      })
      seedBackendRun({
        id: 'run-streaming-recovery',
        sessionId: 'session-streaming-recovery',
        messageId: 'message-streaming-recovery',
        status: 'streaming',
      })
      seedQueueItem({
        id: 'queue-streaming-recovery',
        sessionId: 'session-streaming-recovery',
        startedRunId: 'run-streaming-recovery',
      })

      const first = await recoverPersistedRunProjections()
      const second = await recoverChatRuntimeProjections()

      expect(first).toEqual({
        interruptedRunsFinalized: 1,
        terminalFactsProjected: 0,
        terminalProjectionDriftsRepaired: 0,
      })
      expect(second).toEqual({
        interruptedRunsFinalized: 0,
        terminalFactsProjected: 0,
        terminalProjectionDriftsRepaired: 0,
      })
      expect(
        db().select().from(backendRuns).where(eq(backendRuns.id, 'run-streaming-recovery')).get(),
      ).toEqual(
        expect.objectContaining({
          status: 'failed',
          stopReason: 'response.interrupted',
          errorText: INTERRUPTED_RUN_ERROR_TEXT,
          finishedAt: expect.any(Number),
        }),
      )
      expect(
        readHydratedMessage('message-streaming-recovery'),
      ).toEqual(
        expect.objectContaining({
          status: 'failed',
          errorText: INTERRUPTED_RUN_ERROR_TEXT,
        }),
      )
      expect(
        db()
          .select()
          .from(chatSessionQueueItems)
          .where(eq(chatSessionQueueItems.id, 'queue-streaming-recovery'))
          .get(),
      ).toEqual(
        expect.objectContaining({
          status: 'failed',
          errorText: INTERRUPTED_RUN_ERROR_TEXT,
          startedRunId: 'run-streaming-recovery',
        }),
      )
    })
  })

  it('repairs terminal fact drift without appending new events', async () => {
    await withTempDataDir(async () => {
      seedSession('session-terminal-drift')
      seedAssistantMessage({
        id: 'message-terminal-drift',
        sessionId: 'session-terminal-drift',
        status: 'streaming',
        content: 'late streaming overwrite',
        updatedAt: 1700000200,
      })
      seedBackendRun({
        id: 'run-terminal-drift',
        sessionId: 'session-terminal-drift',
        messageId: 'message-terminal-drift',
        status: 'failed',
        stopReason: 'response.interrupted',
        errorText: 'terminal failure',
        finishedAt: 1700000100,
      })
      db()
        .insert(backendRunSnapshots)
        .values({
          id: 'snapshot-terminal-drift',
          schemaVersion: 1,
          traceId: 'run-terminal-drift',
          chatSessionId: 'session-terminal-drift',
          runId: 'run-terminal-drift',
          messageId: 'message-terminal-drift',
          providerTargetId: null,
          runtimeKind: 'standard',
          providerSessionId: null,
          modelId: 'gpt-4o-mini',
          agentId: null,
          workspaceId: null,
          status: 'complete',
          startedAt: 1700000000000,
          completedAt: 1700000200000,
          completionReason: 'response.completed',
          errorText: null,
          summaryJson: '{}',
        })
        .run()
      db()
        .insert(sessionEvents)
        .values([
          {
            aggregateId: 'session-terminal-drift',
            aggregateType: 'ChatSession',
            version: 1,
            eventType: 'AssistantMessageCompleted',
            payload: JSON.stringify({
              message: {
                id: 'message-terminal-drift',
                sessionId: 'session-terminal-drift',
                content: 'failed response',
                messageJson: JSON.stringify({
                  id: 'message-terminal-drift',
                  role: 'assistant',
                  parts: [{ type: 'text', text: 'failed response' }],
                }),
                status: 'failed',
                errorText: 'terminal failure',
                updatedAt: 1700000100,
              },
            }),
            occurredAt: 1700000100,
          },
          {
            aggregateId: 'session-terminal-drift',
            aggregateType: 'ChatSession',
            version: 2,
            eventType: 'RunFailed',
            payload: JSON.stringify({
              runId: 'run-terminal-drift',
              sessionId: 'session-terminal-drift',
              queueItemId: null,
              status: 'failed',
              stopReason: 'response.interrupted',
              errorText: 'terminal failure',
              finishedAt: 1700000100,
            }),
            occurredAt: 1700000100,
          },
        ])
        .run()

      const eventsBefore = countSessionEvents('session-terminal-drift')
      const first = await recoverChatRuntimeSession('session-terminal-drift')
      const second = await recoverChatRuntimeProjections()

      expect(first).toEqual({
        interruptedRunsFinalized: 0,
        terminalFactsProjected: 0,
        terminalProjectionDriftsRepaired: 1,
      })
      expect(second).toEqual({
        interruptedRunsFinalized: 0,
        terminalFactsProjected: 0,
        terminalProjectionDriftsRepaired: 0,
      })
      expect(countSessionEvents('session-terminal-drift')).toBe(eventsBefore)
      expect(
        readHydratedMessage('message-terminal-drift'),
      ).toEqual(
        expect.objectContaining({
          status: 'failed',
          content: 'late streaming overwrite',
          errorText: null,
          updatedAt: 1700000100,
        }),
      )
      expect(
        db().select().from(backendRuns).where(eq(backendRuns.id, 'run-terminal-drift')).get(),
      ).toEqual(expect.objectContaining({ status: 'failed' }))
      expect(
        db()
          .select()
          .from(backendRunSnapshots)
          .where(eq(backendRunSnapshots.id, 'snapshot-terminal-drift'))
          .get(),
      ).toEqual(
        expect.objectContaining({
          status: 'failed',
          completedAt: 1700000100000,
          completionReason: 'response.interrupted',
          errorText: 'terminal failure',
        }),
      )
    })
  })

  it('enforces one terminal fact per session run and uses the partial index for lookup', async () => {
    await withTempDataDir(() => {
      db()
        .insert(sessionEvents)
        .values({
          aggregateId: 'session-terminal-unique',
          aggregateType: 'ChatSession',
          version: 1,
          eventType: 'RunFailed',
          payload: JSON.stringify({
            runId: 'run-terminal-unique',
            sessionId: 'session-terminal-unique',
            status: 'failed',
            stopReason: 'response.failed',
            errorText: 'first failure',
            finishedAt: 1700000100,
          }),
          occurredAt: 1700000100,
        })
        .run()

      expect(() =>
        db()
          .insert(sessionEvents)
          .values({
            aggregateId: 'session-terminal-unique',
            aggregateType: 'ChatSession',
            version: 2,
            eventType: 'RunAborted',
            payload: JSON.stringify({
              runId: 'run-terminal-unique',
              sessionId: 'session-terminal-unique',
              status: 'aborted',
              stopReason: 'response.cancelled',
              errorText: null,
              finishedAt: 1700000101,
            }),
            occurredAt: 1700000101,
          })
          .run()).toThrow(/UNIQUE constraint failed/)

      const planRows: Array<{ id: number, parent: number, notused: number, detail: string }> = db()
        .all(sql`
          explain query plan
          select 1
          from session_events
          where aggregate_id = 'session-terminal-unique'
            and subject_run_id = 'run-terminal-unique'
            and event_type in ('RunCompleted', 'RunFailed', 'RunAborted')
        `)

      expect(planRows.map(row => row.detail).join('\n')).toContain(
        'session_events_terminal_fact_run_unique',
      )
    })
  })
})
