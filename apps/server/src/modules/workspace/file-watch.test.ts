import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { WorkspaceFileChangeEvent } from './file-watch'
import { subscribeWorkspaceFileChanges } from './file-watch'

const cleanupSubscriptions: Array<() => void> = []
const cleanupDirectories: string[] = []

afterEach(() => {
  for (const unsubscribe of cleanupSubscriptions.splice(0)) {
    unsubscribe()
  }
  for (const directory of cleanupDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('workspace file watch', () => {
  it('publishes the relative path when a workspace file changes', async () => {
    const workspacePath = mkdtempSync(join(tmpdir(), 'cradle-workspace-watch-'))
    cleanupDirectories.push(workspacePath)
    const fileEvent = new Promise<WorkspaceFileChangeEvent>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for file change')), 5_000)
      cleanupSubscriptions.push(subscribeWorkspaceFileChanges({
        workspaceId: 'workspace-1',
        workspacePath,
        listener(event) {
          if (event.type === 'file-changed' && event.path === 'src/index.ts') {
            clearTimeout(timeout)
            resolve(event)
          }
        },
      }))
    })

    mkdirSync(join(workspacePath, 'src'))
    writeFileSync(join(workspacePath, 'src/index.ts'), 'export {}\n')

    await expect(fileEvent).resolves.toMatchObject({
      type: 'file-changed',
      workspaceId: 'workspace-1',
      path: 'src/index.ts',
      timestamp: expect.any(Number),
    })
  })

  it('observes source and worktree roots for the same workspace independently', async () => {
    const sourcePath = mkdtempSync(join(tmpdir(), 'cradle-source-watch-'))
    const worktreePath = mkdtempSync(join(tmpdir(), 'cradle-worktree-watch-'))
    cleanupDirectories.push(sourcePath, worktreePath)

    const waitForFile = (workspacePath: string, expectedPath: string) => {
      return new Promise<WorkspaceFileChangeEvent>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${expectedPath}`)), 5_000)
        cleanupSubscriptions.push(subscribeWorkspaceFileChanges({
          workspaceId: 'workspace-shared',
          workspacePath,
          listener(event) {
            if (event.type === 'file-changed' && event.path === expectedPath) {
              clearTimeout(timeout)
              resolve(event)
            }
          },
        }))
      })
    }

    const sourceEvent = waitForFile(sourcePath, 'source.ts')
    const worktreeEvent = waitForFile(worktreePath, 'worktree.ts')
    writeFileSync(join(sourcePath, 'source.ts'), 'export const source = true\n')
    writeFileSync(join(worktreePath, 'worktree.ts'), 'export const worktree = true\n')

    await expect(Promise.all([sourceEvent, worktreeEvent])).resolves.toEqual([
      expect.objectContaining({ path: 'source.ts' }),
      expect.objectContaining({ path: 'worktree.ts' }),
    ])
  })
})
