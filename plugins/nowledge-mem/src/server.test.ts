import type {
  Disposable,
  PluginManifest,
  PluginUninstallHandler,
  ServerPluginContext,
  ServerPluginRouteContext,
  ServerPluginRouteRegistration,
} from '@cradle/plugin-sdk/server'
import { describe, expect, it } from 'vitest'

import { activate } from './server'

interface McpRegistration {
  config: Parameters<ServerPluginContext['mcp']['registerServer']>[0]
  disposed: boolean
}

function createPluginContext(sharedConfig = new Map<string, string>()): {
  ctx: ServerPluginContext
  routes: ServerPluginRouteRegistration[]
  storage: Map<string, string>
  secrets: Map<string, string>
  skills: Array<{ name: string, description: string, skillFile: string }>
  mcpRegistrations: McpRegistration[]
  uninstallHandlers: PluginUninstallHandler[]
} {
  const routes: ServerPluginRouteRegistration[] = []
  const storage = new Map<string, string>()
  const secrets = new Map<string, string>()
  const skills: Array<{ name: string, description: string, skillFile: string }> = []
  const mcpRegistrations: McpRegistration[] = []
  const uninstallHandlers: PluginUninstallHandler[] = []
  const disposable: Disposable = { dispose() {} }
  const manifest: PluginManifest = {
    name: '@cradle/nowledge-mem',
    version: '0.0.1',
    packageDir: '/plugins/nowledge-mem',
    cradle: {
      apiVersion: '1',
      server: 'dist/server.mjs',
      contributes: { capabilities: [], permissions: [] },
    },
  }

  const ctx: ServerPluginContext = {
    routes: {
      register(route) {
        routes.push(route)
        return disposable
      },
    },
    mcp: {
      registerServer(config) {
        const registration: McpRegistration = { config, disposed: false }
        mcpRegistrations.push(registration)
        return {
          dispose() {
            registration.disposed = true
          },
        }
      },
    },
    skills: {
      register(skill) {
        skills.push(skill)
        return disposable
      },
    },
    providers: {
      externalSources: { register: () => disposable },
      extensions: { register: () => disposable },
    },
    issues: {
      externalSources: { register: () => disposable },
    },
    runtimes: {
      register: () => disposable,
    },
    conversation: {
      adapters: { register: () => disposable },
    },
    subscriptions: [],
    activities: {
      subscribe: () => disposable,
    },
    storage: {
      async get(key) {
        return storage.get(key) ?? null
      },
      async set(key, value) {
        storage.set(key, value)
      },
      async delete(key) {
        storage.delete(key)
      },
    },
    resources: {
      register: () => disposable,
    },
    downloads: {
      async execute() {
        throw new Error('Not used in this test')
      },
      async release() {},
    },
    paths: {
      dataDir: '/tmp/cradle-nowledge-mem-test',
    },
    secrets: {
      get(key) {
        return secrets.get(key) ?? null
      },
      set(key, value) {
        secrets.set(key, value)
      },
      delete(key) {
        secrets.delete(key)
      },
    },
    processes: {
      async spawn() {
        throw new Error('Not used in this test')
      },
      list: () => [],
      async stop() {},
      async stopAll() {},
    },
    lifecycle: {
      registerUninstall(handler) {
        uninstallHandlers.push(handler)
        return disposable
      },
    },
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
    },
    sharedConfig,
    manifest,
  }

  return {
    ctx,
    routes,
    storage,
    secrets,
    skills,
    mcpRegistrations,
    uninstallHandlers,
  }
}

async function callRoute(
  route: ServerPluginRouteRegistration,
  body?: unknown,
): Promise<{ status?: number | string, body: unknown }> {
  const context: ServerPluginRouteContext = {
    body,
    params: {},
    query: {},
    headers: {},
    set: {},
  }
  const response = await route.handler(context)
  return { status: context.set.status, body: response }
}

function findRoute(
  routes: ServerPluginRouteRegistration[],
  method: ServerPluginRouteRegistration['method'],
): ServerPluginRouteRegistration {
  const route = routes.find(item => item.method === method && item.path === '/config')
  if (!route) {
    throw new Error(`Missing ${method} /config`)
  }
  return route
}

