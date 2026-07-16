import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  backendRuns,
  backendRunSnapshotEvents,
  backendRunSnapshots,
  messages,
  sessions,
} from '@cradle/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { db, shutdownInfra } from '../src/infra'
import {
  putMessagePayload,
  toMessageProjectionValues,
} from '../src/modules/chat-runtime/message-payload-store'
import {
  finalizeActiveRunSnapshot,
  recordActiveRunSnapshotEvent,
  startActiveRunSnapshot,
} from '../src/modules/chat-runtime/run/active-run-snapshot'
import { createFinalMessageProjectionState } from '../src/modules/chat-runtime/run/final-message-projection'
import type { ActiveRun } from '../src/modules/chat-runtime/run-registry'
import {
  COMPACTED_SUCCESS_PAYLOAD_SCHEMA,
  getRunSnapshot,
  getRunSnapshots,
  maintainRunSnapshots,
} from '../src/modules/chat-runtime/run-snapshot'
import { createRunChunkLog } from '../src/modules/chat-runtime/stream/run-chunk-log'

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

function withEnv<T>(name: string, value: string, callback: () => T): T {
  const previous = process.env[name]
  process.env[name] = value
  try {
    return callback()
  }
 finally {
    restoreEnv(name, previous)
  }
}

function seedSession(sessionId: string): void {
  db()
    .insert(sessions)
    .values({
      id: sessionId,
      title: 'Run Snapshot Test Session',
      titleSource: 'initial',
      runtimeKind: 'standard',
      createdAt: 1700000000,
      updatedAt: 1700000000,
    })
    .run()
}

function seedMessage(input: { id: string, sessionId: string }): void {
  const message = {
    id: input.id,
    sessionId: input.sessionId,
    parentMessageId: null,
    parentToolCallId: null,
    taskId: null,
    depth: 0,
    role: 'assistant' as const,
    status: 'streaming' as const,
    content: '',
    messageJson: JSON.stringify({ id: input.id, role: 'assistant', parts: [] }),
    errorText: null,
    createdAt: 1700000000,
    updatedAt: 1700000000,
  }
  putMessagePayload(db(), message)
  db()
    .insert(messages)
    .values(toMessageProjectionValues(message))
    .run()
}

function seedBackendRun(input: { id: string, sessionId: string }): void {
  db()
    .insert(backendRuns)
    .values({
      id: input.id,
      bindingId: null,
      chatSessionId: input.sessionId,
      messageId: null,
      origin: 'user',
      status: 'streaming',
      stopReason: null,
      errorText: null,
      startedAt: 1700000000,
      finishedAt: null,
    })
    .run()
}

function createActiveRun(input: { runId: string, sessionId: string }): ActiveRun {
  return {
    runId: input.runId,
    sessionId: input.sessionId,
    messageId: `${input.runId}-message`,
    providerTargetKind: null,
    providerTargetId: null,
    runtime: {} as ActiveRun['runtime'],
    runtimeSession: { runtimeKind: 'standard', providerSessionId: null } as ActiveRun['runtimeSession'],
    modelId: 'gpt-4o-mini',
    runChunkLog: createRunChunkLog(input.runId, 100),
    pendingDeltaChunk: null,
    pendingDeltaFlushTimer: null,
    snapshotTimer: null,
    finalMessage: { id: `${input.runId}-message`, role: 'assistant', parts: [] },
    finalProjection: createFinalMessageProjectionState(),
    runtimeSettings: {} as ActiveRun['runtimeSettings'],
    runSnapshotId: null,
    runSnapshotSeq: 0,
    snapshotEventIdByCoalesceKey: new Map(),
    runSnapshotTruncatedEventId: null,
    runSnapshotDroppedEventCount: 0,
  }
}

function setUpRun(sessionId: string, runId: string): ActiveRun {
  seedSession(sessionId)
  seedMessage({ id: `${runId}-message`, sessionId })
  seedBackendRun({ id: runId, sessionId })
  const activeRun = createActiveRun({ runId, sessionId })
  startActiveRunSnapshot(activeRun, { workspaceId: null, agentId: null })
  return activeRun
}

