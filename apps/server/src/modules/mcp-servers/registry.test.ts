import { describe, expect, it } from 'vitest'

import type { RegistryCacheStore } from './registry'
import { McpRegistryService } from './registry'

function createMemoryCache(): RegistryCacheStore & { entries: Map<string, { value: string, expiresAt: number }> } {
  const entries = new Map<string, { value: string, expiresAt: number }>()
  return {
    entries,
    read: key => entries.get(key) ?? null,
    write: (key, value, expiresAt) => { entries.set(key, { value, expiresAt }) },
  }
}

function registryResponse(servers: unknown[], nextCursor?: string) {
  return {
    servers,
    metadata: { nextCursor },
  }
}

function officialEntry(server: Record<string, unknown>, official?: Record<string, unknown>) {
  return {
    server,
    _meta: {
      'io.modelcontextprotocol.registry/official': {
        status: 'active',
        isLatest: true,
        publishedAt: '2026-01-01T00:00:00.000Z',
        ...official,
      },
    },
  }
}

function mockFetch(payload: unknown, calls: string[]) {
  return (async (input: RequestInfo | URL) => {
    calls.push(String(input))
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
}

describe('mCP registry service', () => {
  it('maps streamable-http remotes to install hints', async () => {
    const calls: string[] = []
    const service = new McpRegistryService(mockFetch(registryResponse([
      officialEntry({
        name: 'io.github.example/remote',
        title: 'Remote',
        description: 'A remote server',
        version: '1.0.0',
        remotes: [{ type: 'streamable-http', url: 'https://mcp.example.com' }],
      }),
    ]), calls), createMemoryCache())

    const page = await service.search({})
    expect(page.servers).toHaveLength(1)
    expect(page.servers[0]).toMatchObject({
      name: 'io.github.example/remote',
      title: 'Remote',
      packageRegistry: null,
      installHint: { transport: 'streamable-http', url: 'https://mcp.example.com' },
    })
    expect(calls[0]).toContain('limit=50')
  })

  it('maps npm packages to npx stdio hints and exposes env metadata', async () => {
    const service = new McpRegistryService(mockFetch(registryResponse([
      officialEntry({
        name: 'io.github.example/local',
        packages: [{
          registryType: 'npm',
          identifier: '@example/mcp-server',
          packageArguments: [{ type: 'positional', value: '--stdio' }],
          environmentVariables: [
            { name: 'API_KEY', description: 'Access token', required: true },
          ],
        }],
      }),
    ]), []), createMemoryCache())

    const page = await service.search({})
    expect(page.servers[0]).toMatchObject({
      packageRegistry: 'npm',
      env: [{ name: 'API_KEY', description: 'Access token', required: true }],
      installHint: {
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@example/mcp-server', '--stdio'],
      },
    })
  })

  it('skips templated argument values', async () => {
    const service = new McpRegistryService(mockFetch(registryResponse([
      officialEntry({
        name: 'io.github.example/templated',
        packages: [{
          registryType: 'pypi',
          identifier: 'example-mcp',
          runtimeArguments: [
            { type: 'positional', value: '--dir' },
            { type: 'positional', value: '{workspace}' },
          ],
        }],
      }),
    ]), []), createMemoryCache())

    const page = await service.search({})
    expect(page.servers[0].installHint).toEqual({
      transport: 'stdio',
      command: 'uvx',
      args: ['example-mcp', '--dir'],
    })
  })

  it('filters out non-latest and inactive entries', async () => {
    const service = new McpRegistryService(mockFetch(registryResponse([
      officialEntry({ name: 'a.example/old' }, { isLatest: false }),
      officialEntry({ name: 'a.example/deprecated' }, { status: 'deprecated' }),
      officialEntry({
        name: 'a.example/current',
        remotes: [{ type: 'streamable-http', url: 'https://mcp.example.com' }],
      }),
    ]), []), createMemoryCache())

    const page = await service.search({})
    expect(page.servers.map(server => server.name)).toEqual(['a.example/current'])
  })

  it('marks servers without a supported install path as not installable', async () => {
    const service = new McpRegistryService(mockFetch(registryResponse([
      officialEntry({
        name: 'a.example/nuget',
        packages: [{ registryType: 'nuget', identifier: 'Example.Mcp' }],
      }),
    ]), []), createMemoryCache())

    const page = await service.search({})
    expect(page.servers[0].installHint).toBeNull()
  })

  it('passes search and cursor through and caches repeated queries', async () => {
    const calls: string[] = []
    const service = new McpRegistryService(mockFetch(registryResponse([], 'next-page'), calls))

    await service.search({ search: 'github' })
    await service.search({ search: 'github' })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('search=github')

    await service.search({ search: 'github', cursor: 'next-page' })
    expect(calls).toHaveLength(2)
    expect(calls[1]).toContain('cursor=next-page')
  })

  it('serves the stale cached page when the upstream fails after expiry', async () => {
    const cache = createMemoryCache()
    const payload = registryResponse([
      officialEntry({
        name: 'a.example/stale',
        remotes: [{ type: 'streamable-http', url: 'https://mcp.example.com' }],
      }),
    ])
    cache.write(`mcp-registry:servers:${JSON.stringify(['', ''])}`, JSON.stringify(payload), 1)

    const failingFetch = (async () => new Response('nope', { status: 503 })) as typeof fetch
    const service = new McpRegistryService(failingFetch, cache)

    const page = await service.search({})
    expect(page.servers.map(server => server.name)).toEqual(['a.example/stale'])
  })

  it('surfaces upstream failures as mcp_registry_unavailable', async () => {
    const failingFetch = (async () => new Response('nope', { status: 503 })) as typeof fetch
    const service = new McpRegistryService(failingFetch, createMemoryCache())

    await expect(service.search({})).rejects.toMatchObject({
      code: 'mcp_registry_unavailable',
      status: 502,
    })
  })
})
