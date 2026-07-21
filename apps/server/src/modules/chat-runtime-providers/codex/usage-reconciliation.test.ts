import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { backendSessionBindings, sessions, usageLogs } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db, shutdownInfra } from '../../../infra'
import { recordRuntimeUsageEvent } from '../../usage/ingest'
import type { CodexAppServerClientLike } from './types'
import { createCodexRuntimeUsageEvent } from './usage-event-projector'
import {
  reconcileCodexSessionUsage,
  reconcileCradleCodexUsage,
} from './usage-reconciliation'

const previousDataDir = process.env.CRADLE_DATA_DIR
let dataDir = ''
let runtimeHome = ''

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'cradle-codex-usage-reconciliation-'))
  runtimeHome = join(dataDir, 'runtimes', 'codex-app-server')
  mkdirSync(runtimeHome, { recursive: true })
  process.env.CRADLE_DATA_DIR = dataDir
  db().insert(sessions).values({ id: 'session-1', title: 'Session', runtimeKind: 'codex' }).run()
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

describe('codex usage reconciliation', () => {
  it('uses the live event identity and remains idempotent', async () => {
    const rolloutPath = writeRollout('root.jsonl', [
      sessionMeta('root-thread'),
      turnContext('turn-1', 'gpt-5.6-sol'),
      tokenCount('2026-07-15T10:00:02.000Z', usage(100, 10), usage(100, 10)),
    ])
    const event = createCodexRuntimeUsageEvent({
      threadId: 'root-thread',
      turnId: 'turn-1',
      modelId: 'gpt-5.6-sol',
      occurredAt: 1_789_000_000,
      last: protocolUsage(100, 10),
      total: protocolUsage(100, 10),
    })
    recordRuntimeUsageEvent({
      event,
      sessionId: 'session-1',
      runId: 'run-1',
      messageId: null,
      providerTargetId: null,
      providerSessionId: 'root-thread',
    })

    const result = await reconcileCodexSessionUsage({
      client: fakeClient(rootThread('root-thread', rolloutPath)),
      sessionId: 'session-1',
      providerSessionId: 'root-thread',
      providerTargetId: null,
      runtimeHome,
    })

    expect(result).toMatchObject({ inserted: 0, duplicates: 1, incidents: 0 })
    expect(db().select().from(usageLogs).all()).toHaveLength(1)
    expect(db().select().from(usageLogs).get()?.runId).toBe('run-1')
  })

  it('recovers root, direct child, and nested child calls with exact models', async () => {
    const rootPath = writeRollout('root.jsonl', [
      sessionMeta('root-thread'),
      turnContext('root-turn', 'gpt-5.6-sol'),
      tokenCount('2026-07-15T10:00:02.000Z', usage(100, 10), usage(100, 10)),
    ])
    const childPath = writeRollout('child.jsonl', [
      sessionMeta('child-thread'),
      turnContext('child-turn', 'gpt-5.6-mini'),
      tokenCount('2026-07-15T10:00:03.000Z', usage(50, 5), usage(50, 5)),
    ])
    const nestedPath = writeRollout('nested.jsonl', [
      sessionMeta('nested-thread'),
      turnContext('nested-turn', 'gpt-5.6-nano'),
      tokenCount('2026-07-15T10:00:04.000Z', usage(20, 2), usage(20, 2)),
    ])
    const client = fakeClient(
      rootThread('root-thread', rootPath),
      [
        childThread('child-thread', 'root-thread', childPath),
        childThread('nested-thread', 'child-thread', nestedPath),
      ],
    )

    const first = await reconcileCodexSessionUsage({
      client,
      sessionId: 'session-1',
      providerSessionId: 'root-thread',
      providerTargetId: null,
      runtimeHome,
    })
    const second = await reconcileCodexSessionUsage({
      client,
      sessionId: 'session-1',
      providerSessionId: 'root-thread',
      providerTargetId: null,
      runtimeHome,
    })

    expect(first).toMatchObject({ threads: 3, inserted: 3, incidents: 0 })
    expect(second).toMatchObject({ inserted: 0, duplicates: 3, incidents: 0 })
    expect(db().select().from(usageLogs).all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerThreadId: 'root-thread', modelId: 'gpt-5.6-sol' }),
      expect.objectContaining({ providerThreadId: 'child-thread', modelId: 'gpt-5.6-mini' }),
      expect.objectContaining({ providerThreadId: 'nested-thread', modelId: 'gpt-5.6-nano' }),
    ]))
  })

  it('uses a later exact turn context as a persisted model reroute', async () => {
    const rolloutPath = writeRollout('rerouted.jsonl', [
      sessionMeta('root-thread'),
      turnContext('turn-1', 'gpt-5.6-sol'),
      modelReroute('gpt-5.6-sol', 'gpt-5.6-mini'),
      tokenCount('2026-07-15T10:00:02.000Z', usage(100, 10), usage(100, 10)),
    ])

    const result = await reconcileCodexSessionUsage({
      client: fakeClient(rootThread('root-thread', rolloutPath)),
      sessionId: 'session-1',
      providerSessionId: 'root-thread',
      providerTargetId: null,
      runtimeHome,
    })

    expect(result.incidents).toBe(0)
    expect(db().select().from(usageLogs).get()?.modelId).toBe('gpt-5.6-mini')
  })

  it('reports malformed and ambiguous records without creating unknown usage', async () => {
    const rolloutPath = writeRollout('malformed.jsonl', [
      sessionMeta('root-thread'),
      JSON.stringify({ type: 'turn_context', timestamp: '2026-07-15T10:00:01.000Z', payload: { turn_id: 'turn-1' } }),
      tokenCount('2026-07-15T10:00:02.000Z', usage(100, 10), usage(100, 10)),
      '{"type":"event_msg"',
    ], true)
    const incidents = vi.fn()

    const result = await reconcileCodexSessionUsage({
      client: fakeClient(rootThread('root-thread', rolloutPath)),
      sessionId: 'session-1',
      providerSessionId: 'root-thread',
      providerTargetId: null,
      runtimeHome,
      recordIncident: incidents,
    })

    expect(result.incidents).toBe(3)
    expect(incidents).toHaveBeenCalledTimes(3)
    expect(db().select().from(usageLogs).all()).toHaveLength(0)
  })

  it('rejects rollout paths outside the Cradle runtime home', async () => {
    const outsidePath = join(dataDir, 'outside.jsonl')
    writeFileSync(outsidePath, `${sessionMeta('root-thread')}\n`)
    const incidents = vi.fn()

    const result = await reconcileCodexSessionUsage({
      client: fakeClient(rootThread('root-thread', outsidePath)),
      sessionId: 'session-1',
      providerSessionId: 'root-thread',
      providerTargetId: null,
      runtimeHome,
      recordIncident: incidents,
    })

    expect(result).toMatchObject({ inserted: 0, incidents: 1 })
    expect(incidents).toHaveBeenCalledWith(expect.objectContaining({ reason: expect.stringContaining('outside') }))
  })

  it('starts only from Codex backend bindings', async () => {
    const rolloutPath = writeRollout('root.jsonl', [
      sessionMeta('root-thread'),
      turnContext('turn-1', 'gpt-5.6-sol'),
      tokenCount('2026-07-15T10:00:02.000Z', usage(100, 10), usage(100, 10)),
    ])
    db().insert(sessions).values({ id: 'session-2', title: 'Other', runtimeKind: 'standard' }).run()
    db().insert(backendSessionBindings).values([
      {
        id: 'binding-codex',
        chatSessionId: 'session-1',
        runtimeKind: 'codex',
        backendSessionId: 'root-thread',
      },
      {
        id: 'binding-standard',
        chatSessionId: 'session-2',
        runtimeKind: 'standard',
        backendSessionId: 'other-thread',
      },
    ]).run()
    const client = fakeClient(rootThread('root-thread', rolloutPath))

    const result = await reconcileCradleCodexUsage({
      createClient: () => client,
      runtimeHome,
    })

    expect(result).toMatchObject({ bindings: 1, inserted: 1, incidents: 0 })
    expect(client.request).not.toHaveBeenCalledWith('thread/read', expect.objectContaining({ threadId: 'other-thread' }))
    expect(db().select().from(backendSessionBindings).where(eq(backendSessionBindings.id, 'binding-codex')).get()).toEqual(
      expect.objectContaining({ usageReconciliationStatus: 'completed' }),
    )
  })

  it('keeps legacy usage and blocks only the ambiguous Cradle binding', async () => {
    const rolloutPath = writeRollout('ambiguous.jsonl', [
      sessionMeta('root-thread'),
      JSON.stringify({ type: 'turn_context', timestamp: '2026-07-15T10:00:01.000Z', payload: { turn_id: 'turn-1' } }),
      tokenCount('2026-07-15T10:00:02.000Z', usage(100, 10), usage(100, 10)),
    ])
    db().insert(backendSessionBindings).values({
      id: 'binding-codex',
      chatSessionId: 'session-1',
      runtimeKind: 'codex',
      backendSessionId: 'root-thread',
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

    const result = await reconcileCradleCodexUsage({
      createClient: () => fakeClient(rootThread('root-thread', rolloutPath)),
      runtimeHome,
    })

    expect(result).toMatchObject({ bindings: 1, inserted: 0, incidents: 2 })
    expect(db().select().from(usageLogs).all()).toEqual([
      expect.objectContaining({ id: 'legacy-summary', providerThreadId: null }),
    ])
    expect(db().select().from(backendSessionBindings).where(eq(backendSessionBindings.id, 'binding-codex')).get()).toEqual(
      expect.objectContaining({ usageReconciliationStatus: 'blocked' }),
    )
  })

  it('keeps legacy usage when the rollout has no authoritative usage events', async () => {
    const rolloutPath = writeRollout('empty.jsonl', [sessionMeta('root-thread')])
    db().insert(backendSessionBindings).values({
      id: 'binding-codex',
      chatSessionId: 'session-1',
      runtimeKind: 'codex',
      backendSessionId: 'root-thread',
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

    const result = await reconcileCradleCodexUsage({
      createClient: () => fakeClient(rootThread('root-thread', rolloutPath)),
      runtimeHome,
    })

    expect(result).toMatchObject({ bindings: 1, inserted: 0, incidents: 1 })
    expect(db().select().from(usageLogs).all()).toEqual([
      expect.objectContaining({ id: 'legacy-summary', providerThreadId: null }),
    ])
    expect(db().select().from(backendSessionBindings).where(eq(backendSessionBindings.id, 'binding-codex')).get()).toEqual(
      expect.objectContaining({ usageReconciliationStatus: 'blocked' }),
    )
  })
})

function fakeClient(root: Record<string, unknown>, descendants: Array<Record<string, unknown>> = []): CodexAppServerClientLike {
  return {
    pid: null,
    initialize: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    nextNotification: vi.fn(async () => null),
    request: vi.fn(async (method: string, params?: unknown) => {
      if (method === 'thread/read') {
        return { thread: root }
      }
      if (method === 'thread/list') {
        const archived = (params as { archived?: boolean }).archived
        return { data: archived ? [] : descendants, nextCursor: null, backwardsCursor: null }
      }
      throw new Error(`Unexpected method: ${method}`)
    }),
  }
}

function rootThread(id: string, path: string): Record<string, unknown> {
  return { id, path, parentThreadId: null, ephemeral: false }
}

function childThread(id: string, parentThreadId: string, path: string): Record<string, unknown> {
  return { id, path, parentThreadId, ephemeral: false }
}

function writeRollout(name: string, lines: string[], preserveMalformedTail = false): string {
  const path = join(runtimeHome, name)
  writeFileSync(path, `${lines.join('\n')}${preserveMalformedTail ? '' : '\n'}`)
  return path
}

function sessionMeta(threadId: string): string {
  return JSON.stringify({
    timestamp: '2026-07-15T10:00:00.000Z',
    type: 'session_meta',
    payload: { id: threadId, source: 'appServer' },
  })
}

function turnContext(turnId: string, model: string): string {
  return JSON.stringify({
    timestamp: '2026-07-15T10:00:01.000Z',
    type: 'turn_context',
    payload: { turn_id: turnId, model },
  })
}

function tokenCount(timestamp: string, total: Record<string, number>, last: Record<string, number>): string {
  return JSON.stringify({
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: { total_token_usage: total, last_token_usage: last },
    },
  })
}

function modelReroute(fromModel: string, toModel: string): string {
  return JSON.stringify({
    timestamp: '2026-07-15T10:00:01.500Z',
    type: 'event_msg',
    payload: {
      type: 'model_reroute',
      from_model: fromModel,
      to_model: toModel,
      reason: 'high_risk_cyber_activity',
    },
  })
}

function usage(inputTokens: number, outputTokens: number): Record<string, number> {
  return {
    input_tokens: inputTokens,
    cached_input_tokens: Math.floor(inputTokens / 2),
    output_tokens: outputTokens,
    reasoning_output_tokens: Math.floor(outputTokens / 2),
    total_tokens: inputTokens + outputTokens,
  }
}

function protocolUsage(inputTokens: number, outputTokens: number) {
  return {
    inputTokens,
    cachedInputTokens: Math.floor(inputTokens / 2),
    outputTokens,
    reasoningOutputTokens: Math.floor(outputTokens / 2),
    totalTokens: inputTokens + outputTokens,
  }
}
