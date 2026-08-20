import { mkdtempSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { nodeSessionLinks, sessions } from '@cradle/db'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import { assertRunnableSession } from '../src/modules/chat-runtime/runtime-session-context'
import { getNodeSessionLink } from '../src/modules/session/node-projection'

const fabricNodeLinkTestState = vi.hoisted(() => ({ baseUrl: null as string | null }))

vi.mock('../src/modules/relay-transport/node-link-manager', () => ({
  getFabricNodeLinkManager: () => ({
    ensure: async () => {
      if (!fabricNodeLinkTestState.baseUrl) {
        throw new Error('fake Fabric Node link has not been configured')
      }
      return { localBaseUrl: fabricNodeLinkTestState.baseUrl }
    },
  }),
}))

type ElysiaApp = Awaited<ReturnType<typeof createServerApp>>

interface FakeRemoteState {
  sessions: Map<string, {
    workspaceId: string
    title: string
    providerTargetId?: string
    modelId?: string | null
    thinkingEffort?: string | null
    runtimeKind?: string
    runtimeSettings?: Record<string, unknown>
  }>
  deletedSessionIds: string[]
  forwardedPaths: string[]
}

interface FakeRemoteCradleServer {
  baseUrl: string
  close: () => Promise<void>
  state: FakeRemoteState
}

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function restoreEnv(name: string, previousValue: string | undefined): void {
  if (previousValue === undefined) {
    delete process.env[name]
    return
  }
  process.env[name] = previousValue
}

async function createAppWithDataDir(dataDir: string): Promise<ElysiaApp> {
  process.env.CRADLE_DATA_DIR = dataDir
  return await createServerApp()
}

async function startFakeRemoteCradleServer(): Promise<FakeRemoteCradleServer> {
  const state: FakeRemoteState = {
    sessions: new Map(),
    deletedSessionIds: [],
    forwardedPaths: [],
  }
  const workspace = {
    id: 'remote-workspace-1',
    name: 'Remote Project',
    locator: {
      nodeId: 'local',
      path: '/remote/project',
    },
    gitIdentity: {},
    identifier: 'REM',
    pinned: 0,
    createdAt: 1,
    updatedAt: 2,
  }

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    state.forwardedPaths.push(`${request.method ?? 'GET'} ${url.pathname}${url.search}`)

    if (url.pathname === '/health') {
      writeJson(response, {
        status: 'ok',
        uptime: 42,
        memory: { heapUsed: 1, heapTotal: 2, rss: 3, external: 4 },
        cpu: { percent: null, userMicros: 1, systemMicros: 2, sampleMs: null, usedMicros: null, windowReady: false },
        timestamp: 123,
      })
      return
    }
    if (url.pathname === '/workspaces') {
      writeJson(response, [workspace])
      return
    }
    if (url.pathname === '/workspaces/resolve') {
      writeJson(response, url.searchParams.get('path') === '/missing/project' ? null : workspace)
      return
    }
    if ((url.pathname === '/sessions' || url.pathname === '/sessions/') && request.method === 'GET') {
      const workspaceId = url.searchParams.get('workspaceId')
      const items = [...state.sessions.entries()]
        .filter(([, session]) => !workspaceId || session.workspaceId === workspaceId)
        .map(([id, session], index) => ({
          id,
          workspaceId: session.workspaceId,
          title: session.title,
          origin: 'manual',
          providerTargetId: session.providerTargetId ?? null,
          modelId: session.modelId ?? null,
          thinkingEffort: session.thinkingEffort ?? null,
          runtimeKind: session.runtimeKind ?? 'standard',
          archivedAt: null,
          createdAt: 100 + index,
          updatedAt: 200 + index,
        }))
      writeJson(response, { items, nextCursor: null })
      return
    }
    if ((url.pathname === '/sessions' || url.pathname === '/sessions/') && request.method === 'POST') {
      readJsonBody(request).then((body) => {
        const payload = body as {
          workspaceId?: string
          title?: string
          providerTargetId?: string
          modelId?: string | null
          thinkingEffort?: string | null
          runtimeKind?: string
          runtimeSettings?: Record<string, unknown>
        }
        const id = `remote-session-${state.sessions.size + 1}`
        state.sessions.set(id, {
          workspaceId: payload.workspaceId ?? workspace.id,
          title: payload.title ?? 'Untitled',
          providerTargetId: payload.providerTargetId,
          modelId: payload.modelId,
          thinkingEffort: payload.thinkingEffort,
          runtimeKind: payload.runtimeKind,
          runtimeSettings: payload.runtimeSettings,
        })
        writeJson(response, { id, title: payload.title ?? 'Untitled', workspaceId: payload.workspaceId ?? workspace.id })
      }).catch(() => {
        response.writeHead(400)
        response.end('bad json')
      })
      return
    }
    const sessionDeleteMatch = url.pathname.match(/^\/sessions\/([^/]+)$/)
    if (sessionDeleteMatch && request.method === 'DELETE') {
      const sessionId = decodeURIComponent(sessionDeleteMatch[1]!)
      if (sessionId === 'remote-session-fail-delete') {
        response.writeHead(500)
        response.end('delete failed')
        return
      }
      state.sessions.delete(sessionId)
      state.deletedSessionIds.push(sessionId)
      writeJson(response, { ok: true })
      return
    }
    const chatSessionMatch = url.pathname.match(/^\/chat\/sessions\/([^/]+)(?:\/.*)?$/)
    if (chatSessionMatch) {
      if (request.method === 'GET' && url.pathname.endsWith('/stream')) {
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
        })
        response.end('data: [DONE]\n\n')
        return
      }
      if (request.method === 'POST' && url.pathname.endsWith('/response')) {
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
        })
        response.end('data: [DONE]\n\n')
        return
      }
      writeJson(response, { ok: true, path: url.pathname })
      return
    }

    response.writeHead(404, { 'content-type': 'text/plain' })
    response.end('not found')
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${address.port}`
  fabricNodeLinkTestState.baseUrl = baseUrl
  return {
    baseUrl,
    state,
    close: () => closeServer(server),
  }
}

function writeJson(response: import('node:http').ServerResponse, payload: unknown): void {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify(payload))
}

function readJsonBody(request: import('node:http').IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      }
      catch (error) {
        reject(error)
      }
    })
    request.on('error', reject)
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

async function createRemoteMountedWorkspace(app: ElysiaApp, nodeId: string, path = '/remote/project'): Promise<string> {
  const createWorkspaceRes = await app.handle(new Request('http://localhost/workspaces', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Remote Project',
      locator: {
        nodeId,
        path,
        sourceWorkspaceId: path === '/remote/project' ? 'remote-workspace-1' : undefined,
      },
    }),
  }))
  expect(createWorkspaceRes.status).toBe(200)
  const workspace = await createWorkspaceRes.json() as { id: string }
  return workspace.id
}

describe('node session projection', () => {
  let fakeRemote: FakeRemoteCradleServer | null = null

  afterEach(async () => {
    await fakeRemote?.close()
    fakeRemote = null
    fabricNodeLinkTestState.baseUrl = null
    shutdownInfra()
  })

  it('creates a local projection linked to a remote session', async () => {
    const dataDir = makeTempDir('cradle-remote-session-projection-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    let app: ElysiaApp | undefined

    try {
      fakeRemote = await startFakeRemoteCradleServer()
      app = await createAppWithDataDir(dataDir)
      const workspaceId = await createRemoteMountedWorkspace(app, 'node-projection')

      const createRes = await app.handle(new Request('http://localhost/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Remote chat',
          workspaceId,
          providerTargetId: 'remote-provider-1',
          modelId: 'remote-model-1',
          thinkingEffort: 'high',
          runtimeKind: 'codex',
          runtimeSettings: { approvalPolicy: 'never' },
        }),
      }))
      expect(createRes.status).toBe(200)
      const session = await createRes.json() as { id: string, execution: { kind: string, remoteSessionId?: string } }
      expect(session.execution).toEqual({
        kind: 'node',
        nodeId: 'node-projection',
        remoteSessionId: 'remote-session-1',
      })
      expect(session.id).not.toBe('remote-session-1')

      const link = getNodeSessionLink(session.id)
      expect(link).toEqual(expect.objectContaining({
        nodeId: 'node-projection',
        remoteSessionId: 'remote-session-1',
        remoteWorkspaceId: 'remote-workspace-1',
        projectionKind: 'controller-created',
      }))
      expect(fakeRemote.state.sessions.get('remote-session-1')).toEqual({
        workspaceId: 'remote-workspace-1',
        title: 'Remote chat',
        providerTargetId: 'remote-provider-1',
        modelId: 'remote-model-1',
        thinkingEffort: 'high',
        runtimeKind: 'codex',
        runtimeSettings: { approvalPolicy: 'never' },
      })
      expect(db().select().from(sessions).where(eq(sessions.id, session.id)).get()?.providerTargetId).toBeNull()
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    }
  })

  it('rejects local chat runtime execution for linked sessions', async () => {
    const dataDir = makeTempDir('cradle-remote-session-reject-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    let app: ElysiaApp | undefined

    try {
      fakeRemote = await startFakeRemoteCradleServer()
      app = await createAppWithDataDir(dataDir)
      const workspaceId = await createRemoteMountedWorkspace(app, 'node-reject')

      const createRes = await app.handle(new Request('http://localhost/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Remote chat', workspaceId }),
      }))
      const session = await createRes.json() as { id: string }

      expect(() => assertRunnableSession(session.id)).toThrowError(expect.objectContaining({
        code: 'chat_session_executes_on_fabric_node',
      }))
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    }
  })

  it('forwards chat response through upstream with the remote session id', async () => {
    const dataDir = makeTempDir('cradle-remote-session-chat-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    let app: ElysiaApp | undefined

    try {
      fakeRemote = await startFakeRemoteCradleServer()
      app = await createAppWithDataDir(dataDir)
      const workspaceId = await createRemoteMountedWorkspace(app, 'node-chat')

      const createRes = await app.handle(new Request('http://localhost/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Remote chat', workspaceId }),
      }))
      const session = await createRes.json() as { id: string }

      fakeRemote.state.forwardedPaths = []
      const responseRes = await app.handle(new Request(`http://localhost/chat/sessions/${session.id}/response`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'hello remote' }),
      }))
      expect(responseRes.status).toBe(200)
      expect(fakeRemote.state.forwardedPaths).toContain('POST /chat/sessions/remote-session-1/response')
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    }
  })

  it('transparently proxies queue, cancel, and runtime-settings for linked sessions', async () => {
    const dataDir = makeTempDir('cradle-remote-session-passthrough-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    let app: ElysiaApp | undefined

    try {
      fakeRemote = await startFakeRemoteCradleServer()
      app = await createAppWithDataDir(dataDir)
      const workspaceId = await createRemoteMountedWorkspace(app, 'node-passthrough')

      const createRes = await app.handle(new Request('http://localhost/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Remote chat', workspaceId }),
      }))
      const session = await createRes.json() as { id: string }

      fakeRemote.state.forwardedPaths = []

      const queueRes = await app.handle(new Request(`http://localhost/chat/sessions/${session.id}/queue`))
      expect(queueRes.status).toBe(200)
      expect(fakeRemote.state.forwardedPaths).toContain('GET /chat/sessions/remote-session-1/queue')

      const cancelRes = await app.handle(new Request(`http://localhost/chat/sessions/${session.id}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }))
      expect(cancelRes.status).toBe(200)
      expect(fakeRemote.state.forwardedPaths).toContain('POST /chat/sessions/remote-session-1/cancel')

      const settingsRes = await app.handle(new Request(`http://localhost/chat/sessions/${session.id}/runtime-settings`))
      expect(settingsRes.status).toBe(200)
      expect(fakeRemote.state.forwardedPaths).toContain('GET /chat/sessions/remote-session-1/runtime-settings')

      const threadsRes = await app.handle(new Request(`http://localhost/chat/sessions/${session.id}/provider-threads`))
      expect(threadsRes.status).toBe(200)
      expect(fakeRemote.state.forwardedPaths).toContain('GET /chat/sessions/remote-session-1/provider-threads')
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    }
  })

  it('cascades delete to the remote session and removes the local projection', async () => {
    const dataDir = makeTempDir('cradle-remote-session-delete-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    let app: ElysiaApp | undefined

    try {
      fakeRemote = await startFakeRemoteCradleServer()
      app = await createAppWithDataDir(dataDir)
      const workspaceId = await createRemoteMountedWorkspace(app, 'node-delete')

      const createRes = await app.handle(new Request('http://localhost/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Remote chat', workspaceId }),
      }))
      const session = await createRes.json() as { id: string }

      const deleteRes = await app.handle(new Request(`http://localhost/sessions/${session.id}`, {
        method: 'DELETE',
      }))
      expect(deleteRes.status).toBe(200)
      expect(fakeRemote.state.deletedSessionIds).toContain('remote-session-1')
      expect(db().select().from(sessions).where(eq(sessions.id, session.id)).get()).toBeUndefined()
      expect(db().select().from(nodeSessionLinks).where(eq(nodeSessionLinks.localSessionId, session.id)).get()).toBeUndefined()
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    }
  })

  it('keeps the local projection when upstream delete fails', async () => {
    const dataDir = makeTempDir('cradle-remote-session-delete-fail-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    let app: ElysiaApp | undefined

    try {
      fakeRemote = await startFakeRemoteCradleServer()
      app = await createAppWithDataDir(dataDir)
      const workspaceId = await createRemoteMountedWorkspace(app, 'node-delete-fail')

      const localSessionId = 'local-projection-delete-fail'
      db().insert(sessions).values({
        id: localSessionId,
        workspaceId,
        title: 'Fail delete',
        origin: 'manual',
        runtimeKind: 'standard',
        configJson: '{}',
      }).run()
      db().insert(nodeSessionLinks).values({
        localSessionId,
        nodeId: 'node-delete-fail',
        remoteSessionId: 'remote-session-fail-delete',
        remoteWorkspaceId: 'remote-workspace-1',
      }).run()

      const deleteRes = await app.handle(new Request(`http://localhost/sessions/${localSessionId}`, {
        method: 'DELETE',
      }))
      expect(deleteRes.status).toBe(502)
      expect(db().select().from(sessions).where(eq(sessions.id, localSessionId)).get()).toBeDefined()
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    }
  })

  it('discovers remote sessions idempotently and only unlinks discovered projections', async () => {
    const dataDir = makeTempDir('cradle-remote-session-reconcile-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    let app: ElysiaApp | undefined

    try {
      fakeRemote = await startFakeRemoteCradleServer()
      fakeRemote.state.sessions.set('remote-existing-session', {
        workspaceId: 'remote-workspace-1',
        title: 'Created on the other controller',
        providerTargetId: 'remote-provider-1',
        modelId: 'remote-model-1',
        thinkingEffort: 'medium',
        runtimeKind: 'standard',
        runtimeSettings: {},
      })
      app = await createAppWithDataDir(dataDir)
      const workspaceId = await createRemoteMountedWorkspace(app, 'node-reconcile')

      const reconcileRequest = () => app!.handle(new Request('http://localhost/sessions/node-projections/reconcile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      }))
      const firstRes = await reconcileRequest()
      expect(firstRes.status).toBe(200)
      expect(await firstRes.json()).toEqual(expect.objectContaining({
        workspaceId,
        nodeId: 'node-reconcile',
        remoteWorkspaceId: 'remote-workspace-1',
        discovered: 1,
      }))

      const link = db().select().from(nodeSessionLinks).where(eq(nodeSessionLinks.remoteSessionId, 'remote-existing-session')).get()
      expect(link).toEqual(expect.objectContaining({ projectionKind: 'discovered' }))

      const secondRes = await reconcileRequest()
      expect(secondRes.status).toBe(200)
      expect(await secondRes.json()).toEqual(expect.objectContaining({ discovered: 0, updated: 0, removed: 0 }))

      const deleteRes = await app.handle(new Request(`http://localhost/sessions/${link!.localSessionId}`, {
        method: 'DELETE',
      }))
      expect(deleteRes.status).toBe(200)
      expect(fakeRemote.state.deletedSessionIds).not.toContain('remote-existing-session')
      expect(fakeRemote.state.sessions.has('remote-existing-session')).toBe(true)
      expect(db().select().from(sessions).where(eq(sessions.id, link!.localSessionId)).get()).toBeUndefined()

      const rediscoverRes = await reconcileRequest()
      expect(rediscoverRes.status).toBe(200)
      expect(await rediscoverRes.json()).toEqual(expect.objectContaining({ discovered: 1, removed: 0 }))
      const rediscoveredLink = db().select().from(nodeSessionLinks).where(eq(nodeSessionLinks.remoteSessionId, 'remote-existing-session')).get()
      expect(rediscoveredLink).toBeDefined()

      fakeRemote.state.sessions.delete('remote-existing-session')
      const removeRes = await reconcileRequest()
      expect(removeRes.status).toBe(200)
      expect(await removeRes.json()).toEqual(expect.objectContaining({ discovered: 0, removed: 1 }))
      expect(db().select().from(sessions).where(eq(sessions.id, rediscoveredLink!.localSessionId)).get()).toBeUndefined()
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    }
  })

  it('returns 409 without creating a local session when remote workspace cannot be resolved', async () => {
    const dataDir = makeTempDir('cradle-remote-session-unresolved-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    let app: ElysiaApp | undefined

    try {
      fakeRemote = await startFakeRemoteCradleServer()
      app = await createAppWithDataDir(dataDir)
      const workspaceId = await createRemoteMountedWorkspace(app, 'node-unresolved', '/missing/project')

      const beforeCount = db().select().from(sessions).all().length
      const createRes = await app.handle(new Request('http://localhost/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Unresolved', workspaceId }),
      }))
      expect(createRes.status).toBe(409)
      const body = await createRes.json() as { code?: string }
      expect(body.code).toBe('remote_cradle_workspace_not_resolved')
      expect(db().select().from(sessions).all()).toHaveLength(beforeCount)
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    }
  })
})
