import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { externalIssueItems, externalIssueSourceBindings, issues, workspaces } from '@cradle/db'
import type { ExternalIssueSourceSnapshot } from '@cradle/plugin-sdk/server'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import { resetTokenCache } from '../src/lib/github-api'
import { registerExternalIssueSource } from '../src/plugins/external-issue-source-registry'
import { workspaceFixture } from './helpers/workspace-fixture'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function restoreEnv(previous: {
  dataDir?: string
  pluginsDir?: string
  externalPluginsDirs?: string
}): void {
  if (previous.dataDir === undefined) {
    delete process.env.CRADLE_DATA_DIR
  }
 else {
    process.env.CRADLE_DATA_DIR = previous.dataDir
  }
  if (previous.pluginsDir === undefined) {
    delete process.env.CRADLE_PLUGINS_DIR
  }
 else {
    process.env.CRADLE_PLUGINS_DIR = previous.pluginsDir
  }
  if (previous.externalPluginsDirs === undefined) {
    delete process.env.CRADLE_EXTERNAL_PLUGINS_DIRS
  }
 else {
    process.env.CRADLE_EXTERNAL_PLUGINS_DIRS = previous.externalPluginsDirs
  }
}

function fixtureSnapshot(input: {
  title?: string
  labels?: string[]
  notModified?: boolean
  issues?: ExternalIssueSourceSnapshot['issues']
} = {}): ExternalIssueSourceSnapshot {
  return {
    source: {
      status: 'ok',
      observedAt: '2026-06-08T00:00:00Z',
      notModified: input.notModified,
      etag: '"fixture-etag"',
      rateLimit: { remaining: 4999, resetAt: 1_780_000_000 },
    },
    inventory: { repositories: 1, issues: input.issues?.length ?? 1 },
    issues: input.issues ?? [
      {
        externalId: 'I_fixture_1',
        externalKey: 'owner/repo#1',
        externalUrl: 'https://github.com/owner/repo/issues/1',
        repository: { owner: 'owner', name: 'repo' },
        number: 1,
        title: input.title ?? 'Fixture GitHub issue',
        body: 'GitHub body',
        state: 'open',
        labels: input.labels ?? ['bug', 'github'],
        assignees: ['wibus'],
        updatedAt: '2026-06-08T00:00:00Z',
      },
    ],
    warnings: [],
  }
}

async function setup() {
  const dataDir = makeTempDir('cradle-external-issues-')
  const workspaceRoot = makeTempDir('cradle-workspace-')
  const previous = {
    dataDir: process.env.CRADLE_DATA_DIR,
    pluginsDir: process.env.CRADLE_PLUGINS_DIR,
    externalPluginsDirs: process.env.CRADLE_EXTERNAL_PLUGINS_DIRS,
  }
  process.env.CRADLE_DATA_DIR = dataDir
  process.env.CRADLE_PLUGINS_DIR = join(dataDir, 'plugins')
  process.env.CRADLE_EXTERNAL_PLUGINS_DIRS = ''
  const app = await createServerApp({ startBackgroundTasks: false })
  db().insert(workspaces).values({
    ...workspaceFixture({
      id: 'workspace-external-issues',
      name: 'Workspace External Issues',
      identifier: 'EXT',
      path: workspaceRoot,
    }),
  }).run()
  return { app, dataDir, workspaceRoot, previous }
}

