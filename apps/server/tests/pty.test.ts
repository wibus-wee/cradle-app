import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sessions, workspaces } from '@cradle/db'
import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'

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

async function createCliTuiSession(app: ElysiaApp, workspaceRoot: string, fixtureScript = TERMINAL_FIXTURE_SCRIPT) {
  const _app = app
  void _app
  db().insert(workspaces).values({
    id: 'workspace-pty',
    name: 'Workspace Pty',
    path: workspaceRoot,
  }).run()

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
      expect(await startRes.json()).toEqual({ sessionId: 'session-cli-tui', running: true })

      const attachAgainRes = await app.handle(new Request('http://localhost/terminal-sessions/session-cli-tui/start-or-attach', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cols: 100, rows: 30 }),
      }))
      expect(attachAgainRes.status).toBe(200)
      expect(await attachAgainRes.json()).toEqual({ sessionId: 'session-cli-tui', running: true })

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

  it('returns structured errors for invalid input and unsupported sessions', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const workspaceRoot = makeTempDir('cradle-pty-workspace-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    shutdownInfra()

    let app: ElysiaApp | undefined

    try {
      app = await createServerApp()
      db().insert(workspaces).values({
        id: 'workspace-pty',
        name: 'Workspace Pty',
        path: workspaceRoot,
      }).run()

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
