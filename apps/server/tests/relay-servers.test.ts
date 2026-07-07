import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { shutdownInfra } from '../src/infra'
import { shouldStartManagedLocalRelayd, startManagedLocalRelayd, stopManagedLocalRelayd } from '../src/modules/relay-servers/local-relayd-supervisor'

type ElysiaApp = Awaited<ReturnType<typeof createServerApp>>

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

function writeFakeRelaydExecutable(dir: string, name = 'fake-relayd.cjs'): string {
  mkdirSync(dir, { recursive: true })
  const executablePath = join(dir, name)
  writeFileSync(executablePath, `#!/usr/bin/env node
const http = require('node:http')
const listen = process.env.CRADLE_RELAYD_LISTEN || '127.0.0.1:0'
const index = listen.lastIndexOf(':')
const host = listen.slice(0, index)
const port = Number(listen.slice(index + 1))
const server = http.createServer((req, res) => {
  if (req.url === '/healthz' || req.url === '/readyz') {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
    return
  }
  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('not found')
})
server.listen(port, host)
function shutdown() {
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 1000).unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
`)
  chmodSync(executablePath, 0o755)
  return executablePath
}

async function createAppWithDataDir(dataDir: string): Promise<ElysiaApp> {
  process.env.CRADLE_DATA_DIR = dataDir
  return await createServerApp()
}

async function reserveTcpPort(): Promise<number> {
  return await new Promise<number>((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        if (!address || typeof address === 'string') {
          reject(new Error('reserved address was not a TCP address'))
          return
        }
        resolvePort(address.port)
      })
    })
  })
}

interface RelayServerView {
  id: string
  displayName: string
  relayUrl: string
  enabled: boolean
  isDefault: boolean
}

async function createRelayServer(app: ElysiaApp, input: {
  id?: string
  displayName: string
  relayUrl: string
  isDefault?: boolean
  enabled?: boolean
}): Promise<RelayServerView> {
  const res = await app.handle(new Request('http://localhost/relay-servers', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: input.id,
      displayName: input.displayName,
      relayUrl: input.relayUrl,
      isDefault: input.isDefault,
      enabled: input.enabled,
    }),
  }))
  expect(res.status).toBe(200)
  return await res.json() as RelayServerView
}

