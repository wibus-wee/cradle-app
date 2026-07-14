import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { messages } from '@cradle/db'
import { messages as messageTable, sessions } from '@cradle/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db, shutdownInfra } from '../../../infra'
import { runRegistry } from '../run-registry'
import {
  countProviderTurns,
  rollbackLastTurn,
  rollbackTurns,
  shouldRollbackProviderTurn,
} from './rollback'

const runtimeContextMocks = vi.hoisted(() => ({
  assertStoredSession: vi.fn(),
  attachBinding: vi.fn(),
  buildRuntimeProviderInput: vi.fn(() => ({ sessionId: 'session-1' })),
  resolveRuntimeSessionContext: vi.fn(),
}))
const commitLastTurnRolledBackMock = vi.hoisted(() => vi.fn())
const cancelPendingRuntimeGoalContinuationMock = vi.hoisted(() => vi.fn())

vi.mock('../runtime-session-context', () => runtimeContextMocks)
vi.mock('../es/commands', () => ({
  commitLastTurnRolledBack: commitLastTurnRolledBackMock,
}))
vi.mock('../run/runtime-goal-continuation', () => ({
  cancelPendingRuntimeGoalContinuation: cancelPendingRuntimeGoalContinuationMock,
}))

type MessageRow = typeof messages.$inferSelect

const previousDataDir = process.env.CRADLE_DATA_DIR
const previousDbPath = process.env.CRADLE_DB_PATH
let dataDir: string | null = null

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'cradle-chat-rollback-'))
  process.env.CRADLE_DATA_DIR = dataDir
  delete process.env.CRADLE_DB_PATH
  runRegistry.clearAll()
  vi.clearAllMocks()
  commitLastTurnRolledBackMock.mockResolvedValue(undefined)
})

afterEach(() => {
  runRegistry.clearAll()
  shutdownInfra()
  if (dataDir) {
    rmSync(dataDir, { recursive: true, force: true })
    dataDir = null
  }
  if (previousDataDir === undefined) {
    delete process.env.CRADLE_DATA_DIR
  }
  else {
    process.env.CRADLE_DATA_DIR = previousDataDir
  }
  if (previousDbPath === undefined) {
    delete process.env.CRADLE_DB_PATH
  }
  else {
    process.env.CRADLE_DB_PATH = previousDbPath
  }
})

function message(input: {
  id: string
  role: 'user' | 'assistant'
  status: MessageRow['status']
  content?: string
  parts?: unknown[]
}): MessageRow {
  return {
    id: input.id,
    sessionId: 'session-1',
    parentMessageId: null,
    parentToolCallId: null,
    taskId: null,
    depth: 0,
    role: input.role,
    status: input.status,
    content: input.content ?? '',
    messageJson: JSON.stringify({
      id: input.id,
      role: input.role,
      parts: input.parts ?? [],
    }),
    errorText: null,
    createdAt: 1,
    updatedAt: 1,
  }
}

function seedRollbackTail(): void {
  db().insert(sessions).values({
    id: 'session-1',
    title: 'Rollback test',
    createdAt: 1,
    updatedAt: 1,
  }).run()
  db().insert(messageTable).values([
    message({ id: 'user-1', role: 'user', status: 'complete', content: 'retry' }),
    message({ id: 'assistant-1', role: 'assistant', status: 'complete', content: 'done' }),
  ]).run()
}

function seedRollbackHistory(): void {
  db().insert(sessions).values({
    id: 'session-1',
    title: 'Rollback history test',
    createdAt: 1,
    updatedAt: 1,
  }).run()
  db().insert(messageTable).values([
    message({ id: 'user-1', role: 'user', status: 'complete', content: 'first' }),
    message({ id: 'assistant-1', role: 'assistant', status: 'complete', content: 'first response' }),
    message({ id: 'user-2', role: 'user', status: 'complete', content: 'second' }),
    message({ id: 'assistant-2', role: 'assistant', status: 'failed' }),
    message({ id: 'user-3', role: 'user', status: 'complete', content: 'third' }),
    message({ id: 'assistant-3', role: 'assistant', status: 'complete', content: 'third response' }),
  ]).run()
}

function setResolvedRuntime(input: {
  supportsRollback?: boolean
  rollbackLastTurn?: ReturnType<typeof vi.fn>
} = {}) {
  const providerRollback = input.rollbackLastTurn ?? vi.fn().mockResolvedValue({
    runtimeKind: 'standard',
    providerSessionId: 'provider-session-1',
    rolledBackTurns: 1,
    fileChangesReverted: false,
  })
  runtimeContextMocks.resolveRuntimeSessionContext.mockResolvedValue({
    context: { providerTarget: { id: 'target-1' } },
    runtimeKind: 'standard',
    runtime: {
      capabilities: { supportsLastTurnRollback: input.supportsRollback ?? true },
      rollbackLastTurn: providerRollback,
    },
    runtimeSession: {
      runtimeKind: 'standard',
      providerSessionId: 'provider-session-1',
    },
    modelId: undefined,
  })
  return providerRollback
}

describe('shouldRollbackProviderTurn', () => {
  it('skips provider rollback for an empty failed assistant placeholder', () => {
    expect(shouldRollbackProviderTurn([
      message({ id: 'user-1', role: 'user', status: 'complete', content: 'retry' }),
      message({ id: 'assistant-1', role: 'assistant', status: 'failed' }),
    ])).toBe(false)
  })

  it('requires provider rollback when the failed assistant has projected content', () => {
    expect(shouldRollbackProviderTurn([
      message({ id: 'user-1', role: 'user', status: 'complete', content: 'retry' }),
      message({
        id: 'assistant-1',
        role: 'assistant',
        status: 'failed',
        content: 'partial',
        parts: [{ type: 'text', text: 'partial' }],
      }),
    ])).toBe(true)
  })

  it('requires provider rollback for completed assistant turns', () => {
    expect(shouldRollbackProviderTurn([
      message({ id: 'user-1', role: 'user', status: 'complete', content: 'retry' }),
      message({ id: 'assistant-1', role: 'assistant', status: 'complete' }),
    ])).toBe(true)
  })
})

