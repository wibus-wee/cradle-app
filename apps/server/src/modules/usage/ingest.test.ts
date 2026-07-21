import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { backendSessionBindings, sessions, usageLogs } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { db, shutdownInfra } from '../../infra'
import { recordRuntimeUsageEvent, replaceLegacyRuntimeUsage } from './ingest'

const previousDataDir = process.env.CRADLE_DATA_DIR
let dataDir = ''

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'cradle-usage-ingest-'))
  process.env.CRADLE_DATA_DIR = dataDir
})

afterEach(() => {
  shutdownInfra()
  rmSync(dataDir, { recursive: true, force: true })
  if (previousDataDir === undefined) {
    delete process.env.CRADLE_DATA_DIR
  }
  else {
    process.env.CRADLE_DATA_DIR = previousDataDir
  }
})

describe('recordRuntimeUsageEvent', () => {
  it('persists a complete provider event exactly once', () => {
    db().insert(sessions).values({ id: 'session-1', title: 'Session', runtimeKind: 'codex' }).run()
    const input = {
      event: {
        id: 'event-1',
        providerThreadId: 'thread-1',
        providerTurnId: 'turn-1',
        modelId: 'gpt-5.6-sol',
        occurredAt: 1_789_000_000,
        usage: {
          promptTokens: 200,
          cachedInputTokens: 180,
          completionTokens: 30,
          reasoningOutputTokens: 10,
          totalTokens: 230,
        },
        providerTotal: {
          promptTokens: 500,
          cachedInputTokens: 400,
          completionTokens: 50,
          reasoningOutputTokens: 20,
          totalTokens: 550,
        },
      },
      sessionId: 'session-1',
      runId: 'run-1',
      messageId: null,
      providerTargetId: null,
      providerSessionId: 'root-thread',
    }

    expect(recordRuntimeUsageEvent(input)).toBe('inserted')
    expect(recordRuntimeUsageEvent(input)).toBe('duplicate')
    expect(db().select().from(usageLogs).where(eq(usageLogs.id, 'event-1')).all()).toEqual([expect.objectContaining({
      runId: 'run-1',
      sessionId: 'session-1',
      providerSessionId: 'root-thread',
      providerThreadId: 'thread-1',
      providerTurnId: 'turn-1',
      modelId: 'gpt-5.6-sol',
      promptTokens: 200,
      cachedInputTokens: 180,
      completionTokens: 30,
      reasoningOutputTokens: 10,
      totalTokens: 230,
      providerTotalPromptTokens: 500,
      providerTotalTokens: 550,
      createdAt: 1_789_000_000,
    })])
  })

  it('rejects missing required provider identity', () => {
    expect(() => recordRuntimeUsageEvent({
      event: {
        id: 'event-1',
        providerThreadId: 'thread-1',
        providerTurnId: '',
        modelId: 'gpt-5.6-sol',
        occurredAt: 1,
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        providerTotal: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      },
      sessionId: 'session-1',
      runId: null,
      messageId: null,
      providerTargetId: null,
      providerSessionId: 'root-thread',
    })).toThrow('providerTurnId')
  })

  it('replaces a partial usage snapshot when the same model call is finalized', () => {
    db().insert(sessions).values({ id: 'session-1', title: 'Session', runtimeKind: 'claude-agent' }).run()
    const input = {
      event: {
        id: 'event-1',
        providerThreadId: 'thread-1',
        providerTurnId: 'turn-1',
        modelId: 'claude-opus-4-8',
        occurredAt: 1_789_000_000,
        usage: { promptTokens: 811, completionTokens: 0, totalTokens: 811 },
        providerTotal: { promptTokens: 811, completionTokens: 0, totalTokens: 811 },
      },
      sessionId: 'session-1',
      runId: 'run-1',
      messageId: null,
      providerTargetId: null,
      providerSessionId: 'claude-session-1',
    }

    expect(recordRuntimeUsageEvent(input)).toBe('inserted')
    expect(recordRuntimeUsageEvent({
      ...input,
      event: {
        ...input.event,
        usage: { promptTokens: 811, completionTokens: 200, totalTokens: 1_011 },
        providerTotal: { promptTokens: 811, completionTokens: 200, totalTokens: 1_011 },
      },
    })).toBe('duplicate')

    expect(db().select().from(usageLogs).where(eq(usageLogs.id, 'event-1')).get()).toEqual(
      expect.objectContaining({ promptTokens: 811, completionTokens: 200, totalTokens: 1_011 }),
    )
  })

  it('atomically replaces only legacy Codex summary rows after a verified session replay', () => {
    db().insert(sessions).values({ id: 'session-1', title: 'Session', runtimeKind: 'codex' }).run()
    db().insert(backendSessionBindings).values({
      id: 'binding-1',
      chatSessionId: 'session-1',
      runtimeKind: 'codex',
    }).run()
    db().insert(usageLogs).values({
      id: 'legacy-summary',
      sessionId: 'session-1',
      modelId: 'gpt-5.6-sol',
      promptTokens: 90,
      completionTokens: 10,
      totalTokens: 100,
      createdAt: 1_700_000_000,
    }).run()

    const result = replaceLegacyRuntimeUsage({
      sessionId: 'session-1',
      runtimeKind: 'codex',
      events: [{
        event: {
          id: 'event-1',
          providerThreadId: 'thread-1',
          providerTurnId: 'turn-1',
          modelId: 'gpt-5.6-sol',
          occurredAt: 1_789_000_000,
          usage: { promptTokens: 200, completionTokens: 30, totalTokens: 230 },
          providerTotal: { promptTokens: 200, completionTokens: 30, totalTokens: 230 },
        },
        sessionId: 'session-1',
        runId: null,
        messageId: null,
        providerTargetId: null,
        providerSessionId: 'thread-1',
      }],
    })

    expect(result).toEqual({ inserted: 1, duplicates: 0 })
    expect(db().select().from(usageLogs).all()).toEqual([
      expect.objectContaining({ id: 'event-1', providerThreadId: 'thread-1' }),
    ])
  })
})