describe('run snapshot recording', () => {
  it('coalesces repeated tool-output-available chunks for the same toolCallId onto one row', async () => {
    await withTempDataDir(() => {
      const sessionId = `session-${randomUUID()}`
      const runId = `run-${randomUUID()}`
      const activeRun = setUpRun(sessionId, runId)
      const seqAfterStart = activeRun.runSnapshotSeq

      for (let i = 0; i < 5; i += 1) {
        recordActiveRunSnapshotEvent(activeRun, {
          phase: 'tool_call_output_available',
          chunk: {
            type: 'tool-output-available',
            toolCallId: 'toolu_repeat',
            output: { push: i },
          },
        })
      }

      // Only one row should have been appended for the 5 pushes.
      expect(activeRun.runSnapshotSeq).toBe(seqAfterStart + 1)

      const snapshot = getRunSnapshot(runId)
      expect(snapshot).not.toBeNull()
      const toolEvent = snapshot!.events.find(event => event.toolCallId === 'toolu_repeat')
      expect(toolEvent).toBeDefined()
      expect(toolEvent!.payload).toEqual(expect.objectContaining({
        toolCallId: 'toolu_repeat',
        output: { push: 4 },
        coalescedCount: 5,
      }))

      const rows = db()
        .select()
        .from(backendRunSnapshotEvents)
        .all()
        .filter(row => row.toolCallId === 'toolu_repeat')
      expect(rows).toHaveLength(1)
    })
  })

  it('caps snapshot events per run and writes a single truncation marker with the final dropped count', async () => {
    await withTempDataDir(() => {
      withEnv('CRADLE_CHAT_RUN_SNAPSHOT_MAX_EVENTS', '3', () => {
        const sessionId = `session-${randomUUID()}`
        const runId = `run-${randomUUID()}`
        const activeRun = setUpRun(sessionId, runId)

        // run_started already consumed one of the 3 slots; add distinct,
        // non-coalescable events (different toolCallId each time) well past the cap.
        for (let i = 0; i < 20; i += 1) {
          recordActiveRunSnapshotEvent(activeRun, {
            phase: 'tool_call_started',
            chunk: { type: 'tool-input-start', toolCallId: `toolu_${i}`, toolName: 'bash' },
          })
        }

        finalizeActiveRunSnapshot(
          activeRun,
          { type: 'finish', finishReason: 'stop' },
          {
            modelId: 'gpt-4o-mini',
            diagnostics: {
              emittedEventCount: 0,
              assistantBoundaryCount: 0,
              assistantTextCharCount: 0,
              reasoningTextCharCount: 0,
              toolInputDeltaCharCount: 0,
              toolEventCount: 0,
              otherOutputEventCount: 0,
            },
            profile: {
              enabled: false,
              streamStartedAtMs: 0,
              streamFinishedAtMs: null,
              finalizeStartedAtMs: null,
              finalizeFinishedAtMs: null,
              finalMessageJsonBytes: null,
            },
          },
        )

        const snapshot = getRunSnapshot(runId)
        expect(snapshot).not.toBeNull()

        // run_started + 2 tool events fit under the cap, then exactly one
        // truncation marker, then run_finalized is always let through.
        const truncatedEvent = snapshot!.events.find(event => event.phase === 'snapshot_events_truncated')
        expect(truncatedEvent).toBeDefined()
        expect(truncatedEvent!.payload).toEqual({ maxEvents: 3, droppedEventCount: 18 })

        const finalizedEvent = snapshot!.events.find(event => event.phase === 'run_finalized')
        expect(finalizedEvent).toBeDefined()

        expect(snapshot!.events.filter(event => event.phase === 'tool_call_started')).toHaveLength(2)
        expect(activeRun.runSnapshotDroppedEventCount).toBe(18)
        expect(snapshot!.status).toBe('complete')
      })
    })
  })

  it('compacts runtime chunk payloads after successful finalization while retaining event metadata', async () => {
    await withTempDataDir(() => {
      const sessionId = `session-${randomUUID()}`
      const runId = `run-${randomUUID()}`
      const activeRun = setUpRun(sessionId, runId)

      recordActiveRunSnapshotEvent(activeRun, {
        phase: 'tool_call_output_available',
        chunk: {
          type: 'tool-output-available',
          toolCallId: 'toolu_success',
          output: { stdout: 'large successful output' },
        },
      })

      finalizeActiveRunSnapshot(
        activeRun,
        { type: 'finish', finishReason: 'stop' },
        {
          modelId: 'gpt-4o-mini',
          diagnostics: {
            emittedEventCount: 1,
            assistantBoundaryCount: 0,
            assistantTextCharCount: 0,
            reasoningTextCharCount: 0,
            toolInputDeltaCharCount: 0,
            toolEventCount: 1,
            otherOutputEventCount: 0,
          },
          profile: {
            enabled: false,
            streamStartedAtMs: 0,
            streamFinishedAtMs: null,
            finalizeStartedAtMs: null,
            finalizeFinishedAtMs: null,
            finalMessageJsonBytes: null,
          },
        },
      )

      const snapshot = getRunSnapshot(runId)
      const toolEvent = snapshot?.events.find(event => event.toolCallId === 'toolu_success')
      expect(snapshot?.status).toBe('complete')
      expect(toolEvent).toEqual(expect.objectContaining({
        phase: 'tool_call_output_available',
        chunkType: 'tool-output-available',
        toolCallId: 'toolu_success',
      }))
      expect(toolEvent?.payload).toEqual(expect.objectContaining({
        schema: COMPACTED_SUCCESS_PAYLOAD_SCHEMA,
        originalLength: expect.any(Number),
        coalescedCount: 1,
      }))
      expect(JSON.stringify(toolEvent?.payload)).not.toContain('large successful output')
    })
  })

  it('retains runtime chunk payloads after failed finalization', async () => {
    await withTempDataDir(() => {
      const sessionId = `session-${randomUUID()}`
      const runId = `run-${randomUUID()}`
      const activeRun = setUpRun(sessionId, runId)

      recordActiveRunSnapshotEvent(activeRun, {
        phase: 'tool_call_output_available',
        chunk: {
          type: 'tool-output-available',
          toolCallId: 'toolu_failed',
          output: { stderr: 'diagnostic output' },
        },
      })
      finalizeActiveRunSnapshot(
        activeRun,
        { type: 'error', errorText: 'provider failed' },
        {
          modelId: 'gpt-4o-mini',
          diagnostics: {
            emittedEventCount: 1,
            assistantBoundaryCount: 0,
            assistantTextCharCount: 0,
            reasoningTextCharCount: 0,
            toolInputDeltaCharCount: 0,
            toolEventCount: 1,
            otherOutputEventCount: 0,
          },
          profile: {
            enabled: false,
            streamStartedAtMs: 0,
            streamFinishedAtMs: null,
            finalizeStartedAtMs: null,
            finalizeFinishedAtMs: null,
            finalMessageJsonBytes: null,
          },
        },
      )

      const snapshot = getRunSnapshot(runId)
      const toolEvent = snapshot?.events.find(event => event.toolCallId === 'toolu_failed')
      expect(snapshot?.status).toBe('failed')
      expect(toolEvent?.payload).toEqual(expect.objectContaining({
        output: { stderr: 'diagnostic output' },
      }))
    })
  })
})