describe('countProviderTurns', () => {
  it('excludes empty failed assistant placeholders from the provider count', () => {
    expect(countProviderTurns([
      message({ id: 'user-1', role: 'user', status: 'complete' }),
      message({ id: 'assistant-1', role: 'assistant', status: 'failed' }),
      message({ id: 'user-2', role: 'user', status: 'complete' }),
      message({ id: 'assistant-2', role: 'assistant', status: 'complete' }),
    ])).toBe(1)
  })
})

describe('rollbackLastTurn coordination', () => {
  it('rejects a busy session before invoking the destructive callback', async () => {
    const beforeProviderRollback = vi.fn()
    runRegistry.setPendingRun('session-1', { cancelled: false })

    await expect(rollbackLastTurn('session-1', {
      finalizeInterruptedPersistedStreamingSessionIfIdle: async () => {},
      scheduleSessionQueueDrain: () => {},
    }, { beforeProviderRollback })).rejects.toMatchObject({
      code: 'chat_rollback_run_in_progress',
      status: 409,
    })

    expect(beforeProviderRollback).not.toHaveBeenCalled()
  })

  it('validates provider rollback support before invoking the destructive callback', async () => {
    seedRollbackTail()
    setResolvedRuntime({ supportsRollback: false })
    const beforeProviderRollback = vi.fn()

    await expect(rollbackLastTurn('session-1', {
      finalizeInterruptedPersistedStreamingSessionIfIdle: async () => {},
      scheduleSessionQueueDrain: () => {},
    }, { beforeProviderRollback })).rejects.toMatchObject({
      code: 'chat_rollback_not_supported',
      status: 501,
    })

    expect(beforeProviderRollback).not.toHaveBeenCalled()
    expect(runRegistry.hasSessionMaintenance('session-1')).toBe(false)
  })

  it('runs the destructive callback before provider and transcript rollback', async () => {
    seedRollbackTail()
    const order: string[] = []
    const providerRollback = setResolvedRuntime({
      rollbackLastTurn: vi.fn(async () => {
        order.push('provider')
        return {
          runtimeKind: 'standard',
          providerSessionId: 'provider-session-1',
          rolledBackTurns: 1,
          fileChangesReverted: false as const,
        }
      }),
    })
    commitLastTurnRolledBackMock.mockImplementation(async () => {
      order.push('transcript')
    })

    await rollbackLastTurn('session-1', {
      finalizeInterruptedPersistedStreamingSessionIfIdle: async () => {},
      scheduleSessionQueueDrain: () => {},
    }, {
      beforeProviderRollback: async () => {
        order.push('filesystem')
      },
      afterRollback: async () => {
        order.push('cleanup')
      },
    })

    expect(order).toEqual(['filesystem', 'provider', 'transcript', 'cleanup'])
    expect(providerRollback).toHaveBeenCalledOnce()
    expect(runRegistry.hasSessionMaintenance('session-1')).toBe(false)
  })

  it('rolls back multiple transcript turns while passing only native provider turns', async () => {
    seedRollbackHistory()
    const providerRollback = setResolvedRuntime({
      rollbackLastTurn: vi.fn().mockResolvedValue({
        runtimeKind: 'standard',
        providerSessionId: 'provider-session-1',
        rolledBackTurns: 1,
        fileChangesReverted: false,
      }),
    })

    const result = await rollbackTurns('session-1', 2, {
      finalizeInterruptedPersistedStreamingSessionIfIdle: async () => {},
      scheduleSessionQueueDrain: () => {},
    })

    expect(result.messageIds).toEqual(['user-2', 'assistant-2', 'user-3', 'assistant-3'])
    expect(providerRollback).toHaveBeenCalledWith({ sessionId: 'session-1', numTurns: 1 })
    expect(commitLastTurnRolledBackMock).toHaveBeenCalledWith(expect.objectContaining({
      messageIds: ['user-2', 'assistant-2', 'user-3', 'assistant-3'],
      providerRolledBackTurns: 1,
    }))
  })

  it('rejects a turn count larger than the transcript before the destructive callback', async () => {
    seedRollbackTail()
    const beforeProviderRollback = vi.fn()

    await expect(rollbackTurns('session-1', 2, {
      finalizeInterruptedPersistedStreamingSessionIfIdle: async () => {},
      scheduleSessionQueueDrain: () => {},
    }, { beforeProviderRollback })).rejects.toMatchObject({
      code: 'chat_rollback_turn_count_out_of_range',
      status: 409,
    })

    expect(beforeProviderRollback).not.toHaveBeenCalled()
  })

  it('releases the maintenance claim when the destructive callback fails', async () => {
    seedRollbackTail()
    const providerRollback = setResolvedRuntime()

    await expect(rollbackLastTurn('session-1', {
      finalizeInterruptedPersistedStreamingSessionIfIdle: async () => {},
      scheduleSessionQueueDrain: () => {},
    }, {
      beforeProviderRollback: async () => {
        throw new Error('filesystem restore failed')
      },
    })).rejects.toThrow('filesystem restore failed')

    expect(providerRollback).not.toHaveBeenCalled()
    expect(commitLastTurnRolledBackMock).not.toHaveBeenCalled()
    expect(cancelPendingRuntimeGoalContinuationMock).not.toHaveBeenCalled()
    expect(runRegistry.hasSessionMaintenance('session-1')).toBe(false)
  })
})