describe('nowledge mem MCP plugin', () => {
  it('registers only config routes, the guidance skill, and the default MCP server', async () => {
    const { ctx, routes, skills, mcpRegistrations, uninstallHandlers } = createPluginContext()

    await activate(ctx)

    expect(routes.map(route => `${route.method} ${route.path}`)).toEqual([
      'GET /config',
      'PUT /config',
    ])
    expect(skills).toEqual([
      expect.objectContaining({
        name: 'cradle-plugin-nowledge-mem',
        skillFile: expect.stringContaining('SKILL.md'),
      }),
    ])
    expect(mcpRegistrations).toEqual([
      {
        config: {
          transport: 'streamable-http',
          name: 'nowledge-mem',
          url: 'http://127.0.0.1:14242/mcp/',
          headers: { APP: 'Cradle' },
        },
        disposed: false,
      },
    ])
    expect(uninstallHandlers).toHaveLength(1)
  })

  it('uses environment configuration without exposing the API key', async () => {
    const { ctx, routes, mcpRegistrations } = createPluginContext(new Map([
      ['NMEM_MCP_URL', 'https://mem.example.test/mcp/'],
      ['NMEM_API_KEY', 'environment-secret'],
    ]))

    await activate(ctx)
    const response = await callRoute(findRoute(routes, 'GET'))

    expect(response.body).toEqual({
      ok: true,
      data: {
        mcpUrl: 'https://mem.example.test/mcp/',
        enabled: true,
        hasApiKey: true,
        apiKeySource: 'environment',
      },
    })
    expect(JSON.stringify(response.body)).not.toContain('environment-secret')
    expect(mcpRegistrations[0]?.config).toEqual({
      transport: 'streamable-http',
      name: 'nowledge-mem',
      url: 'https://mem.example.test/mcp/',
      headers: {
        APP: 'Cradle',
        Authorization: 'Bearer environment-secret',
      },
    })
  })

  it('stores API keys in encrypted plugin secrets and refreshes MCP registration', async () => {
    const { ctx, routes, storage, secrets, mcpRegistrations } = createPluginContext()
    await activate(ctx)

    const response = await callRoute(findRoute(routes, 'PUT'), {
      mcpUrl: 'https://mem.example.test/custom-mcp',
      apiKey: 'plugin-secret',
      enabled: true,
    })

    expect(response.body).toEqual({
      ok: true,
      data: {
        mcpUrl: 'https://mem.example.test/custom-mcp',
        enabled: true,
        hasApiKey: true,
        apiKeySource: 'plugin',
      },
    })
    expect(mcpRegistrations[0]?.disposed).toBe(true)
    expect(mcpRegistrations[1]?.config).toEqual({
      transport: 'streamable-http',
      name: 'nowledge-mem',
      url: 'https://mem.example.test/custom-mcp',
      headers: {
        APP: 'Cradle',
        Authorization: 'Bearer plugin-secret',
      },
    })
    expect(secrets.get('api-key')).toBe('plugin-secret')
    expect(storage.get('config')).not.toContain('plugin-secret')
    expect(JSON.stringify(response.body)).not.toContain('plugin-secret')
  })

  it('disposes MCP registration when the plugin is disabled', async () => {
    const { ctx, routes, mcpRegistrations } = createPluginContext()
    await activate(ctx)

    await callRoute(findRoute(routes, 'PUT'), { enabled: false })

    expect(mcpRegistrations).toHaveLength(1)
    expect(mcpRegistrations[0]?.disposed).toBe(true)
  })

  it('falls back to an environment key when the plugin-owned key is removed', async () => {
    const { ctx, routes, secrets, mcpRegistrations } = createPluginContext(new Map([
      ['NMEM_API_KEY', 'environment-secret'],
    ]))
    secrets.set('api-key', 'plugin-secret')
    await activate(ctx)

    const response = await callRoute(findRoute(routes, 'PUT'), { apiKey: null })

    expect(secrets.has('api-key')).toBe(false)
    expect(response.body).toEqual({
      ok: true,
      data: expect.objectContaining({
        hasApiKey: true,
        apiKeySource: 'environment',
      }),
    })
    expect(mcpRegistrations[1]?.config).toEqual(expect.objectContaining({
      headers: {
        APP: 'Cradle',
        Authorization: 'Bearer environment-secret',
      },
    }))
  })

  it('rejects invalid MCP endpoints before changing configuration', async () => {
    const { ctx, routes, storage, mcpRegistrations } = createPluginContext()
    await activate(ctx)

    const response = await callRoute(findRoute(routes, 'PUT'), {
      mcpUrl: 'file:///tmp/not-an-http-endpoint',
    })

    expect(response.status).toBe(400)
    expect(response.body).toEqual({
      ok: false,
      code: 'invalid_request',
      message: expect.stringContaining('mcpUrl'),
    })
    expect(storage.has('config')).toBe(false)
    expect(mcpRegistrations).toHaveLength(1)
  })

  it('removes only Cradle-owned settings during uninstall', async () => {
    const { ctx, routes, storage, secrets, uninstallHandlers } = createPluginContext()
    await activate(ctx)
    await callRoute(findRoute(routes, 'PUT'), {
      mcpUrl: 'https://mem.example.test/mcp/',
      apiKey: 'plugin-secret',
    })

    expect(await uninstallHandlers[0]!.inspect()).toEqual({
      summary: 'Remove the Cradle-owned Nowledge Mem connection settings.',
      data: [
        expect.objectContaining({ id: 'config', effect: 'remove' }),
        expect.objectContaining({ id: 'nowledge-data', effect: 'preserve' }),
      ],
    })
    await uninstallHandlers[0]!.execute()

    expect(storage.has('config')).toBe(false)
    expect(secrets.has('api-key')).toBe(false)
  })
})
