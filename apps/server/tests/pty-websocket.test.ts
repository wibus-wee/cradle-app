import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sessions, workspaces } from '@cradle/db'
import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { z } from 'zod'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import type { PtyServerEvent } from '../src/modules/pty/protocol'
import { workspaceFixture } from './helpers/workspace-fixture'

type ElysiaApp = Awaited<ReturnType<typeof createServerApp>>

const PtyServerEventJsonSchema = z.string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.discriminatedUnion('type', [
    z.object({
      type: z.literal('snapshot'),
      seq: z.number(),
      buffer: z.string(),
      running: z.boolean(),
    }),
    z.object({
      type: z.literal('output'),
      seq: z.number(),
      data: z.string(),
    }),
    z.object({
      type: z.literal('exit'),
      seq: z.number(),
      exitCode: z.number().nullable(),
      signal: z.string().nullable(),
    }),
    z.object({
      type: z.literal('pong'),
    }),
    z.object({
      type: z.literal('error'),
      code: z.string(),
      message: z.string(),
    }),
  ]))

const TERMINAL_FIXTURE_SCRIPT = [
  'process.stdout.write(\'READY\\n\')',
  'process.stdin.setEncoding(\'utf8\')',
  'process.stdin.on(\'data\', (chunk) => { process.stdout.write(\'ECHO:\' + chunk.toString()) })',
  'process.stdin.resume()',
  'setInterval(() => {}, 1000)',
].join(';')

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function insertWorkspace(id: string, name: string, path: string): void {
  db().insert(workspaces).values(workspaceFixture({ id, name, path })).run()
}

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate a TCP port')))
        return
      }
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve(address.port)
      })
    })
  })
}

async function createCliTuiSession(baseUrl: string, workspaceRoot: string) {
  const _baseUrl = baseUrl
  void _baseUrl
  insertWorkspace('workspace-pty', 'Workspace Pty', workspaceRoot)

  insertAgentRow({
    id: 'agent-cli-tui',
    name: 'CLI TUI Agent',
    avatarStyle: 'bottts-neutral',
    avatarSeed: 'cli-seed',
    runtimeKind: 'cli-tui',
    configJson: JSON.stringify({
      cliTui: {
        executable: process.execPath,
        args: ['-e', TERMINAL_FIXTURE_SCRIPT],
      },
    }),
  })

  insertSessionRow({
    id: 'session-cli-tui',
    workspaceId: 'workspace-pty',
    title: 'CLI Session',
    agentId: 'agent-cli-tui',
    runtimeKind: 'cli-tui',
    configJson: JSON.stringify({
      cliTuiLaunch: {
        executable: process.execPath,
        args: ['-e', TERMINAL_FIXTURE_SCRIPT],
      },
    }),
  })
}

async function startServerApp(): Promise<{ app: ElysiaApp, baseUrl: string }> {
  const app = await createServerApp({ startBackgroundTasks: false })
  const port = await getAvailablePort()
  app.listen({ hostname: '127.0.0.1', port })
  return { app, baseUrl: `http://127.0.0.1:${port}` }
}

