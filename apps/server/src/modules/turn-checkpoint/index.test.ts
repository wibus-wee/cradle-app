import { Elysia } from 'elysia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { turnCheckpoint } from './index'

const chatRuntimeMock = vi.hoisted(() => ({
  rollbackLastTurn: vi.fn(),
  rollbackTurns: vi.fn(),
}))
const turnCheckpointServiceMock = vi.hoisted(() => ({
  cleanupHistoricalRewind: vi.fn(),
  listForSession: vi.fn(() => []),
  planHistoricalRewind: vi.fn(),
  restoreHistoricalCheckpoint: vi.fn(),
  restoreWorkspaceStart: vi.fn(),
}))

vi.mock('../chat-runtime/runtime', () => chatRuntimeMock)
vi.mock('./service', () => turnCheckpointServiceMock)

const checkpoint = {
  id: 'checkpoint-1',
  sessionId: 'session-1',
  runId: 'run-1',
  assistantMessageId: 'assistant-1',
  workspaceId: 'workspace-1',
  workspacePath: '/tmp/workspace-1',
  startRef: 'refs/cradle/checkpoints/session/run/start',
  endRef: 'refs/cradle/checkpoints/session/run/end',
  status: 'completed' as const,
  changedFiles: 1,
  additions: 1,
  deletions: 0,
  errorText: null,
  completedAt: 2,
  restoredAt: 3,
  createdAt: 1,
  updatedAt: 3,
}

function app() {
  return new Elysia().use(turnCheckpoint)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('turn checkpoint restore route', () => {
  it('does not restore the workspace when Chat Runtime rejects preflight', async () => {
    chatRuntimeMock.rollbackLastTurn.mockRejectedValue(Object.assign(new Error('busy'), {
      code: 'chat_rollback_run_in_progress',
      status: 409,
    }))

    await app().handle(new Request(
      'http://localhost/sessions/session-1/turn-checkpoints/checkpoint-1/restore',
      { method: 'POST' },
    ))

    expect(turnCheckpointServiceMock.restoreWorkspaceStart).not.toHaveBeenCalled()
  })

  it('restores inside the rollback window and returns the coordinated result', async () => {
    turnCheckpointServiceMock.restoreWorkspaceStart.mockResolvedValue(checkpoint)
    chatRuntimeMock.rollbackLastTurn.mockImplementation(async (
      _sessionId: string,
      options: { beforeProviderRollback?: () => Promise<void> },
    ) => {
      await options.beforeProviderRollback?.()
      return { providerRolledBackTurns: 1 }
    })

    const response = await app().handle(new Request(
      'http://localhost/sessions/session-1/turn-checkpoints/checkpoint-1/restore',
      { method: 'POST' },
    ))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      checkpoint: { id: 'checkpoint-1' },
      transcriptReverted: true,
      providerRolledBackTurns: 1,
    })
    expect(turnCheckpointServiceMock.restoreWorkspaceStart).toHaveBeenCalledWith({
      sessionId: 'session-1',
      checkpointId: 'checkpoint-1',
    })
  })
})

describe('turn checkpoint rewind route', () => {
  const subsequentCheckpointIds = ['checkpoint-3', 'checkpoint-2']

  beforeEach(() => {
    turnCheckpointServiceMock.planHistoricalRewind.mockReturnValue({
      checkpoint,
      rollbackTurns: 2,
      subsequentCheckpoints: subsequentCheckpointIds.map(id => ({ ...checkpoint, id })),
    })
  })

  it('does not restore the workspace when Chat Runtime rejects preflight', async () => {
    chatRuntimeMock.rollbackTurns.mockRejectedValue(Object.assign(new Error('busy'), {
      code: 'chat_rollback_run_in_progress',
      status: 409,
    }))

    await app().handle(new Request(
      'http://localhost/sessions/session-1/turn-checkpoints/checkpoint-1/rewind',
      { method: 'POST' },
    ))

    expect(turnCheckpointServiceMock.restoreHistoricalCheckpoint).not.toHaveBeenCalled()
    expect(turnCheckpointServiceMock.cleanupHistoricalRewind).not.toHaveBeenCalled()
  })

  it('restores the end state, rolls back multiple turns, and cleans later checkpoints', async () => {
    const order: string[] = []
    turnCheckpointServiceMock.restoreHistoricalCheckpoint.mockImplementation(async () => {
      order.push('filesystem')
      return checkpoint
    })
    turnCheckpointServiceMock.cleanupHistoricalRewind.mockImplementation(async () => {
      order.push('cleanup')
    })
    chatRuntimeMock.rollbackTurns.mockImplementation(async (
      _sessionId: string,
      _numTurns: number,
      options: {
        beforeProviderRollback?: () => Promise<void>
        afterRollback?: () => Promise<void>
      },
    ) => {
      await options.beforeProviderRollback?.()
      order.push('provider-and-transcript')
      await options.afterRollback?.()
      return { providerRolledBackTurns: 2 }
    })

    const response = await app().handle(new Request(
      'http://localhost/sessions/session-1/turn-checkpoints/checkpoint-1/rewind',
      { method: 'POST' },
    ))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      checkpoint: { id: 'checkpoint-1' },
      transcriptReverted: true,
      rewoundTurns: 2,
      providerRolledBackTurns: 2,
      removedCheckpointIds: subsequentCheckpointIds,
    })
    expect(order).toEqual(['filesystem', 'provider-and-transcript', 'cleanup'])
    expect(chatRuntimeMock.rollbackTurns).toHaveBeenCalledWith('session-1', 2, expect.any(Object))
    expect(turnCheckpointServiceMock.restoreHistoricalCheckpoint).toHaveBeenCalledWith({
      sessionId: 'session-1',
      checkpointId: 'checkpoint-1',
      expectedSubsequentCheckpointIds: subsequentCheckpointIds,
    })
    expect(turnCheckpointServiceMock.cleanupHistoricalRewind).toHaveBeenCalledWith({
      sessionId: 'session-1',
      checkpointId: 'checkpoint-1',
      subsequentCheckpointIds,
    })
  })
})