describe('run snapshot maintenance', () => {
  it('uses separate success and failure retention windows without pruning running snapshots', async () => {
    await withTempDataDir(() => {
      const now = Date.UTC(2026, 6, 16)
      const oldCompletedAt = now - 31 * 24 * 60 * 60 * 1000
      const oldFailureAt = now - 8 * 24 * 60 * 60 * 1000

      for (const [suffix, status, completedAt] of [
        ['success', 'complete', oldCompletedAt],
        ['failure', 'failed', oldFailureAt],
        ['running', 'running', null],
      ] as const) {
        const sessionId = `session-${suffix}-${randomUUID()}`
        const runId = `run-${suffix}-${randomUUID()}`
        setUpRun(sessionId, runId)
        db().update(backendRunSnapshots).set({ status, completedAt }).where(eq(backendRunSnapshots.runId, runId)).run()
      }

      const result = maintainRunSnapshots(now)
      expect(result.prunedSnapshots).toBe(2)
      expect(db().select().from(backendRunSnapshots).all()).toEqual([
        expect.objectContaining({ status: 'running' }),
      ])
    })
  })
})

describe('getRunSnapshot / getRunSnapshots read bounds', () => {
  it('reports eventCount and eventsTruncated once the read-side limit is hit', async () => {
    await withTempDataDir(() => {
      withEnv('CRADLE_CHAT_RUN_SNAPSHOT_EVENTS_READ_LIMIT', '5', () => {
        const sessionId = `session-${randomUUID()}`
        const runId = `run-${randomUUID()}`
        const activeRun = setUpRun(sessionId, runId)

        for (let i = 0; i < 10; i += 1) {
          recordActiveRunSnapshotEvent(activeRun, {
            phase: 'tool_call_started',
            chunk: { type: 'tool-input-start', toolCallId: `toolu_${i}`, toolName: 'bash' },
          })
        }

        const snapshot = getRunSnapshot(runId)
        expect(snapshot).not.toBeNull()
        expect(snapshot!.events).toHaveLength(5)
        expect(snapshot!.eventCount).toBeGreaterThanOrEqual(11)
        expect(snapshot!.eventsTruncated).toBe(true)
      })
    })
  })

  it('does not hydrate events when listing snapshots unless includeEvents is requested', async () => {
    await withTempDataDir(() => {
      const sessionId = `session-${randomUUID()}`
      const runId = `run-${randomUUID()}`
      const activeRun = setUpRun(sessionId, runId)
      recordActiveRunSnapshotEvent(activeRun, {
        phase: 'tool_call_started',
        chunk: { type: 'tool-input-start', toolCallId: 'toolu_list', toolName: 'bash' },
      })

      const summaryOnly = getRunSnapshots({ chatSessionId: sessionId })
      expect(summaryOnly).toHaveLength(1)
      expect(summaryOnly[0].events).toEqual([])
      expect(summaryOnly[0].eventCount).toBeGreaterThanOrEqual(2)

      const withEvents = getRunSnapshots({ chatSessionId: sessionId, includeEvents: true })
      expect(withEvents[0].events.length).toBe(withEvents[0].eventCount)
    })
  })
})
