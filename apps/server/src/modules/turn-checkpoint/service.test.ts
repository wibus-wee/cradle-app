import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sessions, turnCheckpoints } from '@cradle/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { db, shutdownInfra } from '../../infra'
import {
  cleanupHistoricalRewind,
  listForSession,
  planHistoricalRewind,
  restoreHistoricalCheckpoint,
} from './service'

const gitStoreMocks = vi.hoisted(() => ({
  captureCheckpoint: vi.fn(),
  deleteCheckpointRefs: vi.fn(),
  isGitWorkspace: vi.fn(),
  restoreCheckpoint: vi.fn(),
  summarizeCheckpointDiff: vi.fn(),
}))

vi.mock('./git-store', () => gitStoreMocks)

const previousDataDir = process.env.CRADLE_DATA_DIR
const previousDbPath = process.env.CRADLE_DB_PATH
let dataDir: string | null = null

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'cradle-turn-checkpoint-service-'))
  process.env.CRADLE_DATA_DIR = dataDir
  delete process.env.CRADLE_DB_PATH
  vi.clearAllMocks()
  gitStoreMocks.restoreCheckpoint.mockResolvedValue(true)
  gitStoreMocks.deleteCheckpointRefs.mockResolvedValue(undefined)
  db().insert(sessions).values({
    id: 'session-1',
    title: 'Checkpoint rewind test',
    createdAt: 1,
    updatedAt: 1,
  }).run()
})

afterEach(() => {
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

function seedCheckpoint(id: string, runId: string): void {
  db().insert(turnCheckpoints).values({
    id,
    sessionId: 'session-1',
    runId,
    assistantMessageId: `assistant-${runId}`,
    workspaceId: null,
    workspacePath: '/tmp/workspace',
    startRef: `refs/cradle/checkpoints/session/${runId}/start`,
    endRef: `refs/cradle/checkpoints/session/${runId}/end`,
    status: 'completed',
    completedAt: 1,
    createdAt: 1,
    updatedAt: 1,
  }).run()
}

function seedHistory(): void {
  seedCheckpoint('checkpoint-1', 'run-1')
  seedCheckpoint('checkpoint-2', 'run-2')
  seedCheckpoint('checkpoint-3', 'run-3')
}

describe('historical checkpoint rewind', () => {
  it('uses insertion order when checkpoint timestamps are equal', () => {
    seedHistory()

    expect(listForSession('session-1').map(checkpoint => checkpoint.id)).toEqual([
      'checkpoint-3',
      'checkpoint-2',
      'checkpoint-1',
    ])
    expect(planHistoricalRewind({
      sessionId: 'session-1',
      checkpointId: 'checkpoint-1',
    })).toMatchObject({
      checkpoint: { id: 'checkpoint-1' },
      rollbackTurns: 2,
      subsequentCheckpoints: [{ id: 'checkpoint-3' }, { id: 'checkpoint-2' }],
    })
  })

  it('rejects the latest checkpoint because rewinding to it would be a no-op', () => {
    seedHistory()

    expect(() => planHistoricalRewind({
      sessionId: 'session-1',
      checkpointId: 'checkpoint-3',
    })).toThrow(expect.objectContaining({
      code: 'turn_checkpoint_rewind_no_later_turns',
      status: 409,
    }))
  })

  it('restores the target end ref after revalidating the planned history', async () => {
    seedHistory()

    await expect(restoreHistoricalCheckpoint({
      sessionId: 'session-1',
      checkpointId: 'checkpoint-1',
      expectedSubsequentCheckpointIds: ['checkpoint-3', 'checkpoint-2'],
    })).resolves.toMatchObject({ id: 'checkpoint-1' })

    expect(gitStoreMocks.restoreCheckpoint).toHaveBeenCalledWith(
      '/tmp/workspace',
      'refs/cradle/checkpoints/session/run-1/end',
    )
  })

  it('deletes only checkpoints after the rewind target', async () => {
    seedHistory()

    await cleanupHistoricalRewind({
      sessionId: 'session-1',
      checkpointId: 'checkpoint-1',
      subsequentCheckpointIds: ['checkpoint-3', 'checkpoint-2'],
    })

    expect(gitStoreMocks.deleteCheckpointRefs).toHaveBeenCalledWith('/tmp/workspace', [
      'refs/cradle/checkpoints/session/run-3/start',
      'refs/cradle/checkpoints/session/run-3/end',
      'refs/cradle/checkpoints/session/run-2/start',
      'refs/cradle/checkpoints/session/run-2/end',
    ])
    expect(listForSession('session-1').map(checkpoint => checkpoint.id)).toEqual(['checkpoint-1'])
  })
})
