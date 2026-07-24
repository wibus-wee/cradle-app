import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { workspaces, worktrees } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import { localWorkspaceLocator, serializeWorkspaceLocator } from '../src/modules/workspace/workspace-locator'

interface TestInfraEnv {
  dataDir?: string
  dbPath?: string
}

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function useIsolatedTestInfra(dataDir: string): TestInfraEnv {
  const previous = {
    dataDir: process.env.CRADLE_DATA_DIR,
    dbPath: process.env.CRADLE_DB_PATH,
  }

  shutdownInfra()
  process.env.CRADLE_DATA_DIR = dataDir
  delete process.env.CRADLE_DB_PATH
  return previous
}

function restoreTestInfra(previous: TestInfraEnv): void {
  shutdownInfra()
  if (previous.dataDir === undefined) {
    delete process.env.CRADLE_DATA_DIR
  }
  else {
    process.env.CRADLE_DATA_DIR = previous.dataDir
  }
  if (previous.dbPath === undefined) {
    delete process.env.CRADLE_DB_PATH
  }
  else {
    process.env.CRADLE_DB_PATH = previous.dbPath
  }
}

describe('worktree capability', () => {
  it('treats zero managed cleanup limits as disabled', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-worktree-workspace-')
    const firstWorktreePath = makeTempDir('cradle-worktree-first-')
    const secondWorktreePath = makeTempDir('cradle-worktree-second-')
    const previousEnv = useIsolatedTestInfra(dataDir)

    try {
      const app = await createServerApp({ startBackgroundTasks: false })
      const database = db()
      database.insert(workspaces).values({
        id: 'workspace-worktree-cleanup',
        name: 'Workspace Worktree Cleanup',
        locatorJson: serializeWorkspaceLocator(localWorkspaceLocator(workspaceRoot)),
      }).run()
      mkdirSync(firstWorktreePath, { recursive: true })
      mkdirSync(secondWorktreePath, { recursive: true })
      writeFileSync(join(firstWorktreePath, 'one.txt'), 'one\n', 'utf8')
      writeFileSync(join(secondWorktreePath, 'two.txt'), 'two\n', 'utf8')
      database.insert(worktrees).values([
        {
          id: 'worktree-one',
          sourceWorkspaceId: 'workspace-worktree-cleanup',
          name: 'worktree-one',
          path: firstWorktreePath,
          branch: 'cradle/wt/worktree-one',
          baseRef: 'HEAD',
          status: 'active',
          createdAt: 100,
          updatedAt: 100,
        },
        {
          id: 'worktree-two',
          sourceWorkspaceId: 'workspace-worktree-cleanup',
          name: 'worktree-two',
          path: secondWorktreePath,
          branch: 'cradle/wt/worktree-two',
          baseRef: 'HEAD',
          status: 'active',
          createdAt: 200,
          updatedAt: 200,
        },
      ]).run()

      const response = await app.handle(new Request('http://localhost/worktrees/cleanup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ maxWorktrees: 0, maxTotalSizeGb: 0 }),
      }))

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        cleaned: [],
        skipped: 0,
        totalSizeBytes: 8,
      })
      expect(database.select().from(worktrees).where(eq(worktrees.status, 'active')).all()).toHaveLength(2)
    }
    finally {
      restoreTestInfra(previousEnv)
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      rmSync(firstWorktreePath, { recursive: true, force: true })
      rmSync(secondWorktreePath, { recursive: true, force: true })
    }
  })
})
