import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sessions, workspaces } from '@cradle/db'
import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import { workspaceFixture } from './helpers/workspace-fixture'

type ElysiaApp = Awaited<ReturnType<typeof createServerApp>>

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

async function createCliTuiSession(app: ElysiaApp, workspaceRoot: string, fixtureScript = TERMINAL_FIXTURE_SCRIPT) {
  const _app = app
  void _app
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
        args: ['-e', fixtureScript],
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
        args: ['-e', fixtureScript],
      },
    }),
  })
}

async function waitForSessionTitle(sessionId: string, title: string): Promise<void> {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    const session = db()
      .select({ title: sessions.title, titleSource: sessions.titleSource })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .get()
    if (session?.title === title && session.titleSource === 'provider') {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }

  const session = db()
    .select({ title: sessions.title, titleSource: sessions.titleSource })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .get()
  expect(session).toEqual({ title, titleSource: 'provider' })
}

describe('pty capability HTTP control plane', () => {
  it('starts a cli-tui terminal session and stops it via the HTTP control routes', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-pty-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    shutdownInfra()

    let app: ElysiaApp | undefined

    try {
      app = await createServerApp()
      await createCliTuiSession(app, workspaceRoot)

      const startRes = await app.handle(new Request('http://localhost/terminal-sessions/session-cli-tui/start-or-attach', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cols: 80, rows: 24 }),
      }))
      expect(startRes.status).toBe(200)
      expect(await startRes.json()).toMatchObject({
        sessionId: 'session-cli-tui',
        running: true,
        mode: 'fresh',
        restore: { mode: 'fresh' },
      })

      const hostRes = await app.handle(new Request('http://localhost/terminal-sessions/session-cli-tui/host'))
      expect(hostRes.status).toBe(200)
      expect(await hostRes.json()).toMatchObject({
        sessionId: 'session-cli-tui',
        role: 'cli-tui',
        running: true,
        phase: 'running',
        mode: 'fresh',
      })

      const attachAgainRes = await app.handle(new Request('http://localhost/terminal-sessions/session-cli-tui/start-or-attach', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cols: 100, rows: 30 }),
      }))
      expect(attachAgainRes.status).toBe(200)
      expect(await attachAgainRes.json()).toMatchObject({
        sessionId: 'session-cli-tui',
        running: true,
        mode: 'live-attach',
        restore: { mode: 'live-attach' },
      })

      const stopRes = await app.handle(new Request('http://localhost/terminal-sessions/session-cli-tui', { method: 'DELETE' }))
      expect(stopRes.status).toBe(200)
      expect(await stopRes.json()).toEqual({ ok: true })
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

  it('updates cli-tui session title from terminal OSC title metadata', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-pty-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    shutdownInfra()

    let app: ElysiaApp | undefined

    try {
      app = await createServerApp()
      await createCliTuiSession(app, workspaceRoot, [
        'process.stdout.write(\'\\x1B]0;Runtime Named Session\\x07READY\\n\')',
        'setInterval(() => {}, 1000)',
      ].join(';'))

      const startRes = await app.handle(new Request('http://localhost/terminal-sessions/session-cli-tui/start-or-attach', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cols: 80, rows: 24 }),
      }))
      expect(startRes.status).toBe(200)

      await waitForSessionTitle('session-cli-tui', 'Runtime Named Session')

      const stopRes = await app.handle(new Request('http://localhost/terminal-sessions/session-cli-tui', { method: 'DELETE' }))
      expect(stopRes.status).toBe(200)
    }
    finally {
      if (app) {
        await app.handle(new Request('http://localhost/terminal-sessions/session-cli-tui', { method: 'DELETE' }))
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

  it('lists terminal resource snapshots for bottom panel terminals', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-pty-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    shutdownInfra()

    let app: ElysiaApp | undefined

    try {
      app = await createServerApp()
      insertWorkspace('workspace-resource-panel', 'Workspace Resource Panel', workspaceRoot)

      const startRes = await app.handle(new Request('http://localhost/terminal-sessions/shell/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ptyId: 'resource-panel', cwd: workspaceRoot, cols: 120, rows: 32 }),
      }))
      expect(startRes.status).toBe(200)
      expect(await startRes.json()).toEqual({ ptyId: 'resource-panel', running: true })

      const resourcesRes = await app.handle(new Request('http://localhost/terminal-sessions/resources'))
      expect(resourcesRes.status).toBe(200)

      const resources = await resourcesRes.json() as {
        terminals: Array<{
          id: string
          role: 'cli-tui' | 'bottom-panel'
          pid: number
          executable: string
          cwd: string
          running: boolean
          startedAt: number
          cols: number
          rows: number
          rssMB: number | null
          cpuPercent: number | null
          descendantCount: number | null
        }>
        totals: {
          cliTuiRssMB: number
          bottomPanelRssMB: number
          cliTuiCpuPercent: number
          bottomPanelCpuPercent: number
        }
        timestamp: number
      }

      const terminal = resources.terminals.find(item => item.id === 'resource-panel')
      expect(terminal).toEqual(expect.objectContaining({
        id: 'resource-panel',
        role: 'bottom-panel',
        cwd: workspaceRoot,
        running: true,
        cols: 120,
        rows: 32,
      }))
      expect(terminal?.pid).toBeGreaterThan(0)
      expect(terminal?.executable.length).toBeGreaterThan(0)
      expect(terminal?.startedAt).toBeGreaterThan(0)
      expect(resources.timestamp).toBeGreaterThan(0)
      expect(resources.totals.cliTuiRssMB).toBe(0)
      expect(resources.totals.cliTuiCpuPercent).toBe(0)
      expect(resources.totals.bottomPanelRssMB).toBeGreaterThanOrEqual(0)
      expect(resources.totals.bottomPanelCpuPercent).toBeGreaterThanOrEqual(0)
      if (terminal?.rssMB !== null && terminal?.rssMB !== undefined) {
        expect(terminal.rssMB).toBeGreaterThanOrEqual(0)
        expect(resources.totals.bottomPanelRssMB).toBeGreaterThanOrEqual(terminal.rssMB)
      }
      if (terminal?.cpuPercent !== null && terminal?.cpuPercent !== undefined) {
        expect(terminal.cpuPercent).toBeGreaterThanOrEqual(0)
        expect(resources.totals.bottomPanelCpuPercent).toBeGreaterThanOrEqual(terminal.cpuPercent)
      }
      if (terminal?.descendantCount !== null && terminal?.descendantCount !== undefined) {
        expect(terminal.descendantCount).toBeGreaterThanOrEqual(0)
      }

      const stopRes = await app.handle(new Request('http://localhost/terminal-sessions/shell/resource-panel', { method: 'DELETE' }))
      expect(stopRes.status).toBe(200)
      expect(await stopRes.json()).toEqual({ ok: true })
    }
    finally {
      if (app) {
        await app.handle(new Request('http://localhost/terminal-sessions/shell/resource-panel', { method: 'DELETE' }))
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

  it('constrains bottom panel terminal cwd to registered workspace roots', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-pty-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    shutdownInfra()

    let app: ElysiaApp | undefined

    try {
      app = await createServerApp()
      insertWorkspace('workspace-shell-boundary', 'Workspace Shell Boundary', workspaceRoot)

      const rejected = await app.handle(new Request('http://localhost/terminal-sessions/shell/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ptyId: 'cwd-rejected', cwd: '/', cols: 80, rows: 24 }),
      }))
      expect(rejected.status).toBe(403)
      expect((await rejected.json()).code).toBe('terminal_shell_cwd_outside_allowed_roots')

      const accepted = await app.handle(new Request('http://localhost/terminal-sessions/shell/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ptyId: 'cwd-accepted', cwd: workspaceRoot, cols: 80, rows: 24 }),
      }))
      expect(accepted.status).toBe(200)
      expect(await accepted.json()).toEqual({ ptyId: 'cwd-accepted', running: true })

      const stopRes = await app.handle(new Request('http://localhost/terminal-sessions/shell/cwd-accepted', { method: 'DELETE' }))
      expect(stopRes.status).toBe(200)
    }
    finally {
      if (app) {
        await app.handle(new Request('http://localhost/terminal-sessions/shell/cwd-accepted', { method: 'DELETE' }))
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

  it('returns structured errors for invalid input and unsupported sessions', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-pty-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    shutdownInfra()

    let app: ElysiaApp | undefined

    try {
      app = await createServerApp()
      insertWorkspace('workspace-pty', 'Workspace Pty', workspaceRoot)

      insertSessionRow({
        id: 'session-non-cli',
        workspaceId: 'workspace-pty',
        title: 'Non CLI Session',
      })

      const missingSession = await app.handle(new Request('http://localhost/terminal-sessions/missing/start-or-attach', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cols: 80, rows: 24 }),
      }))
      expect(missingSession.status).toBe(404)
      expect((await missingSession.json()).code).toBe('terminal_session_not_found')

      const invalidInput = await app.handle(new Request('http://localhost/terminal-sessions/session-non-cli/start-or-attach', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }))
      expect(invalidInput.status).toBe(400)
      expect((await invalidInput.json()).code).toBe('validation_error')

      const unsupportedProfile = await app.handle(new Request('http://localhost/terminal-sessions/session-non-cli/start-or-attach', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cols: 80, rows: 24 }),
      }))
      expect(unsupportedProfile.status).toBe(409)
      expect((await unsupportedProfile.json()).code).toBe('terminal_profile_not_supported')
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

  it('reports and clears provider session bindings for CLI TUI resume', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-pty-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    shutdownInfra()

    let app: ElysiaApp | undefined

    try {
      app = await createServerApp()
      await createCliTuiSession(app, workspaceRoot)

      const reportRes = await app.handle(new Request('http://localhost/terminal-sessions/session-cli-tui/provider-session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: 'cradle:opencode',
          agent: 'opencode',
          kind: 'id',
          value: '019e3c07-d7df-73d2-a3dc-dfaf5f883050',
        }),
      }))
      expect(reportRes.status).toBe(200)
      const reported = await reportRes.json() as {
        sessionId: string
        providerSession: { agent: string, value: string, workspacePath: string }
      }
      expect(reported.sessionId).toBe('session-cli-tui')
      expect(reported.providerSession).toMatchObject({
        agent: 'opencode',
        value: '019e3c07-d7df-73d2-a3dc-dfaf5f883050',
        workspacePath: workspaceRoot,
      })

      const getRes = await app.handle(new Request('http://localhost/terminal-sessions/session-cli-tui/provider-session'))
      expect(getRes.status).toBe(200)
      expect(await getRes.json()).toMatchObject({
        sessionId: 'session-cli-tui',
        providerSession: {
          agent: 'opencode',
          value: '019e3c07-d7df-73d2-a3dc-dfaf5f883050',
        },
      })

      const clearRes = await app.handle(new Request('http://localhost/terminal-sessions/session-cli-tui/provider-session', {
        method: 'DELETE',
      }))
      expect(clearRes.status).toBe(200)
      expect(await clearRes.json()).toEqual({
        sessionId: 'session-cli-tui',
        providerSession: null,
      })

      const invalidRes = await app.handle(new Request('http://localhost/terminal-sessions/session-cli-tui/provider-session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: 'evil:opencode',
          agent: 'opencode',
          value: 'nope',
        }),
      }))
      expect(invalidRes.status).toBe(400)
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

  it('seeds durable history on fresh launch when enabled', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-pty-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousHistory = process.env.CRADLE_TERMINAL_HISTORY
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_TERMINAL_HISTORY = '1'
    shutdownInfra()

    let app: ElysiaApp | undefined

    try {
      app = await createServerApp()
      await createCliTuiSession(app, workspaceRoot)

      const startRes = await app.handle(new Request('http://localhost/terminal-sessions/session-cli-tui/start-or-attach', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cols: 80, rows: 24 }),
      }))
      expect(startRes.status).toBe(200)

      // Write history as if a prior process exited with screen contents.
      const historyDir = `${dataDir}/terminal-history`
      const { mkdirSync, writeFileSync } = await import('node:fs')
      mkdirSync(historyDir, { recursive: true })
      writeFileSync(`${historyDir}/session-cli-tui.json`, JSON.stringify({
        version: 1,
        sessionId: 'session-cli-tui',
        ansi: 'PRIOR SCREEN\r\n',
        lines: 1,
        capturedAt: Math.floor(Date.now() / 1000),
      }))

      // Destroy runtime without deleting history, then start again.
      const stopRes = await app.handle(new Request('http://localhost/terminal-sessions/session-cli-tui', { method: 'DELETE' }))
      expect(stopRes.status).toBe(200)

      // Kill is async; wait until host reports the process is gone.
      const deadline = Date.now() + 3000
      while (Date.now() < deadline) {
        const host = await app.handle(new Request('http://localhost/terminal-sessions/session-cli-tui/host'))
        const body = await host.json() as { running: boolean }
        if (!body.running) {
          break
        }
        await new Promise(resolve => setTimeout(resolve, 50))
      }

      // Re-seed history after stop (stop may overwrite empty buffer).
      writeFileSync(`${historyDir}/session-cli-tui.json`, JSON.stringify({
        version: 1,
        sessionId: 'session-cli-tui',
        ansi: 'PRIOR SCREEN\r\n',
        lines: 1,
        capturedAt: Math.floor(Date.now() / 1000),
      }))

      const restartRes = await app.handle(new Request('http://localhost/terminal-sessions/session-cli-tui/start-or-attach', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cols: 80, rows: 24 }),
      }))
      expect(restartRes.status).toBe(200)
      const restarted = await restartRes.json() as { mode: string, restore?: { mode: string } }
      expect(restarted.mode).toBe('fresh')
      expect(restarted.restore?.mode).toBe('history')

      const hostRes = await app.handle(new Request('http://localhost/terminal-sessions/session-cli-tui/host'))
      expect(hostRes.status).toBe(200)
      expect(await hostRes.json()).toMatchObject({
        historyEnabled: true,
        hasHistory: true,
        mode: 'history',
      })
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
      if (previousHistory === undefined) {
        delete process.env.CRADLE_TERMINAL_HISTORY
      }
      else {
        process.env.CRADLE_TERMINAL_HISTORY = previousHistory
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
