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

      const createRes = await app.handle(new Request('http://localhost/remote-hosts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'remote-host-a',
          displayName: 'Remote Host A',
          connectionConfig: {
            transport: 'direct-url',
            baseUrl: fakeRemote.baseUrl,
          },
        }),
      }))
      expect(createRes.status).toBe(200)
      expect(await createRes.json()).toEqual(expect.objectContaining({
        id: 'remote-host-a',
        displayName: 'Remote Host A',
        connectionState: 'idle',
      }))

      const listRes = await app.handle(new Request('http://localhost/remote-hosts'))
      expect(listRes.status).toBe(200)
      expect(await listRes.json()).toEqual([
        expect.objectContaining({ id: 'remote-host-a' }),
      ])
      expect(db().select().from(providerTargets).all()).toHaveLength(0)
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    }
  })

  it('connects to a remote Cradle Server and proxies workspace file APIs', async () => {
    const dataDir = makeTempDir('cradle-remote-cradle-server-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    let app: ElysiaApp | undefined

    try {
      fakeRemote = await startFakeRemoteCradleServer()
      app = await createAppWithDataDir(dataDir)

      const createRes = await app.handle(new Request('http://localhost/remote-hosts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'remote-host-live',
          displayName: 'Remote Host Live',
          connectionConfig: {
            transport: 'direct-url',
            baseUrl: fakeRemote.baseUrl,
          },
        }),
      }))
      expect(createRes.status).toBe(200)

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

      const workspacesRes = await app.handle(new Request('http://localhost/remote-hosts/remote-host-live/cradle-server/workspaces'))
      expect(workspacesRes.status).toBe(200)
      expect(await workspacesRes.json()).toEqual({
        workspaces: [expect.objectContaining({ id: 'remote-workspace-1', name: 'Remote Project' })],
      })

      const filesRes = await app.handle(new Request('http://localhost/remote-hosts/remote-host-live/cradle-server/workspaces/remote-workspace-1/files'))
      expect(filesRes.status).toBe(200)
      expect(await filesRes.json()).toEqual({
        files: [
          { type: 'directory', name: 'src', path: 'src' },
          { type: 'file', name: 'README.md', path: 'README.md' },
        ],
      })

      const childrenRes = await app.handle(new Request('http://localhost/remote-hosts/remote-host-live/cradle-server/workspaces/remote-workspace-1/files/children?path=src'))
      expect(childrenRes.status).toBe(200)
      expect(await childrenRes.json()).toEqual({
        files: [{ type: 'file', name: 'index.ts', path: 'src/index.ts' }],
      })

      const contentRes = await app.handle(new Request('http://localhost/remote-hosts/remote-host-live/cradle-server/workspaces/remote-workspace-1/files/content?path=README.md'))
      expect(contentRes.status).toBe(200)
      expect(await contentRes.json()).toEqual({ content: '# Remote Project\n' })

      const infoRes = await app.handle(new Request('http://localhost/remote-hosts/remote-host-live/cradle-server/workspaces/remote-workspace-1/files/info?path=README.md'))
      expect(infoRes.status).toBe(200)
      expect(await infoRes.json()).toEqual(expect.objectContaining({
        name: 'README.md',
        previewKind: 'markdown',
      }))
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    }
  })
})
