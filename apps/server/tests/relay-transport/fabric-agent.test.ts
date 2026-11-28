import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'

import type { EnvelopePipe } from '../../src/modules/relay-transport/envelope-pipe'
import type { EnvelopePipeTarget } from '../../src/modules/relay-transport/fabric-agent'
import {
  connectEnvelopePipe,
  parseFabricAgentLocator,
  readFabricAgentEndpoint,
  resolveFabricAgent,
} from '../../src/modules/relay-transport/fabric-agent'
import { FabricIpcFrameParser } from '../../src/modules/relay-transport/ipc-envelope-pipe'

function waitFor(condition: () => boolean, timeoutMs = 5_000, label = 'condition'): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const poll = () => {
      if (condition()) {
        resolve()
        return
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`timed out waiting for ${label}`))
        return
      }
      setTimeout(poll, 5)
    }
    poll()
  })
}

function target(overrides: Partial<EnvelopePipeTarget> = {}): EnvelopePipeTarget {
  return {
    role: 'controller',
    relayUrl: 'http://127.0.0.1:1',
    fabricId: 'fabric-1',
    nodeId: 'node-1',
    linkId: 'link-1',
    headers: { 'x-cradle-fabric-certificate': 'cert', 'x-cradle-fabric-proof': 'proof' },
    ...overrides,
  }
}

describe('fabric agent discovery resolution', () => {
  let dataDir = ''
  const cleanups: Array<() => void> = []

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) {
      cleanup()
    }
    if (dataDir) {
      rmSync(dataDir, { recursive: true, force: true })
      dataDir = ''
    }
  })

  function writeLocator(contents: unknown, token?: string): string {
    dataDir = dataDir || mkdtempSync(join(tmpdir(), 'cradle-agent-locator-'))
    if (token !== undefined) {
      writeFileSync(join(dataDir, 'ipc-token'), token, { mode: 0o600 })
    }
    const locatorPath = join(dataDir, 'agent.json')
    writeFileSync(locatorPath, typeof contents === 'string' ? contents : JSON.stringify(contents), { mode: 0o600 })
    return locatorPath
  }

  it('is absent without the environment injection', () => {
    expect(resolveFabricAgent({}).mode).toBe('absent')
    expect(resolveFabricAgent({ CRADLE_FABRIC_AGENT_LOCATOR: '  ' }).mode).toBe('absent')
  })

  it('honors the disabled escape hatch even with a valid locator', () => {
    const locatorPath = writeLocator({ version: 1, port: 54321, tokenFile: 'ipc-token', pid: 1 }, 'token')
    for (const value of ['1', 'true', 'TRUE']) {
      expect(resolveFabricAgent({ CRADLE_FABRIC_AGENT_LOCATOR: locatorPath, CRADLE_FABRIC_AGENT_DISABLED: value }).mode).toBe('disabled')
    }
    expect(resolveFabricAgent({ CRADLE_FABRIC_AGENT_LOCATOR: locatorPath, CRADLE_FABRIC_AGENT_DISABLED: '0' }).mode).toBe('endpoint')
  })

  it('resolves the endpoint and reads the token from the token file', () => {
    const locatorPath = writeLocator({ version: 1, port: 54321, tokenFile: 'ipc-token', pid: 1 }, 'secret-token\n')
    const resolution = resolveFabricAgent({ CRADLE_FABRIC_AGENT_LOCATOR: locatorPath })
    expect(resolution.mode).toBe('endpoint')
    if (resolution.mode !== 'endpoint') {
      throw new Error('expected endpoint resolution')
    }
    expect(resolution.endpoint.port).toBe(54321)
    expect(resolution.endpoint.token).toBe('secret-token')
  })

  it('resolves an absolute token file path as written', () => {
    dataDir = mkdtempSync(join(tmpdir(), 'cradle-agent-locator-'))
    const tokenPath = join(dataDir, 'elsewhere-token')
    writeFileSync(tokenPath, 'absolute-token', { mode: 0o600 })
    const locatorPath = join(dataDir, 'agent.json')
    writeFileSync(locatorPath, JSON.stringify({ version: 1, port: 54321, tokenFile: tokenPath }))
    const endpoint = readFabricAgentEndpoint(locatorPath)
    expect(endpoint.token).toBe('absolute-token')
  })

  it('reports invalid locators instead of throwing', () => {
    for (const bad of [
      'not json',
      JSON.stringify({ version: 2, port: 1, tokenFile: 'ipc-token' }),
      JSON.stringify({ version: 1, port: 0, tokenFile: 'ipc-token' }),
      JSON.stringify({ version: 1, port: 70000, tokenFile: 'ipc-token' }),
      JSON.stringify({ version: 1, port: 54321 }),
    ]) {
      const locatorPath = writeLocator(bad, 'token')
      const resolution = resolveFabricAgent({ CRADLE_FABRIC_AGENT_LOCATOR: locatorPath })
      expect(resolution.mode).toBe('invalid')
      rmSync(dataDir, { recursive: true, force: true })
      dataDir = ''
    }
  })

  it('reports a missing locator file as invalid', () => {
    const resolution = resolveFabricAgent({ CRADLE_FABRIC_AGENT_LOCATOR: '/nonexistent/agent.json' })
    expect(resolution.mode).toBe('invalid')
  })

  it('reports a missing token file as invalid', () => {
    const locatorPath = writeLocator({ version: 1, port: 54321, tokenFile: 'ipc-token', pid: 1 })
    expect(resolveFabricAgent({ CRADLE_FABRIC_AGENT_LOCATOR: locatorPath }).mode).toBe('invalid')
  })

  it('parses the locator contract shape', () => {
    expect(parseFabricAgentLocator('{"version":1,"port":80,"tokenFile":"ipc-token","pid":42}')).toEqual({ port: 80, tokenFile: 'ipc-token' })
    expect(() => parseFabricAgentLocator('{"version":1,"port":"80","tokenFile":"ipc-token"}')).toThrow()
  })
})