describe('external issue sources capability', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('projects GitHub-shaped items without creating normal Cradle issues and preserves status overlay', async () => {
    const state = await setup()
    let snapshot = fixtureSnapshot()
    const registration = registerExternalIssueSource('fixture-plugin', {
      id: 'fixture-github',
      label: 'Fixture GitHub',
      capabilities: { refresh: true },
      async readSnapshot() {
        return snapshot
      },
    })

    try {
      const sourcesRes = await state.app.handle(new Request('http://localhost/external-issue-sources'))
      expect(sourcesRes.status).toBe(200)
      const sources = await sourcesRes.json() as Array<{ id: string, label: string }>
      const sourceKey = sources.find(source => source.label === 'Fixture GitHub')?.id
      expect(sourceKey).toBeTruthy()

      const bindRes = await state.app.handle(new Request(`http://localhost/external-issue-sources/${sourceKey}/bindings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'workspace-external-issues',
          repositoryOwner: 'owner',
          repositoryName: 'repo',
        }),
      }))
      expect(bindRes.status).toBe(200)
      const binding = await bindRes.json() as { id: string }

      const refreshRes = await state.app.handle(new Request(`http://localhost/external-issue-sources/bindings/${binding.id}/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }))
      expect(refreshRes.status).toBe(200)
      expect(await refreshRes.json()).toEqual(expect.objectContaining({
        recordsSeen: 1,
        recordsProjected: 1,
        recordsMissing: 0,
        notModified: false,
      }))

      expect(db().select().from(issues).all()).toEqual([])
      const itemsRes = await state.app.handle(new Request('http://localhost/external-issue-sources/items?workspaceId=workspace-external-issues'))
      expect(itemsRes.status).toBe(200)
      const items = await itemsRes.json() as Array<{
        id: string
        title: string
        labels: string[]
        statusId: string
        syncStatus: string
      }>
      expect(items).toEqual([
        expect.objectContaining({
          title: 'Fixture GitHub issue',
          labels: ['bug', 'github'],
          syncStatus: 'active',
        }),
      ])
      const item = items[0]
      expect(item.statusId).toBeTruthy()

      const statusesRes = await state.app.handle(new Request('http://localhost/issues/statuses?workspaceId=workspace-external-issues'))
      expect(statusesRes.status).toBe(200)
      const statuses = await statusesRes.json() as Array<{ id: string, name: string }>
      const todoStatusId = statuses.find(status => status.name === 'To Do')?.id
      expect(todoStatusId).toBeTruthy()

      const moveRes = await state.app.handle(new Request(`http://localhost/external-issue-sources/items/${item.id}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ statusId: todoStatusId }),
      }))
      expect(moveRes.status).toBe(200)
      expect(await moveRes.json()).toEqual(expect.objectContaining({ statusId: todoStatusId }))

      snapshot = fixtureSnapshot({ title: 'Updated from GitHub', labels: ['enhancement'] })
      const refreshAgainRes = await state.app.handle(new Request(`http://localhost/external-issue-sources/bindings/${binding.id}/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }))
      expect(refreshAgainRes.status).toBe(200)
      const updatedItems = await (await state.app.handle(new Request('http://localhost/external-issue-sources/items?workspaceId=workspace-external-issues'))).json() as Array<{
        title: string
        labels: string[]
        statusId: string
      }>
      expect(updatedItems).toHaveLength(1)
      expect(updatedItems[0]).toEqual(expect.objectContaining({
        title: 'Updated from GitHub',
        labels: ['enhancement'],
        statusId: todoStatusId,
      }))

      const editRes = await state.app.handle(new Request(`http://localhost/external-issue-sources/items/${item.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Local edit should fail' }),
      }))
      expect(editRes.status).toBe(403)
    }
 finally {
      registration.dispose()
      shutdownInfra()
      restoreEnv(state.previous)
      rmSync(state.dataDir, { recursive: true, force: true })
      rmSync(state.workspaceRoot, { recursive: true, force: true })
    }
  })

  it('provides the host common GitHub token to external issue sources', async () => {
    const state = await setup()
    const previousGhToken = process.env.GH_TOKEN
    process.env.GH_TOKEN = 'host-common-token'
    resetTokenCache()
    let observedToken: string | undefined
    const registration = registerExternalIssueSource('fixture-plugin', {
      id: 'fixture-github',
      label: 'Fixture GitHub',
      capabilities: { refresh: true },
      async readSnapshot(ctx) {
        observedToken = ctx.sharedConfig.get('GITHUB_ISSUES_TOKEN')
        return fixtureSnapshot()
      },
    })

    try {
      const sourceKey = ((await (await state.app.handle(new Request('http://localhost/external-issue-sources'))).json()) as Array<{ id: string }>)[0].id
      const bindRes = await state.app.handle(new Request(`http://localhost/external-issue-sources/${sourceKey}/bindings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'workspace-external-issues',
          repositoryOwner: 'owner',
          repositoryName: 'repo',
        }),
      }))
      expect(bindRes.status).toBe(200)
      const binding = await bindRes.json() as { id: string }

      const refreshRes = await state.app.handle(new Request(`http://localhost/external-issue-sources/bindings/${binding.id}/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }))
      expect(refreshRes.status).toBe(200)
      expect(observedToken).toBe('host-common-token')
    }
 finally {
      registration.dispose()
      if (previousGhToken === undefined) {
        delete process.env.GH_TOKEN
      }
      else {
        process.env.GH_TOKEN = previousGhToken
      }
      resetTokenCache()
      shutdownInfra()
      restoreEnv(state.previous)
      rmSync(state.dataDir, { recursive: true, force: true })
      rmSync(state.workspaceRoot, { recursive: true, force: true })
    }
  })

  it('handles not modified snapshots, missing items, and coalesced repository fetches', async () => {
    const state = await setup()
    let snapshot = fixtureSnapshot()
    let readCount = 0
    let blockRead = false
    let releaseRead: (() => void) = () => {}
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    const registration = registerExternalIssueSource('fixture-plugin', {
      id: 'fixture-github',
      label: 'Fixture GitHub',
      capabilities: { refresh: true },
      async readSnapshot() {
        readCount += 1
        if (blockRead) {
          await readGate
        }
        return snapshot
      },
    })

    try {
      const sourceKey = ((await (await state.app.handle(new Request('http://localhost/external-issue-sources'))).json()) as Array<{ id: string }>)[0].id
      const bind = async (workspaceId: string) => {
        const res = await state.app.handle(new Request(`http://localhost/external-issue-sources/${sourceKey}/bindings`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ workspaceId, repositoryOwner: 'owner', repositoryName: 'repo' }),
        }))
        expect(res.status).toBe(200)
        return await res.json() as { id: string }
      }
      const firstBinding = await bind('workspace-external-issues')

      db().insert(workspaces).values(workspaceFixture({
        id: 'workspace-external-issues-b',
        name: 'Workspace External Issues B',
        identifier: 'EXB',
        path: makeTempDir('cradle-workspace-b-'),
      })).run()
      const secondBinding = await bind('workspace-external-issues-b')

      blockRead = true
      const firstRefresh = state.app.handle(new Request(`http://localhost/external-issue-sources/bindings/${firstBinding.id}/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }))
      for (;;) {
        if (readCount > 0) {
          break
        }
        await new Promise(resolve => setTimeout(resolve, 0))
      }
      await new Promise(resolve => setTimeout(resolve, 0))
      const secondRefresh = state.app.handle(new Request(`http://localhost/external-issue-sources/bindings/${secondBinding.id}/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }))
      releaseRead?.()
      expect((await firstRefresh).status).toBe(200)
      expect((await secondRefresh).status).toBe(200)
      expect(readCount).toBe(1)

      snapshot = fixtureSnapshot({ notModified: true, issues: [] })
      const notModifiedRes = await state.app.handle(new Request(`http://localhost/external-issue-sources/bindings/${firstBinding.id}/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }))
      expect(notModifiedRes.status).toBe(200)
      expect(await notModifiedRes.json()).toEqual(expect.objectContaining({ notModified: true, recordsMissing: 0 }))
      expect(db().select().from(externalIssueItems).where(eq(externalIssueItems.syncStatus, 'missing')).all()).toEqual([])

      snapshot = fixtureSnapshot({ issues: [] })
      const missingRes = await state.app.handle(new Request(`http://localhost/external-issue-sources/bindings/${firstBinding.id}/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }))
      expect(missingRes.status).toBe(200)
      expect(await missingRes.json()).toEqual(expect.objectContaining({ recordsMissing: 1 }))
      expect(db().select().from(externalIssueItems).where(eq(externalIssueItems.syncStatus, 'missing')).all()).toHaveLength(1)
    }
 finally {
      registration.dispose()
      shutdownInfra()
      restoreEnv(state.previous)
      rmSync(state.dataDir, { recursive: true, force: true })
      rmSync(state.workspaceRoot, { recursive: true, force: true })
    }
  })

  it('returns recorded rate limit details instead of hiding repository refresh errors behind HTTP failure', async () => {
    const state = await setup()
    const registration = registerExternalIssueSource('fixture-plugin', {
      id: 'fixture-github',
      label: 'Fixture GitHub',
      capabilities: { refresh: true },
      async readSnapshot() {
        return {
          ...fixtureSnapshot(),
          source: {
            status: 'ok',
            observedAt: '2026-06-08T00:00:00Z',
            rateLimit: { remaining: 0, resetAt: 4_000_000_000 },
          },
        }
      },
    })

    try {
      const sourceKey = ((await (await state.app.handle(new Request('http://localhost/external-issue-sources'))).json()) as Array<{ id: string }>)[0].id
      const bindRes = await state.app.handle(new Request(`http://localhost/external-issue-sources/${sourceKey}/bindings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'workspace-external-issues',
          repositoryOwner: 'owner',
          repositoryName: 'repo',
        }),
      }))
      expect(bindRes.status).toBe(200)
      const binding = await bindRes.json() as { id: string }

      const firstRefreshRes = await state.app.handle(new Request(`http://localhost/external-issue-sources/bindings/${binding.id}/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }))
      expect(firstRefreshRes.status).toBe(200)

      const rateLimitedRes = await state.app.handle(new Request(`http://localhost/external-issue-sources/bindings/${binding.id}/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }))
      expect(rateLimitedRes.status).toBe(200)
      expect(await rateLimitedRes.json()).toEqual(expect.objectContaining({
        status: 'rate-limited',
        message: 'External issue source repository is rate limited',
      }))

      const row = db().select().from(externalIssueSourceBindings).where(eq(externalIssueSourceBindings.id, binding.id)).get()
      expect(row).toEqual(expect.objectContaining({
        lastRefreshStatus: 'rate-limited',
        lastRefreshError: 'External issue source repository is rate limited',
      }))
    }
 finally {
      registration.dispose()
      shutdownInfra()
      restoreEnv(state.previous)
      rmSync(state.dataDir, { recursive: true, force: true })
      rmSync(state.workspaceRoot, { recursive: true, force: true })
    }
  })
})
