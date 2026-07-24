import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { McpServerConfig } from '@cradle/plugin-sdk/server'
import { afterEach, describe, expect, it } from 'vitest'

import { CustomMcpServerService } from './service'

describe('custom MCP server service', () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(directory =>
      rm(directory, { recursive: true, force: true })))
  })

  it('persists metadata, keeps sensitive values in the secret store, and rehydrates the runtime registry', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cradle-mcp-servers-'))
    temporaryDirectories.push(directory)
    const secrets = new Map<string, string>()
    let sequence = 0
    let projected: McpServerConfig[] = []
    const options = {
      filePath: join(directory, 'servers.json'),
      secrets: {
        saveSecret: (input: { secret: string }) => {
          const id = `secret-${++sequence}`
          secrets.set(id, input.secret)
          return {
            id,
            kind: 'mcp-server',
            label: 'MCP server',
            maskedSecret: '...ret',
            createdAt: 1,
            updatedAt: 1,
          }
        },
        upsertSecret: (input: { id: string, secret: string }) => {
          secrets.set(input.id, input.secret)
          return {
            id: input.id,
            kind: 'mcp-server',
            label: 'MCP server',
            maskedSecret: '...ret',
            createdAt: 1,
            updatedAt: 1,
          }
        },
        readSecret: (id: string) => {
          const secret = secrets.get(id)
          if (!secret) { throw new Error('Secret not found') }
          return secret
        },
        removeSecret: (id: string) => {
          secrets.delete(id)
        },
      },
      registry: {
        clear: () => {
          projected = []
        },
        hasHost: () => false,
        replace: (configs: McpServerConfig[]) => {
          projected = configs
        },
      },
    }

    const service = new CustomMcpServerService(options)
    const created = await service.create({
      transport: 'stdio',
      name: 'browser',
      enabled: true,
      command: 'node',
      args: ['server.js'],
      secretValues: { TOKEN: 'top-secret' },
    })

    expect(created.secretKeys).toEqual(['TOKEN'])
    expect(JSON.stringify(created)).not.toContain('top-secret')
    expect(projected).toEqual([{
      transport: 'stdio',
      name: 'browser',
      command: 'node',
      args: ['server.js'],
      env: { TOKEN: 'top-secret' },
    }])

    const rehydrated = new CustomMcpServerService(options)
    expect(await rehydrated.list()).toEqual([expect.objectContaining({
      id: created.id,
      name: 'browser',
      status: 'ready',
      secretKeys: ['TOKEN'],
    })])

    secrets.delete('secret-1')
    const repaired = await rehydrated.update(created.id, {
      transport: 'stdio',
      name: 'browser',
      enabled: true,
      command: 'node',
      args: ['server.js'],
      secretValues: { TOKEN: 'replacement-secret' },
    })
    expect(repaired.secretKeys).toEqual(['TOKEN'])
    expect(projected[0]).toEqual(expect.objectContaining({ env: { TOKEN: 'replacement-secret' } }))

    const disabled = await rehydrated.setEnabled(created.id, false)
    expect(disabled.status).toBe('disabled')
    expect(disabled.secretKeys).toEqual(['TOKEN'])
    expect(projected).toEqual([])
    await rehydrated.remove(created.id)
    expect(secrets.size).toBe(0)
  })

  it('rolls back a newly created secret when metadata persistence fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cradle-mcp-servers-'))
    temporaryDirectories.push(directory)
    const secrets = new Map<string, string>()
    const filePath = join(directory, 'blocked', 'servers.json')
    const service = new CustomMcpServerService({
      filePath,
      secrets: {
        saveSecret: ({ secret }: { secret: string }) => {
          secrets.set('secret-1', secret)
          return {
            id: 'secret-1',
            kind: 'mcp-server',
            label: 'MCP server',
            maskedSecret: '...ret',
            createdAt: 1,
            updatedAt: 1,
          }
        },
        upsertSecret: input => ({
          id: input.id,
          kind: input.kind,
          label: input.label,
          maskedSecret: '...ret',
          createdAt: 1,
          updatedAt: 1,
        }),
        readSecret: id => secrets.get(id) ?? '',
        removeSecret: id => void secrets.delete(id),
      },
      registry: {
        clear: () => {},
        hasHost: () => false,
        replace: () => {},
      },
    })

    await service.list()
    await writeFile(join(directory, 'blocked'), 'not-a-directory')

    await expect(service.create({
      transport: 'stdio',
      name: 'browser',
      enabled: true,
      command: 'node',
      args: ['server.js'],
      secretValues: { TOKEN: 'top-secret' },
    })).rejects.toThrow()
    expect(secrets.size).toBe(0)
    expect(await service.list()).toEqual([])

    await rm(join(directory, 'blocked'), { force: true })
    const created = await service.create({
      transport: 'stdio',
      name: 'browser',
      enabled: true,
      command: 'node',
      args: ['server.js'],
      secretValues: { TOKEN: 'top-secret' },
    })
    await rm(join(directory, 'blocked'), { recursive: true, force: true })
    await writeFile(join(directory, 'blocked'), 'not-a-directory')

    await expect(service.update(created.id, {
      transport: 'stdio',
      name: 'browser',
      enabled: true,
      command: 'node',
      args: ['updated-server.js'],
    })).rejects.toThrow()
    expect(secrets.size).toBe(1)
    expect(await service.list()).toEqual([expect.objectContaining({
      id: created.id,
      command: 'node',
      args: ['server.js'],
      secretKeys: ['TOKEN'],
    })])
  })
})
