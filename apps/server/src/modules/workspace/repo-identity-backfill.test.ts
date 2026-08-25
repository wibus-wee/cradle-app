import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { databaseMaintenanceTasks, workspaces } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { workspaceFixture } from '../../../tests/helpers/workspace-fixture'
import { db, shutdownInfra } from '../../infra'
import * as BackgroundActivity from '../background-activity/service'
import type { MaintenanceRunContext } from '../maintenance/service'
import * as Maintenance from '../maintenance/service'
import {
  backfillWorkspaceGitIdentity,
  registerWorkspaceGitIdentityBackfillMaintenance,
  WORKSPACE_GIT_IDENTITY_BACKFILL_TASK_ID,
} from './repo-identity-backfill'
import { refreshWorkspaceGitIdentity } from './service'
import type { WorkspaceGitIdentity, WorkspaceLocator } from './workspace-locator'
import {
  readWorkspaceGitIdentityJson,
  serializeWorkspaceGitIdentity,
  serializeWorkspaceLocator,
} from './workspace-locator'

async function withTempDatabase<T>(run: (root: string) => Promise<T> | T): Promise<T> {
  const dataDir = mkdtempSync(join(tmpdir(), 'cradle-workspace-identity-backfill-data-'))
  const root = mkdtempSync(join(tmpdir(), 'cradle-workspace-identity-backfill-root-'))
  const previousDataDir = process.env.CRADLE_DATA_DIR
  const previousDbPath = process.env.CRADLE_DB_PATH
  process.env.CRADLE_DATA_DIR = dataDir
  delete process.env.CRADLE_DB_PATH

  try {
    return await run(root)
  }
  finally {
    Maintenance.reset()
    BackgroundActivity.reset()
    shutdownInfra()
    rmSync(dataDir, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
    restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    restoreEnv('CRADLE_DB_PATH', previousDbPath)
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = value
}

function initializeGitRepository(path: string): void {
  execFileSync('git', ['init', '-q', '-b', 'main', path])
  execFileSync('git', ['-C', path, 'config', 'user.email', 'test@example.com'])
  execFileSync('git', ['-C', path, 'config', 'user.name', 'Test'])
  execFileSync('git', ['-C', path, 'config', 'commit.gpgsign', 'false'])
  execFileSync('git', ['-C', path, 'remote', 'add', 'origin', 'git@github.com:wibus/cradle-app.git'])
  writeFileSync(join(path, 'README.md'), 'test\n')
  execFileSync('git', ['-C', path, 'add', 'README.md'])
  execFileSync('git', ['-C', path, 'commit', '-q', '-m', 'Initial commit'])
}

function openContext(): Pick<MaintenanceRunContext, 'deadline' | 'report'> {
  return {
    deadline: Date.now() + 60_000,
    report: () => {},
  }
}

function readIdentity(id: string): WorkspaceGitIdentity {
  const row = db()
    .select({ gitIdentityJson: workspaces.gitIdentityJson })
    .from(workspaces)
    .where(eq(workspaces.id, id))
    .get()
  if (!row) {
    throw new Error(`workspace ${id} was not found`)
  }
  return readWorkspaceGitIdentityJson(row.gitIdentityJson)
}

function readTask() {
  return db()
    .select()
    .from(databaseMaintenanceTasks)
    .where(eq(databaseMaintenanceTasks.id, WORKSPACE_GIT_IDENTITY_BACKFILL_TASK_ID))
    .get()
}

describe('workspace Git identity backfill', () => {
  it('backfills real local Git metadata and preserves existing fields', async () => {
    await withTempDatabase(async (root) => {
      initializeGitRepository(root)
      db().insert(workspaces).values({
        ...workspaceFixture({ id: 'local-repo', name: 'Local Repo', path: root }),
        gitIdentityJson: serializeWorkspaceGitIdentity({
          originUrl: 'https://github.com/authoritative/repository.git',
        }),
      }).run()

      const first = await backfillWorkspaceGitIdentity(openContext())

      expect(first).toMatchObject({
        workspacesScanned: 1,
        workspacesUpdated: 1,
        workspacesDeferred: 0,
        migrationCompleted: true,
      })
      expect(readIdentity('local-repo')).toMatchObject({
        originUrl: 'https://github.com/authoritative/repository.git',
        repoRoot: realpathSync(root),
        branch: 'main',
        headSha: expect.stringMatching(/^[0-9a-f]{40}$/),
      })
      expect(readTask()?.status).toBe('completed')

      await expect(backfillWorkspaceGitIdentity(openContext())).resolves.toMatchObject({
        workspacesScanned: 0,
        workspacesUpdated: 0,
        migrationCompleted: true,
      })
    })
  })

  it('defers an unreachable remote projection and completes after retry', async () => {
    await withTempDatabase(async () => {
      const remoteLocator: WorkspaceLocator = {
        nodeId: 'remote-node',
        path: '/srv/cradle-app',
        sourceWorkspaceId: 'remote-workspace',
      }
      db().insert(workspaces).values({
        id: 'remote-projection',
        name: 'Remote projection',
        locatorJson: serializeWorkspaceLocator(remoteLocator),
        identifier: 'REM',
      }).run()

      const unavailable = async (): Promise<WorkspaceGitIdentity> => {
        throw new Error('remote node is offline')
      }
      const first = await backfillWorkspaceGitIdentity(openContext(), {
        refreshIdentity: unavailable,
      })
      expect(first).toMatchObject({
        workspacesScanned: 1,
        workspacesUpdated: 0,
        workspacesDeferred: 1,
        lastDeferredWorkspaceId: 'remote-projection',
        lastDeferredError: 'remote node is offline',
        migrationCompleted: false,
      })
      expect(readTask()?.status).toBe('pending')

      const second = await backfillWorkspaceGitIdentity(openContext(), {
        refreshIdentity: async locator => locator.nodeId === 'remote-node'
          ? {
              originUrl: 'https://github.com/wibus/cradle-app.git',
              repoRoot: '/srv/cradle-app',
              branch: 'main',
              headSha: 'a'.repeat(40),
            }
          : refreshWorkspaceGitIdentity(locator),
      })
      expect(second).toMatchObject({
        workspacesScanned: 1,
        workspacesUpdated: 1,
        workspacesDeferred: 0,
        migrationCompleted: true,
      })
      expect(readIdentity('remote-projection').originUrl)
        .toBe('https://github.com/wibus/cradle-app.git')
      expect(readTask()?.status).toBe('completed')
    })
  })

  it('registers an observable manually runnable background activity', async () => {
    await withTempDatabase(async () => {
      registerWorkspaceGitIdentityBackfillMaintenance()

      expect(BackgroundActivity.list()).toEqual([
        expect.objectContaining({
          ownerNamespace: 'workspace',
          key: 'backfill-git-identity',
          manuallyRunnable: true,
          status: 'idle',
        }),
      ])

      await expect(BackgroundActivity.requestManualRun('workspace', 'backfill-git-identity'))
        .resolves
        .toMatchObject({
          status: 'succeeded',
          progress: expect.objectContaining({
            migrationCompleted: true,
            completed: true,
          }),
        })
    })
  })
})