function toWebSocketUrl(baseUrl: string, path: string): string {
  return baseUrl.replace('http://', 'ws://').replace('https://', 'wss://') + path
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function createSocketClient(url: string) {
  const socket = new WebSocket(url)
  const messages: PtyServerEvent[] = []
  const listeners = new Set<(message: PtyServerEvent) => void>()

  let closed = false
  let opened = false
  let closeCode = 0
  let closeReason = ''
  let closeResolver: ((value: { code: number, reason: string }) => void) | null = null

  const openPromise = new Promise<void>((resolve, reject) => {
    socket.once('open', () => {
      opened = true
      resolve()
    })
    socket.once('close', (code, reason) => {
      if (!opened) {
        reject(new Error(`Socket closed before opening at ${url} (${code})`))
      }
      closeCode = code
      closeReason = reason.toString()
    })
    socket.once('unexpected-response', (_request, response) => {
      reject(new Error(`WebSocket upgrade failed at ${url} (${response.statusCode ?? 0})`))
    })
    socket.once('error', (error) => {
      if (!opened) {
        reject(error)
      }
    })
  })

  const closePromise = new Promise<{ code: number, reason: string }>((resolve) => {
    closeResolver = resolve
  })

  socket.on('message', (data) => {
    const text = data.toString()
    const message = PtyServerEventJsonSchema.parse(text)
    messages.push(message)
    for (const listener of listeners) {
      listener(message)
    }
  })

  socket.on('close', (code, reason) => {
    closed = true
    closeCode = code
    closeReason = reason.toString()
    closeResolver?.({ code: closeCode, reason: closeReason })
  })

  socket.on('error', () => {
    // The close event is the stable signal for assertions once the socket is open.
  })

  return {
    socket,
    messages,
    open: openPromise,
    send(message: unknown) {
      const encoded = JSON.stringify(message)
      if (typeof message === 'object' && message !== null && 'type' in message && (message as { type?: string }).type === 'ping') {
        socket.send(encoded.replace('"ping"', '"p\\u0069ng"'))
        return
      }
      socket.send(encoded)
    },
    async waitFor(predicate: (message: PtyServerEvent) => boolean, timeoutMs = 5000): Promise<PtyServerEvent> {
      const existing = messages.find(predicate)
      if (existing) {
        return existing
      }

      return await new Promise((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout>

        const onMessage = (message: PtyServerEvent) => {
          if (!predicate(message)) {
            return
          }
          clearTimeout(timer)
          listeners.delete(onMessage)
          resolve(message)
        }

        timer = setTimeout(() => {
          listeners.delete(onMessage)
          reject(new Error(`Timed out waiting for WebSocket event at ${url}`))
        }, timeoutMs)

        listeners.add(onMessage)
      })
    },
    async waitForClose(timeoutMs = 5000): Promise<{ code: number, reason: string }> {
      if (closed) {
        return { code: closeCode, reason: closeReason }
      }

      return await Promise.race([
        closePromise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Timed out waiting for socket close at ${url}`)), timeoutMs)),
      ])
    },
    close(code?: number, reason?: string) {
      socket.close(code, reason)
    },
  }
}

describe('pty websocket live channels', () => {
  it('serves chat PTY over WebSocket with snapshot, ping, resize, output, reconnect, and session cleanup exit', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-pty-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    shutdownInfra()

    let app: ElysiaApp | undefined

    try {
      const started = await startServerApp()
      app = started.app
      await createCliTuiSession(started.baseUrl, workspaceRoot)

      const startRes = await fetch(`${started.baseUrl}/terminal-sessions/session-cli-tui/start-or-attach`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cols: 80, rows: 24 }),
      })
      expect(startRes.status).toBe(200)
      expect(await startRes.json()).toEqual({ sessionId: 'session-cli-tui', running: true })

      const socket1 = createSocketClient(toWebSocketUrl(started.baseUrl, '/terminal-sessions/session-cli-tui/socket'))
      await socket1.open
      const snapshot = await socket1.waitFor((message): message is Extract<PtyServerEvent, { type: 'snapshot' }> => message.type === 'snapshot')
      expect(snapshot.type).toBe('snapshot')
      expect(snapshot.running).toBe(true)

      if (!snapshot.buffer.includes('READY')) {
        const readyOutput = await socket1.waitFor((message): message is Extract<PtyServerEvent, { type: 'output' }> => message.type === 'output' && message.data.includes('READY'))
        expect(readyOutput.type).toBe('output')
      }

      socket1.close(1000, 'reconnect test')
      await socket1.waitForClose()

      const socket2 = createSocketClient(toWebSocketUrl(started.baseUrl, `/terminal-sessions/session-cli-tui/socket?fromSeq=${snapshot.seq}`))
      await socket2.open
      socket2.send({ type: 'ping' })
      await socket2.waitFor(message => message.type === 'pong')

      socket2.send({ type: 'resize', cols: 100, rows: 30 })
      socket2.send({ type: 'input', data: 'hello from websocket\n' })
      const output = await socket2.waitFor((message): message is Extract<PtyServerEvent, { type: 'output' }> => message.type === 'output' && message.data.includes('ECHO:hello from websocket'))
      expect(output.type).toBe('output')
      expect(output.data).toContain('ECHO:hello from websocket')

      const deleteSessionRes = await fetch(`${started.baseUrl}/sessions/session-cli-tui`, { method: 'DELETE' })
      expect(deleteSessionRes.status).toBe(200)

      const exit = await socket2.waitFor((message): message is Extract<PtyServerEvent, { type: 'exit' }> => message.type === 'exit')
      expect(exit.type).toBe('exit')
      await socket2.waitForClose()
    }
    finally {
      if (app?.server) {
        await app.stop()
      }
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

  it('keeps chat PTY running after the source agent is deleted because launch is session-owned', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-pty-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    shutdownInfra()

    let app: ElysiaApp | undefined

    try {
      const started = await startServerApp()
      app = started.app
      await createCliTuiSession(started.baseUrl, workspaceRoot)

      await fetch(`${started.baseUrl}/terminal-sessions/session-cli-tui/start-or-attach`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cols: 80, rows: 24 }),
      })

      const socket = createSocketClient(toWebSocketUrl(started.baseUrl, '/terminal-sessions/session-cli-tui/socket'))
      await socket.open
      await socket.waitFor(message => message.type === 'snapshot')
      await socket.waitFor((message): message is Extract<PtyServerEvent, { type: 'output' }> => message.type === 'output' && message.data.includes('READY'))

      const deleteAgentRes = await fetch(`${started.baseUrl}/agents/agent-cli-tui`, { method: 'DELETE' })
      expect(deleteAgentRes.status).toBe(200)
      expect(await deleteAgentRes.json()).toEqual({ ok: true })

      socket.send({ type: 'input', data: 'echo STILL_RUNNING_AFTER_AGENT_DELETE\n' })
      const output = await socket.waitFor((message): message is Extract<PtyServerEvent, { type: 'output' }> => message.type === 'output' && message.data.includes('STILL_RUNNING_AFTER_AGENT_DELETE'))
      expect(output.type).toBe('output')

      const retainedSession = db().select().from(sessions).where(eq(sessions.id, 'session-cli-tui')).get()
      expect(retainedSession).toEqual(expect.objectContaining({ id: 'session-cli-tui' }))

      const deleteSessionRes = await fetch(`${started.baseUrl}/sessions/session-cli-tui`, { method: 'DELETE' })
      expect(deleteSessionRes.status).toBe(200)
      const exit = await socket.waitFor((message): message is Extract<PtyServerEvent, { type: 'exit' }> => message.type === 'exit')
      expect(exit.type).toBe('exit')
      await socket.waitForClose()
    }
    finally {
      if (app?.server) {
        await app.stop()
      }
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

  it('stops shell PTY via explicit delete path and emits exit over the live channel', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-shell-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    shutdownInfra()

    let app: ElysiaApp | undefined

    try {
      const started = await startServerApp()
      app = started.app
      insertWorkspace('workspace-shell-explicit-delete', 'Workspace Shell Explicit Delete', workspaceRoot)

      const startRes = await fetch(`${started.baseUrl}/terminal-sessions/shell/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ptyId: 'shell-explicit-delete', cwd: workspaceRoot, cols: 80, rows: 24 }),
      })
      expect(startRes.status).toBe(200)
      expect(await startRes.json()).toEqual({ ptyId: 'shell-explicit-delete', running: true })

      const socket = createSocketClient(toWebSocketUrl(started.baseUrl, '/terminal-sessions/shell/shell-explicit-delete/socket'))
      await socket.open
      await socket.waitFor(message => message.type === 'snapshot')

      socket.send({ type: 'input', data: 'echo SHELL_DELETE_TEST\n' })
      const output = await socket.waitFor((message): message is Extract<PtyServerEvent, { type: 'output' }> => message.type === 'output' && message.data.includes('SHELL_DELETE_TEST'))
      expect(output.type).toBe('output')

      const deleteRes = await fetch(`${started.baseUrl}/terminal-sessions/shell/shell-explicit-delete`, { method: 'DELETE' })
      expect(deleteRes.status).toBe(200)
      expect(await deleteRes.json()).toEqual({ ok: true })

      const exit = await socket.waitFor((message): message is Extract<PtyServerEvent, { type: 'exit' }> => message.type === 'exit')
      expect(exit.type).toBe('exit')
      await socket.waitForClose()
    }
    finally {
      if (app?.server) {
        await app.stop()
      }
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

  it('expires orphaned shell PTY runtimes after abnormal WebSocket disconnects', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-shell-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousLeaseMs = process.env.CRADLE_PTY_SHELL_LEASE_MS
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_PTY_SHELL_LEASE_MS = '150'
    shutdownInfra()

    let app: ElysiaApp | undefined

    try {
      const started = await startServerApp()
      app = started.app
      insertWorkspace('workspace-shell-lease-expiry', 'Workspace Shell Lease Expiry', workspaceRoot)

      const startRes = await fetch(`${started.baseUrl}/terminal-sessions/shell/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ptyId: 'shell-lease-expiry', cwd: workspaceRoot, cols: 80, rows: 24 }),
      })
      expect(startRes.status).toBe(200)

      const socket1 = createSocketClient(toWebSocketUrl(started.baseUrl, '/terminal-sessions/shell/shell-lease-expiry/socket'))
      await socket1.open
      const snapshot = await socket1.waitFor((message): message is Extract<PtyServerEvent, { type: 'snapshot' }> => message.type === 'snapshot')
      expect(snapshot.type).toBe('snapshot')

      socket1.send({ type: 'input', data: 'echo SHELL_RECONNECT_OK\n' })
      const output = await socket1.waitFor((message): message is Extract<PtyServerEvent, { type: 'output' }> => message.type === 'output' && message.data.includes('SHELL_RECONNECT_OK'))
      expect(output.type).toBe('output')

      socket1.close(3001, 'abnormal disconnect simulation')
      await socket1.waitForClose()

      const socket2 = createSocketClient(toWebSocketUrl(started.baseUrl, `/terminal-sessions/shell/shell-lease-expiry/socket?fromSeq=${output.seq}`))
      await socket2.open
      socket2.send({ type: 'input', data: 'echo SHELL_REATTACHED\n' })
      const reattached = await socket2.waitFor((message): message is Extract<PtyServerEvent, { type: 'output' }> => message.type === 'output' && message.data.includes('SHELL_REATTACHED'))
      expect(reattached.type).toBe('output')

      socket2.close(1000, 'close without delete')
      await socket2.waitForClose()
      await wait(700)

      const socket3 = createSocketClient(toWebSocketUrl(started.baseUrl, '/terminal-sessions/shell/shell-lease-expiry/socket'))
      await socket3.open
      const error = await socket3.waitFor((message): message is Extract<PtyServerEvent, { type: 'error' }> => message.type === 'error')
      expect(error).toEqual({
        type: 'error',
        code: 'terminal_not_found',
        message: 'Shell session not found',
      })
      await socket3.waitForClose()
    }
    finally {
      if (app?.server) {
        await app.stop()
      }
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspaceRoot, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
      else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousLeaseMs === undefined) {
        delete process.env.CRADLE_PTY_SHELL_LEASE_MS
      }
      else {
        process.env.CRADLE_PTY_SHELL_LEASE_MS = previousLeaseMs
      }
    }
  })
})

function insertSessionRow(input: { id: string, workspaceId: string, title: string, providerTargetId?: string | null, agentId?: string | null, runtimeKind?: string, configJson?: string }): void {
  const now = Math.floor(Date.now() / 1000)
  db().run(sql`
    INSERT INTO sessions (id, workspace_id, title, provider_target_id, runtime_kind, agent_id, config_json, pinned, created_at, updated_at)
    VALUES (${input.id}, ${input.workspaceId}, ${input.title}, ${input.providerTargetId ?? null}, ${input.runtimeKind ?? 'standard'}, ${input.agentId ?? null}, ${input.configJson ?? '{}'}, 0, ${now}, ${now})
  `)
}

function insertAgentRow(input: { id: string, name: string, avatarStyle: string, avatarSeed: string, runtimeKind: string, configJson: string }): void {
  const now = Math.floor(Date.now() / 1000)
  db().run(sql`
    INSERT INTO agents (id, name, avatar_style, avatar_seed, runtime_kind, config_json, enabled, created_at, updated_at)
    VALUES (${input.id}, ${input.name}, ${input.avatarStyle}, ${input.avatarSeed}, ${input.runtimeKind}, ${input.configJson}, 1, ${now}, ${now})
  `)
}
