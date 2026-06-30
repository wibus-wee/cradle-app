import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sessionAwaits, sessions, workspaces } from '@cradle/db'
import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('desktop tray projection', () => {
  it('reports Chronicle as intentionally disabled in production health', async () => {
    const dataDir = createTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousNodeEnv = process.env.NODE_ENV
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.NODE_ENV = 'production'

    try {
      const app = await createServerApp({ startBackgroundTasks: false })

      const healthResponse = await app.handle(new Request('http://localhost/desktop/health'))
      expect(healthResponse.status).toBe(200)
      expect(await healthResponse.json()).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'chronicle',
          value: 'Disabled',
          status: 'ok',
          detail: 'Chronicle runtime is only available in development builds.',
        }),
      ]))
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV
      }
      else {
        process.env.NODE_ENV = previousNodeEnv
      }
    }
  })

  it('returns desktop facts for recent sessions, health, summary, and pending awaits', async () => {
    const dataDir = createTempDir('cradle-data-')
    const workspaceRoot = createTempDir('cradle-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    try {
      const app = await createServerApp({ startBackgroundTasks: false })
      const store = db()
      const workspaceId = randomUUID()
      const sessionId = randomUUID()
      const awaitId = randomUUID()

      store.insert(workspaces).values({
        id: workspaceId,
        name: 'Desktop Workspace',
        path: workspaceRoot,
      }).run()
      store.insert(sessions).values({
        id: sessionId,
        workspaceId,
        title: 'Pinned Chat',
        runtimeKind: 'codex',
        pinned: 1,
      }).run()
      store.insert(sessionAwaits).values({
        id: awaitId,
        chatSessionId: sessionId,
        workspaceId,
        source: 'github-ci',
        filterJson: JSON.stringify({ repo: 'owner/repo', pr: 42 }),
        status: 'pending',
        reason: 'Waiting for checks',
      }).run()

      const summaryResponse = await app.handle(new Request('http://localhost/desktop/summary'))
      expect(summaryResponse.status).toBe(200)
      expect(await summaryResponse.json()).toEqual(expect.objectContaining({
        recentSessions: 1,
        pinnedSessions: 1,
        pendingAwaits: 1,
        running: 0,
      }))

      const recentSessionsResponse = await app.handle(new Request('http://localhost/desktop/recent-sessions'))
      expect(recentSessionsResponse.status).toBe(200)
      expect(await recentSessionsResponse.json()).toEqual([
        expect.objectContaining({
          sessionId,
          title: 'Pinned Chat',
          workspaceName: 'Desktop Workspace',
          state: 'awaiting',
        }),
      ])

      const healthResponse = await app.handle(new Request('http://localhost/desktop/health'))
      expect(healthResponse.status).toBe(200)
      expect(await healthResponse.json()).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'server', value: 'Online', status: 'ok' }),
        expect.objectContaining({ id: 'awaits', value: '1 pending', status: 'warning' }),
      ]))

      const awaitsResponse = await app.handle(new Request('http://localhost/desktop/awaits'))
      expect(awaitsResponse.status).toBe(200)
      expect(await awaitsResponse.json()).toEqual([
        expect.objectContaining({
          id: awaitId,
          sessionId,
          title: 'Pinned Chat',
          workspaceName: 'Desktop Workspace',
          source: 'github-ci',
          reason: 'Waiting for checks',
        }),
      ])
    }
    finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })
})