describe('relay servers', () => {
  afterEach(() => {
    shutdownInfra()
  })

  it('does not autostart managed local relayd in test by default, but does in production', () => {
    const previousNodeEnv = process.env.NODE_ENV
    const previousCradleEnv = process.env.CRADLE_ENV
    const previousAutostart = process.env.CRADLE_RELAYD_AUTOSTART

    try {
      delete process.env.CRADLE_RELAYD_AUTOSTART
      process.env.NODE_ENV = 'development'
      process.env.CRADLE_ENV = 'production'
      expect(shouldStartManagedLocalRelayd()).toBe(true)

      process.env.NODE_ENV = 'production'
      delete process.env.CRADLE_ENV
      expect(shouldStartManagedLocalRelayd()).toBe(true)

      process.env.NODE_ENV = 'test'
      expect(shouldStartManagedLocalRelayd()).toBe(false)

      process.env.CRADLE_RELAYD_AUTOSTART = '0'
      expect(shouldStartManagedLocalRelayd()).toBe(false)
    }
    finally {
      restoreEnv('NODE_ENV', previousNodeEnv)
      restoreEnv('CRADLE_ENV', previousCradleEnv)
      restoreEnv('CRADLE_RELAYD_AUTOSTART', previousAutostart)
    }
  })

  it('creates, lists, updates, and deletes relay servers', async () => {
    const dataDir = makeTempDir('cradle-relay-servers-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    let app: ElysiaApp | undefined

    try {
      app = await createAppWithDataDir(dataDir)

      const created = await createRelayServer(app, {
        displayName: 'Official relay',
        relayUrl: 'https://relay.example.com',
      })
      expect(created.id).toBeTruthy()
      expect(created.isDefault).toBe(false)
      expect(created.enabled).toBe(true)

      const listRes = await app.handle(new Request('http://localhost/relay-servers'))
      expect(listRes.status).toBe(200)
      expect(await listRes.json()).toEqual([created])

      const updateRes = await app.handle(new Request(`http://localhost/relay-servers/${created.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: 'Renamed relay' }),
      }))
      expect(updateRes.status).toBe(200)
      expect((await updateRes.json() as RelayServerView).displayName).toBe('Renamed relay')

      const deleteRes = await app.handle(new Request(`http://localhost/relay-servers/${created.id}`, { method: 'DELETE' }))
      expect(deleteRes.status).toBe(200)

      const afterDelete = await app.handle(new Request('http://localhost/relay-servers'))
      expect(await afterDelete.json()).toEqual([])
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    }
  })

  it('keeps at most one default relay server', async () => {
    const dataDir = makeTempDir('cradle-relay-servers-default-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    let app: ElysiaApp | undefined

    try {
      app = await createAppWithDataDir(dataDir)

      const first = await createRelayServer(app, {
        displayName: 'Relay A',
        relayUrl: 'https://a.example.com',
        isDefault: true,
      })
      const second = await createRelayServer(app, {
        displayName: 'Relay B',
        relayUrl: 'https://b.example.com',
        isDefault: true,
      })

      // Promoting B to default must demote A.
      const list = await (await app.handle(new Request('http://localhost/relay-servers'))).json() as RelayServerView[]
      const a = list.find(s => s.id === first.id)
      const b = list.find(s => s.id === second.id)
      expect(a?.isDefault).toBe(false)
      expect(b?.isDefault).toBe(true)
      expect(list[0]?.id).toBe(second.id)

      // Promoting A back demotes B via an update.
      await app.handle(new Request(`http://localhost/relay-servers/${first.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isDefault: true }),
      }))
      const list2 = await (await app.handle(new Request('http://localhost/relay-servers'))).json() as RelayServerView[]
      expect(list2.find(s => s.id === first.id)?.isDefault).toBe(true)
      expect(list2.find(s => s.id === second.id)?.isDefault).toBe(false)
      expect(list2[0]?.id).toBe(first.id)
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    }
  })

  it('starts a managed local relayd and keeps an explicit relay server default', async () => {
    const dataDir = makeTempDir('cradle-managed-local-relayd-')
    const binDir = makeTempDir('cradle-managed-local-relayd-bin-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousAutostart = process.env.CRADLE_RELAYD_AUTOSTART
    const previousRelaydPath = process.env.CRADLE_RELAYD_PATH
    const previousRelaydListen = process.env.CRADLE_RELAYD_LISTEN
    const previousRelaydPublicUrl = process.env.CRADLE_RELAYD_PUBLIC_URL
    let app: ElysiaApp | undefined

    try {
      process.env.CRADLE_RELAYD_AUTOSTART = '1'
      process.env.CRADLE_RELAYD_PATH = writeFakeRelaydExecutable(binDir)
      delete process.env.CRADLE_RELAYD_LISTEN
      delete process.env.CRADLE_RELAYD_PUBLIC_URL
      app = await createAppWithDataDir(dataDir)

      await startManagedLocalRelayd()
      const firstList = await (await app.handle(new Request('http://localhost/relay-servers'))).json() as RelayServerView[]
      const localRelay = firstList.find(server => server.id === 'system:local-relayd')
      expect(localRelay).toEqual(expect.objectContaining({
        displayName: 'Built-in local relay',
        enabled: true,
        isDefault: true,
      }))
      expect(localRelay?.relayUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)

      const explicitRelay = await createRelayServer(app, {
        displayName: 'Public relay',
        relayUrl: 'https://relay.example.test',
        isDefault: true,
      })
      await stopManagedLocalRelayd()
      await startManagedLocalRelayd()

      const secondList = await (await app.handle(new Request('http://localhost/relay-servers'))).json() as RelayServerView[]
      expect(secondList.find(server => server.id === explicitRelay.id)?.isDefault).toBe(true)
      expect(secondList.find(server => server.id === 'system:local-relayd')?.isDefault).toBe(false)
    }
    finally {
      await stopManagedLocalRelayd()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(binDir, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_RELAYD_AUTOSTART', previousAutostart)
      restoreEnv('CRADLE_RELAYD_PATH', previousRelaydPath)
      restoreEnv('CRADLE_RELAYD_LISTEN', previousRelaydListen)
      restoreEnv('CRADLE_RELAYD_PUBLIC_URL', previousRelaydPublicUrl)
    }
  })

  it('uses Network inbound preferences for the managed local relay URL and listener', async () => {
    const dataDir = makeTempDir('cradle-managed-local-relayd-network-')
    const binDir = makeTempDir('cradle-managed-local-relayd-network-bin-')
    const relayPort = await reserveTcpPort()
    const relayUrl = `http://127.0.0.1:${relayPort}`
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousAutostart = process.env.CRADLE_RELAYD_AUTOSTART
    const previousRelaydPath = process.env.CRADLE_RELAYD_PATH
    const previousRelaydListen = process.env.CRADLE_RELAYD_LISTEN
    const previousRelaydPublicUrl = process.env.CRADLE_RELAYD_PUBLIC_URL
    let app: ElysiaApp | undefined

    try {
      process.env.CRADLE_RELAYD_AUTOSTART = '1'
      process.env.CRADLE_RELAYD_PATH = writeFakeRelaydExecutable(binDir)
      delete process.env.CRADLE_RELAYD_LISTEN
      delete process.env.CRADLE_RELAYD_PUBLIC_URL
      app = await createAppWithDataDir(dataDir)

      const prefRes = await app.handle(new Request('http://localhost/preferences/network', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          proxyEnabled: true,
          proxyMode: 'system',
          customProxyUrl: null,
          inbound: {
            serverAccessMode: 'local',
            managedRelayAccessMode: 'network',
            managedRelayPublicUrl: relayUrl,
          },
        }),
      }))
      expect(prefRes.status).toBe(200)

      await startManagedLocalRelayd()
      const list = await (await app.handle(new Request('http://localhost/relay-servers'))).json() as RelayServerView[]
      expect(list.find(server => server.id === 'system:local-relayd')?.relayUrl).toBe(relayUrl)

      const readyRes = await fetch(`${relayUrl}/readyz`)
      expect(readyRes.status).toBe(200)
    }
    finally {
      await stopManagedLocalRelayd()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(binDir, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_RELAYD_AUTOSTART', previousAutostart)
      restoreEnv('CRADLE_RELAYD_PATH', previousRelaydPath)
      restoreEnv('CRADLE_RELAYD_LISTEN', previousRelaydListen)
      restoreEnv('CRADLE_RELAYD_PUBLIC_URL', previousRelaydPublicUrl)
    }
  })

  it('starts managed local relayd from the packaged desktop resource path', async () => {
    const dataDir = makeTempDir('cradle-managed-local-relayd-packaged-')
    const resourcesDir = makeTempDir('cradle-managed-local-relayd-resources-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousAutostart = process.env.CRADLE_RELAYD_AUTOSTART
    const previousRelaydPath = process.env.CRADLE_RELAYD_PATH
    const previousResourcesPath = (process as { resourcesPath?: string }).resourcesPath
    let app: ElysiaApp | undefined

    try {
      process.env.CRADLE_RELAYD_AUTOSTART = '1'
      delete process.env.CRADLE_RELAYD_PATH
      ;(process as { resourcesPath?: string }).resourcesPath = resourcesDir
      const executableName = process.platform === 'win32' ? 'relayd.exe' : 'relayd'
      const relaydResourceDir = join(resourcesDir, 'relayd', `${process.platform}-${process.arch}`)
      writeFakeRelaydExecutable(relaydResourceDir, executableName)
      app = await createAppWithDataDir(dataDir)

      await startManagedLocalRelayd()
      const list = await (await app.handle(new Request('http://localhost/relay-servers'))).json() as RelayServerView[]
      expect(list.find(server => server.id === 'system:local-relayd')).toEqual(expect.objectContaining({
        displayName: 'Built-in local relay',
        enabled: true,
        isDefault: true,
      }))
    }
    finally {
      await stopManagedLocalRelayd()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(resourcesDir, { recursive: true, force: true })
      restoreEnv('CRADLE_DATA_DIR', previousDataDir)
      restoreEnv('CRADLE_RELAYD_AUTOSTART', previousAutostart)
      restoreEnv('CRADLE_RELAYD_PATH', previousRelaydPath)
      ;(process as { resourcesPath?: string }).resourcesPath = previousResourcesPath
    }
  })
})
