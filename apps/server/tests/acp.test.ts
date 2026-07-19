import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createServerApp } from '../src/app'
import { shutdownInfra } from '../src/infra'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('acp capability', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches registry data, installs an npx agent, exposes audit history, and uninstalls it', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new Request(input).url
      expect(url).toBe('https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json')
      return new Response(JSON.stringify({
        version: '1',
        agents: [
          {
            id: 'demo-agent',
            name: 'Demo Agent',
            version: '1.2.3',
            description: 'ACP demo agent',
            distribution: {
              npx: {
                package: '@demo/agent',
                args: ['--stdio'],
                env: { DEMO_MODE: '1' },
              },
            },
          },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const registryRes = await app.handle(new Request('http://localhost/acp/registry'))
      expect(registryRes.status).toBe(200)
      expect(await registryRes.json()).toEqual([
        expect.objectContaining({ id: 'demo-agent', name: 'Demo Agent', version: '1.2.3' }),
      ])

      const distributionRes = await app.handle(new Request('http://localhost/acp/registry/demo-agent/distribution-types'))
      expect(distributionRes.status).toBe(200)
      expect(await distributionRes.json()).toEqual({ agentId: 'demo-agent', types: ['npx'] })

      const installRes = await app.handle(new Request('http://localhost/acp/agents/demo-agent/installation', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ distributionType: 'npx' }),
      }))
      expect(installRes.status).toBe(200)
      expect(await installRes.json()).toEqual(expect.objectContaining({
        id: 'demo-agent',
        distributionType: 'npx',
        status: 'installed',
        cmd: '@demo/agent',
      }))

      const listInstalledRes = await app.handle(new Request('http://localhost/acp/agents'))
      expect(listInstalledRes.status).toBe(200)
      expect(await listInstalledRes.json()).toEqual([
        expect.objectContaining({ id: 'demo-agent', status: 'installed' }),
      ])

      const getInstalledRes = await app.handle(new Request('http://localhost/acp/agents/demo-agent'))
      expect(getInstalledRes.status).toBe(200)
      expect(await getInstalledRes.json()).toEqual(expect.objectContaining({ id: 'demo-agent', status: 'installed' }))

      const installPathRes = await app.handle(new Request('http://localhost/acp/agents/demo-agent/install-path'))
      expect(installPathRes.status).toBe(200)
      expect(await installPathRes.json()).toEqual({ path: expect.stringContaining('/acp/agents/demo-agent') })

      const auditRes = await app.handle(new Request('http://localhost/acp/audit?agentId=demo-agent'))
      expect(auditRes.status).toBe(200)
      const auditEntries = await auditRes.json() as Array<{ action: string }>
      expect(auditEntries.map(entry => entry.action)).toEqual(expect.arrayContaining(['install_start', 'install_complete']))

      const uninstallRes = await app.handle(new Request('http://localhost/acp/agents/demo-agent', { method: 'DELETE' }))
      expect(uninstallRes.status).toBe(200)
      expect(await uninstallRes.json()).toEqual({ ok: true })

      const afterDeleteRes = await app.handle(new Request('http://localhost/acp/agents/demo-agent'))
      expect(afterDeleteRes.status).toBe(404)

      const auditAfterDeleteRes = await app.handle(new Request('http://localhost/acp/audit?agentId=demo-agent'))
      expect(auditAfterDeleteRes.status).toBe(200)
      const auditAfterDelete = await auditAfterDeleteRes.json() as Array<{ action: string }>
      expect(auditAfterDelete.map(entry => entry.action)).toEqual(expect.arrayContaining([
        'install_start',
        'install_complete',
        'uninstall_start',
        'uninstall_complete',
      ]))

      expect(fetchSpy).toHaveBeenCalled()
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
    }
  })

  it('returns structured errors for invalid input, missing agents, and disabled binary installs', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({
        version: '1',
        agents: [
          {
            id: 'demo-agent',
            name: 'Demo Agent',
            version: '1.2.3',
            description: 'ACP demo agent',
            distribution: {
              npx: { package: '@demo/agent' },
            },
          },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const invalidInstallRes = await app.handle(new Request('http://localhost/acp/agents/demo-agent/installation', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }))
      expect(invalidInstallRes.status).toBe(400)
      expect((await invalidInstallRes.json()).code).toBe('validation_error')

      const missingAgentRes = await app.handle(new Request('http://localhost/acp/agents/missing-agent/installation', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ distributionType: 'npx' }),
      }))
      expect(missingAgentRes.status).toBe(404)
      expect((await missingAgentRes.json()).code).toBe('acp_agent_not_found')

      const binaryInstallRes = await app.handle(new Request('http://localhost/acp/agents/demo-agent/installation', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ distributionType: 'binary' }),
      }))
      expect(binaryInstallRes.status).toBe(409)
      expect(await binaryInstallRes.json()).toMatchObject({
        code: 'acp_distribution_not_supported',
        message: 'Requested ACP distribution is not supported for this agent on the current platform',
      })
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
    }
  })

  it('registers a local agent, rejects registry install, updates base launch, and uninstalls without FS binary cleanup', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()

      const createRes = await app.handle(new Request('http://localhost/acp/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'local-echo',
          name: 'Local Echo',
          cmd: '/bin/echo',
          args: ['--acp'],
          env: { LOCAL_FLAG: '1' },
          distributionType: 'command',
        }),
      }))
      expect(createRes.status).toBe(200)
      expect(await createRes.json()).toEqual(expect.objectContaining({
        id: 'local-echo',
        name: 'Local Echo',
        source: 'local',
        distributionType: 'command',
        status: 'installed',
        cmd: '/bin/echo',
        args: JSON.stringify(['--acp']),
        env: JSON.stringify({ LOCAL_FLAG: '1' }),
        overrideCmd: null,
        overrideArgs: null,
        overrideEnv: null,
        installPath: null,
        version: 'local',
      }))

      const conflictRes = await app.handle(new Request('http://localhost/acp/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'local-echo',
          name: 'Dup',
          cmd: '/bin/true',
        }),
      }))
      expect(conflictRes.status).toBe(409)
      expect((await conflictRes.json()).code).toBe('acp_agent_id_conflict')

      const installLocalRes = await app.handle(new Request('http://localhost/acp/agents/local-echo/installation', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ distributionType: 'npx' }),
      }))
      expect(installLocalRes.status).toBe(409)
      expect((await installLocalRes.json()).code).toBe('acp_local_not_installable')

      const overrideOnLocalRes = await app.handle(new Request('http://localhost/acp/agents/local-echo/launch-config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ overrideCmd: 'nope' }),
      }))
      expect(overrideOnLocalRes.status).toBe(400)

      const patchRes = await app.handle(new Request('http://localhost/acp/agents/local-echo/launch-config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Local Echo Updated',
          cmd: '/bin/cat',
          args: ['--stdio'],
          env: { LOCAL_FLAG: '2' },
        }),
      }))
      expect(patchRes.status).toBe(200)
      expect(await patchRes.json()).toEqual(expect.objectContaining({
        id: 'local-echo',
        name: 'Local Echo Updated',
        cmd: '/bin/cat',
        args: JSON.stringify(['--stdio']),
        env: JSON.stringify({ LOCAL_FLAG: '2' }),
        source: 'local',
      }))

      const listRes = await app.handle(new Request('http://localhost/acp/agents'))
      expect(listRes.status).toBe(200)
      expect(await listRes.json()).toEqual([
        expect.objectContaining({ id: 'local-echo', source: 'local' }),
      ])

      const auditRes = await app.handle(new Request('http://localhost/acp/audit?agentId=local-echo'))
      expect(auditRes.status).toBe(200)
      const audit = await auditRes.json() as Array<{ action: string, details: string }>
      expect(audit.map(e => e.action)).toEqual(expect.arrayContaining(['local_register', 'local_update']))
      for (const entry of audit) {
        // keys may appear in envKeys; secret values must never be stored
        expect(entry.details).not.toContain('"1"')
        expect(entry.details).not.toContain('"2"')
        expect(entry.details).not.toMatch(/"LOCAL_FLAG"\s*:\s*"/)
        const parsed = JSON.parse(entry.details) as { envKeys?: string[] }
        if (parsed.envKeys) {
          expect(Array.isArray(parsed.envKeys)).toBe(true)
        }
      }

      const uninstallRes = await app.handle(new Request('http://localhost/acp/agents/local-echo', { method: 'DELETE' }))
      expect(uninstallRes.status).toBe(200)
      expect(await uninstallRes.json()).toEqual({ ok: true })

      const afterDelete = await app.handle(new Request('http://localhost/acp/agents/local-echo'))
      expect(afterDelete.status).toBe(404)
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
    }
  })

  it('sets registry launch overrides and preserves them across reinstall', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new Request(input).url
      expect(url).toBe('https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json')
      return new Response(JSON.stringify({
        version: '1',
        agents: [
          {
            id: 'demo-agent',
            name: 'Demo Agent',
            version: '1.2.3',
            description: 'ACP demo agent',
            distribution: {
              npx: {
                package: '@demo/agent',
                args: ['--stdio'],
                env: { DEMO_MODE: '1' },
              },
            },
          },
        ],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()

      const installRes = await app.handle(new Request('http://localhost/acp/agents/demo-agent/installation', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ distributionType: 'npx' }),
      }))
      expect(installRes.status).toBe(200)

      const baseFieldsOnRegistry = await app.handle(new Request('http://localhost/acp/agents/demo-agent/launch-config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cmd: 'should-fail' }),
      }))
      expect(baseFieldsOnRegistry.status).toBe(400)

      const absOverride = await app.handle(new Request('http://localhost/acp/agents/demo-agent/launch-config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ overrideCmd: '/usr/bin/evil' }),
      }))
      expect(absOverride.status).toBe(400)

      const patchRes = await app.handle(new Request('http://localhost/acp/agents/demo-agent/launch-config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          overrideArgs: ['--stdio', '--debug'],
          overrideEnv: { FOO: 'bar' },
        }),
      }))
      expect(patchRes.status).toBe(200)
      const patched = await patchRes.json() as {
        cmd: string
        args: string
        env: string
        overrideArgs: string
        overrideEnv: string
        source: string
      }
      expect(patched).toEqual(expect.objectContaining({
        source: 'registry',
        cmd: '@demo/agent',
        args: JSON.stringify(['--stdio']),
        env: JSON.stringify({ DEMO_MODE: '1' }),
        overrideArgs: JSON.stringify(['--stdio', '--debug']),
        overrideEnv: JSON.stringify({ FOO: 'bar' }),
      }))

      const reinstallRes = await app.handle(new Request('http://localhost/acp/agents/demo-agent/installation', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ distributionType: 'npx' }),
      }))
      expect(reinstallRes.status).toBe(200)
      const reinstalled = await reinstallRes.json() as {
        overrideArgs: string | null
        overrideEnv: string | null
        cmd: string
        args: string
        env: string
        source: string
      }
      expect(reinstalled.source).toBe('registry')
      expect(reinstalled.cmd).toBe('@demo/agent')
      expect(reinstalled.args).toBe(JSON.stringify(['--stdio']))
      expect(reinstalled.env).toBe(JSON.stringify({ DEMO_MODE: '1' }))
      expect(reinstalled.overrideArgs).toBe(JSON.stringify(['--stdio', '--debug']))
      expect(reinstalled.overrideEnv).toBe(JSON.stringify({ FOO: 'bar' }))

      const clearRes = await app.handle(new Request('http://localhost/acp/agents/demo-agent/launch-config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ overrideArgs: null, overrideEnv: null }),
      }))
      expect(clearRes.status).toBe(200)
      expect(await clearRes.json()).toEqual(expect.objectContaining({
        overrideArgs: null,
        overrideEnv: null,
      }))

      const auditRes = await app.handle(new Request('http://localhost/acp/audit?agentId=demo-agent'))
      const audit = await auditRes.json() as Array<{ action: string, details: string }>
      expect(audit.map(e => e.action)).toEqual(expect.arrayContaining(['launch_override_update']))
      for (const entry of audit.filter(e => e.action === 'launch_override_update')) {
        expect(entry.details).not.toContain('bar')
        expect(entry.details).not.toContain('secret')
      }

      expect(fetchSpy).toHaveBeenCalled()
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
    }
  })
})
