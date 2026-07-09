import { mkdtempSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { providerTargets } from '@cradle/db'
import { afterEach, describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import { buildSshProfileLaunchConfig } from '../src/modules/remote-hosts/service'

type ElysiaApp = Awaited<ReturnType<typeof createServerApp>>

interface FakeRemoteCradleServer {
  baseUrl: string
  close: () => Promise<void>
  seenHosts: string[]
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
  const seenHosts: string[] = []
  const workspace = {
    id: 'remote-workspace-1',
    name: 'Remote Project',
    locator: {
      hostId: 'local',
      path: '/remote/project',
    },
    gitIdentity: {
      originUrl: 'git@example.com:remote/project.git',
      repoRoot: '/remote/project',
      branch: 'main',
    },
    identifier: 'REM',
    pinned: 0,
    createdAt: 1,
    updatedAt: 2,
  }
  const rootFiles = [
    { type: 'directory', name: 'src', path: 'src' },
    { type: 'file', name: 'README.md', path: 'README.md' },
  ]
  const childFiles = [
    { type: 'file', name: 'index.ts', path: 'src/index.ts' },
  ]

  const server = createServer((request, response) => {
    seenHosts.push(request.headers.host ?? '')
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
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
    if (url.pathname === '/workspaces/remote-workspace-1/files') {
      writeJson(response, rootFiles)
      return
    }
    if (url.pathname === '/workspaces/remote-workspace-1/files/children') {
      expect(url.searchParams.get('path')).toBe('src')
      writeJson(response, childFiles)
      return
    }
    if (url.pathname === '/workspaces/remote-workspace-1/files/content') {
      expect(url.searchParams.get('path')).toBe('README.md')
      writeJson(response, { content: '# Remote Project\n' })
      return
    }
    if (url.pathname === '/workspaces/remote-workspace-1/files/info') {
      expect(url.searchParams.get('path')).toBe('README.md')
      writeJson(response, {
        name: 'README.md',
        path: 'README.md',
        size: 17,
        modifiedAt: 1234,
        mimeType: 'text/markdown',
        extension: '.md',
        previewKind: 'markdown',
      })
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
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    seenHosts,
    close: () => closeServer(server),
  }
}

function writeJson(response: import('node:http').ServerResponse, payload: unknown): void {
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify(payload))
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

async function createDirectUrlHost(app: ElysiaApp, hostId: string, baseUrl: string): Promise<void> {
  const createRes = await app.handle(new Request('http://localhost/remote-hosts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: hostId,
      displayName: hostId,
      connectionConfig: {
        transport: 'direct-url',
        baseUrl,
      },
    }),
  }))
  expect(createRes.status).toBe(200)
}

describe('remote Cradle Server hosts', () => {
  let fakeRemote: FakeRemoteCradleServer | null = null

  afterEach(async () => {
    await fakeRemote?.close()
    fakeRemote = null
    shutdownInfra()
  })

  it('builds OpenSSH launch config from a structured SSH profile', () => {
    expect(buildSshProfileLaunchConfig({
      hostName: '127.0.0.1',
      user: 'me',
      port: 2222,
      auth: 'identityFile',
      identityFilePath: '/tmp/cradle-test-key',
    })).toEqual({
      sshTarget: 'me@127.0.0.1',
      sshArgs: ['-p', '2222', '-i', '/tmp/cradle-test-key'],
    })

    expect(buildSshProfileLaunchConfig({
      hostName: 'devbox',
      user: null,
      port: null,
      auth: 'default',
      identityFilePath: null,
    })).toEqual({
      sshTarget: 'devbox',
      sshArgs: [],
    })
  })

  it('stores remote Cradle Server host rows without writing provider targets', async () => {
    const dataDir = makeTempDir('cradle-remote-hosts-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    let app: ElysiaApp | undefined

    try {
      fakeRemote = await startFakeRemoteCradleServer()
      app = await createAppWithDataDir(dataDir)
      expect(db().select().from(providerTargets).all()).toHaveLength(0)

      await createDirectUrlHost(app, 'remote-host-a', fakeRemote.baseUrl)
      expect(await (await app.handle(new Request('http://localhost/remote-hosts'))).json()).toEqual([
        expect.objectContaining({ id: 'remote-host-a' }),
      ])
      expect(db().select().from(providerTargets).all()).toHaveLength(0)
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    }
  })

  it('connects to a remote Cradle Server and forwards upstream workspace file APIs', async () => {
    const dataDir = makeTempDir('cradle-remote-cradle-server-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    let app: ElysiaApp | undefined

    try {
      fakeRemote = await startFakeRemoteCradleServer()
      app = await createAppWithDataDir(dataDir)
      await createDirectUrlHost(app, 'remote-host-live', fakeRemote.baseUrl)

      const connectRes = await app.handle(new Request('http://localhost/remote-hosts/remote-host-live/cradle-server/connect', {
        method: 'POST',
      }))
      expect(connectRes.status).toBe(200)
      expect(await connectRes.json()).toEqual({
        hostId: 'remote-host-live',
        state: 'connected',
        localBaseUrl: fakeRemote.baseUrl,
        lastError: null,
      })

      const healthRes = await app.handle(new Request('http://localhost/remote-hosts/remote-host-live/cradle-server/health'))
      expect(healthRes.status).toBe(200)
      expect(await healthRes.json()).toEqual(expect.objectContaining({
        status: 'ok',
        health: expect.objectContaining({ uptime: 42 }),
      }))

      const upstreamHealthRes = await app.handle(new Request('http://localhost/remote-hosts/remote-host-live/upstream/health'))
      expect(upstreamHealthRes.status).toBe(200)
      expect(await upstreamHealthRes.json()).toEqual(expect.objectContaining({ uptime: 42 }))

      const workspacesRes = await app.handle(new Request('http://localhost/remote-hosts/remote-host-live/upstream/workspaces'))
      expect(workspacesRes.status).toBe(200)
      expect(await workspacesRes.json()).toEqual([
        expect.objectContaining({ id: 'remote-workspace-1', name: 'Remote Project' }),
      ])

      const filesRes = await app.handle(new Request('http://localhost/remote-hosts/remote-host-live/upstream/workspaces/remote-workspace-1/files'))
      expect(filesRes.status).toBe(200)
      expect(await filesRes.json()).toEqual([
        { type: 'directory', name: 'src', path: 'src' },
        { type: 'file', name: 'README.md', path: 'README.md' },
      ])

      const childrenRes = await app.handle(new Request('http://localhost/remote-hosts/remote-host-live/upstream/workspaces/remote-workspace-1/files/children?path=src'))
      expect(childrenRes.status).toBe(200)
      expect(await childrenRes.json()).toEqual([
        { type: 'file', name: 'index.ts', path: 'src/index.ts' },
      ])

      const contentRes = await app.handle(new Request('http://localhost/remote-hosts/remote-host-live/upstream/workspaces/remote-workspace-1/files/content?path=README.md'))
      expect(contentRes.status).toBe(200)
      expect(await contentRes.json()).toEqual({ content: '# Remote Project\n' })

      const infoRes = await app.handle(new Request('http://localhost/remote-hosts/remote-host-live/upstream/workspaces/remote-workspace-1/files/info?path=README.md'))
      expect(infoRes.status).toBe(200)
      expect(await infoRes.json()).toEqual(expect.objectContaining({
        name: 'README.md',
        previewKind: 'markdown',
      }))

      expect(fakeRemote.seenHosts.some(host => host.includes('127.0.0.1') && !host.startsWith('localhost'))).toBe(true)
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    }
  })

  it('returns 409 when upstream is called for a disabled host', async () => {
    const dataDir = makeTempDir('cradle-remote-upstream-disabled-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    let app: ElysiaApp | undefined

    try {
      fakeRemote = await startFakeRemoteCradleServer()
      app = await createAppWithDataDir(dataDir)

      const createRes = await app.handle(new Request('http://localhost/remote-hosts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'remote-host-disabled',
          displayName: 'Disabled Host',
          enabled: false,
          connectionConfig: {
            transport: 'direct-url',
            baseUrl: fakeRemote.baseUrl,
          },
        }),
      }))
      expect(createRes.status).toBe(200)

      const upstreamRes = await app.handle(new Request('http://localhost/remote-hosts/remote-host-disabled/upstream/health'))
      expect(upstreamRes.status).toBe(409)
      const body = await upstreamRes.json() as { code?: string }
      expect(body.code).toBe('remote_host_disabled')
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    }
  })

  it('still serves remote workspace files through local workspace routes', async () => {
    const dataDir = makeTempDir('cradle-remote-workspace-proxy-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    let app: ElysiaApp | undefined

    try {
      fakeRemote = await startFakeRemoteCradleServer()
      app = await createAppWithDataDir(dataDir)
      await createDirectUrlHost(app, 'remote-host-live', fakeRemote.baseUrl)

      const connectRes = await app.handle(new Request('http://localhost/remote-hosts/remote-host-live/cradle-server/connect', {
        method: 'POST',
      }))
      expect(connectRes.status).toBe(200)

      const createWorkspaceRes = await app.handle(new Request('http://localhost/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Remote Project',
          locator: {
            hostId: 'remote-host-live',
            path: '/remote/project',
          },
        }),
      }))
      expect(createWorkspaceRes.status).toBe(200)
      const workspace = await createWorkspaceRes.json() as { id: string }

      const filesRes = await app.handle(new Request(`http://localhost/workspaces/${workspace.id}/files`))
      expect(filesRes.status).toBe(200)
      expect(await filesRes.json()).toEqual([
        { type: 'directory', name: 'src', path: 'src' },
        { type: 'file', name: 'README.md', path: 'README.md' },
      ])
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    }
  })
})
