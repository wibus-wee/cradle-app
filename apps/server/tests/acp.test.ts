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
        code: 'acp_binary_integrity_metadata_missing',
        message: 'ACP binary installation requires a trusted publisher checksum, but the registry does not provide one',
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
})