describe('fabric agent carriage mode selection', () => {
  const cleanups: Array<() => Promise<void> | void> = []
  const pipes: EnvelopePipe[] = []
  const previousLocator = process.env.CRADLE_FABRIC_AGENT_LOCATOR
  const previousDisabled = process.env.CRADLE_FABRIC_AGENT_DISABLED

  afterEach(async () => {
    for (const pipe of pipes.splice(0)) {
      pipe.teardown()
    }
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup()
    }
    if (previousLocator === undefined) {
      delete process.env.CRADLE_FABRIC_AGENT_LOCATOR
    }
 else {
      process.env.CRADLE_FABRIC_AGENT_LOCATOR = previousLocator
    }
    if (previousDisabled === undefined) {
      delete process.env.CRADLE_FABRIC_AGENT_DISABLED
    }
 else {
      process.env.CRADLE_FABRIC_AGENT_DISABLED = previousDisabled
    }
  })

  /** Capture relayd-side upgrades: path and headers of every WS connection. */
  async function startUpgradeCapture(): Promise<{ port: number, upgrades: Array<{ path: string, certificate: string | undefined }>, close: () => Promise<void> }> {
    const upgrades: Array<{ path: string, certificate: string | undefined }> = []
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' })
    wss.on('connection', (ws, request) => {
      upgrades.push({
        path: new URL(request.url ?? '/', 'http://127.0.0.1').pathname,
        certificate: request.headers['x-cradle-fabric-certificate'] as string | undefined,
      })
    })
    await new Promise<void>(resolve => wss.once('listening', resolve))
    const { port } = wss.address() as AddressInfo
    cleanups.push(() => new Promise<void>((resolve) => {
      for (const client of wss.clients) {
        client.terminate()
      }
      wss.close(() => resolve())
    }))
    return { port, upgrades, close: async () => {} }
  }

  function writeAgentFixture(dir: string, port: number): string {
    writeFileSync(join(dir, 'ipc-token'), 'fixture-token', { mode: 0o600 })
    const locatorPath = join(dir, 'agent.json')
    writeFileSync(locatorPath, JSON.stringify({ version: 1, port, tokenFile: 'ipc-token', pid: process.pid }))
    return locatorPath
  }

  it('uses a direct WebSocket when no locator is configured', async () => {
    delete process.env.CRADLE_FABRIC_AGENT_LOCATOR
    const capture = await startUpgradeCapture()
    const opened = new Promise<void>((resolve) => {
      pipes.push(connectEnvelopePipe(target({ relayUrl: `http://127.0.0.1:${capture.port}` }), { onOpen: () => resolve() }))
    })
    await opened
    await waitFor(() => capture.upgrades.length === 1, 5_000, 'direct upgrade')
    expect(capture.upgrades[0]!.path).toBe('/v1/ws/controllers/link-1')
    expect(capture.upgrades[0]!.certificate).toBe('cert')
  })

  it('falls back to a direct WebSocket when the agent TCP connect fails', async () => {
    const capture = await startUpgradeCapture()
    const dir = mkdtempSync(join(tmpdir(), 'cradle-agent-fallback-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    // Port 1 is never a listening agent: connect refuses immediately.
    process.env.CRADLE_FABRIC_AGENT_LOCATOR = writeAgentFixture(dir, 1)

    const opened = new Promise<void>((resolve) => {
      pipes.push(connectEnvelopePipe(target({ relayUrl: `http://127.0.0.1:${capture.port}` }), { onOpen: () => resolve() }))
    })
    await opened
    await waitFor(() => capture.upgrades.length === 1, 5_000, 'fallback upgrade')
    expect(capture.upgrades[0]!.path).toBe('/v1/ws/controllers/link-1')
  })

  it('does not fall back after the IPC pipe has opened', async () => {
    const capture = await startUpgradeCapture()
    // Bare impostor agent: accepts TCP, never answers, then drops the client.
    const impostor = net.createServer((socket) => {
      socket.once('data', () => {
        setTimeout(() => socket.destroy(), 20)
      })
    })
    await new Promise<void>((resolve, reject) => {
      impostor.once('error', reject)
      impostor.listen(0, '127.0.0.1', resolve)
    })
    cleanups.push(() => new Promise<void>(resolve => impostor.close(() => resolve())))
    const impostorPort = (impostor.address() as AddressInfo).port

    const dir = mkdtempSync(join(tmpdir(), 'cradle-agent-midlink-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    process.env.CRADLE_FABRIC_AGENT_LOCATOR = writeAgentFixture(dir, impostorPort)

    let opened = 0
    let closed = 0
    const closedPromise = new Promise<void>((resolve) => {
      pipes.push(connectEnvelopePipe(target({ relayUrl: `http://127.0.0.1:${capture.port}` }), {
        onOpen: () => { opened += 1 },
        onClose: () => {
          closed += 1
          resolve()
        },
      }))
    })
    await closedPromise

    expect(opened).toBe(1)
    expect(closed).toBe(1)
    // Mid-link death is final: no fallback upgrade ever reached relayd.
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(capture.upgrades).toHaveLength(0)
  })

  it('re-resolves per connection attempt: down agent uses WS, returning agent uses IPC', async () => {
    const capture = await startUpgradeCapture()
    const dir = mkdtempSync(join(tmpdir(), 'cradle-agent-return-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))

    // Phase 1: nothing listens on the locator port — direct WebSocket.
    const deadPortServer = net.createServer()
    await new Promise<void>(resolve => deadPortServer.listen(0, '127.0.0.1', resolve))
    const agentPort = (deadPortServer.address() as AddressInfo).port
    await new Promise<void>(resolve => deadPortServer.close(() => resolve()))
    process.env.CRADLE_FABRIC_AGENT_LOCATOR = writeAgentFixture(dir, agentPort)

    const firstOpened = new Promise<void>((resolve) => {
      pipes.push(connectEnvelopePipe(target({ relayUrl: `http://127.0.0.1:${capture.port}` }), { onOpen: () => resolve() }))
    })
    await firstOpened
    await waitFor(() => capture.upgrades.length === 1, 5_000, 'fallback upgrade while agent is down')

    // Phase 2: the agent returns on the same port — new pipes use IPC.
    const auths: string[] = []
    const agent = net.createServer((socket) => {
      const parser = new FabricIpcFrameParser()
      socket.on('data', (chunk) => {
        try {
          for (const frame of parser.push(chunk)) {
            auths.push(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength).toString('utf8'))
          }
        }
 catch {
          socket.destroy()
        }
      })
    })
    await new Promise<void>((resolve, reject) => {
      agent.once('error', reject)
      agent.listen(agentPort, '127.0.0.1', resolve)
    })
    cleanups.push(() => new Promise<void>(resolve => agent.close(() => resolve())))

    pipes.push(connectEnvelopePipe(target({ relayUrl: `http://127.0.0.1:${capture.port}` }), {}))
    await waitFor(() => auths.length === 1, 5_000, 'IPC auth after agent return')
    expect(JSON.parse(auths[0]!)).toMatchObject({ version: 1, token: 'fixture-token', role: 'controller', linkId: 'link-1' })
    // No new direct upgrade: the returning agent reclaimed carriage.
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(capture.upgrades).toHaveLength(1)
  })
})
