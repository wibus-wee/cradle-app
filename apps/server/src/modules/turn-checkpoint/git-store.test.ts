import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  captureCheckpoint,
  deleteCheckpointRefs,
  restoreCheckpoint,
  summarizeCheckpointDiff,
} from './git-store'

let repositoryPath: string | null = null

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repositoryPath!, encoding: 'utf8' }).trim()
}

afterEach(() => {
  if (repositoryPath) {
    rmSync(repositoryPath, { recursive: true, force: true })
    repositoryPath = null
  }
})

describe('turn checkpoint git store', () => {
  it('captures the complete working tree without changing the real index and restores it later', async () => {
    repositoryPath = mkdtempSync(join(tmpdir(), 'cradle-turn-checkpoint-'))
    git('init')
    git('config', 'user.name', 'Cradle Test')
    git('config', 'user.email', 'cradle@example.com')
    git('config', 'commit.gpgsign', 'false')
    writeFileSync(join(repositoryPath, 'tracked.txt'), 'base\n')
    git('add', 'tracked.txt')
    git('commit', '-m', 'base')

    writeFileSync(join(repositoryPath, 'tracked.txt'), 'turn start\n')
    git('add', 'tracked.txt')
    writeFileSync(join(repositoryPath, 'start-only.txt'), 'start\n')
    const stagedBeforeCapture = git('diff', '--cached', '--name-only')

    await captureCheckpoint(repositoryPath, 'refs/cradle/checkpoints/test/start')
    expect(git('diff', '--cached', '--name-only')).toBe(stagedBeforeCapture)

    writeFileSync(join(repositoryPath, 'tracked.txt'), 'turn end\n')
    writeFileSync(join(repositoryPath, 'end-only.txt'), 'end\n')
    await captureCheckpoint(repositoryPath, 'refs/cradle/checkpoints/test/end')

    expect(await summarizeCheckpointDiff(
      repositoryPath,
      'refs/cradle/checkpoints/test/start',
      'refs/cradle/checkpoints/test/end',
    )).toEqual({ changedFiles: 2, additions: 2, deletions: 1 })

    expect(await restoreCheckpoint(repositoryPath, 'refs/cradle/checkpoints/test/start')).toBe(true)
    expect(readFileSync(join(repositoryPath, 'tracked.txt'), 'utf8')).toBe('turn start\n')
    expect(readFileSync(join(repositoryPath, 'start-only.txt'), 'utf8')).toBe('start\n')
    expect(() => readFileSync(join(repositoryPath!, 'end-only.txt'), 'utf8')).toThrow()
    expect(git('diff', '--cached', '--name-only')).toBe('')

    await deleteCheckpointRefs(repositoryPath, [
      'refs/cradle/checkpoints/test/start',
      'refs/cradle/checkpoints/test/end',
    ])
    await deleteCheckpointRefs(repositoryPath, [
      'refs/cradle/checkpoints/test/start',
      'refs/cradle/checkpoints/test/end',
    ])
    expect(() => git('show-ref', '--verify', 'refs/cradle/checkpoints/test/start')).toThrow()
    expect(() => git('show-ref', '--verify', 'refs/cradle/checkpoints/test/end')).toThrow()
  })
})
