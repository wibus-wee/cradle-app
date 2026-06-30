import type {
  Disposable,
  PluginManifest,
  ServerPluginContext,
  ServerPluginRouteContext,
  ServerPluginRouteRegistration,
} from '@cradle/plugin-sdk/server'
import { describe, expect, it, vi } from 'vitest'

import { activate, registerNowledgeRoutes } from './server'

interface FetchCall {
  url: string
  init: RequestInit
}

function createJsonFetch(responseBody: unknown, status = 200): {
  calls: FetchCall[]
  fetch: typeof fetch
} {
  const calls: FetchCall[] = []
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    calls.push({
      url: String(input),
      init: init ?? {},
    })
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  })
  return { calls, fetch: fetchMock }
}

function createPluginContext(sharedConfig = new Map<string, string>()): {
  ctx: ServerPluginContext
  routes: ServerPluginRouteRegistration[]
  storage: Map<string, string>
  skills: Array<{ name: string, description: string, skillFile: string }>
  mcpServers: Array<Parameters<ServerPluginContext['mcp']['registerServer']>[0]>
} {
  const routes: ServerPluginRouteRegistration[] = []
  const storage = new Map<string, string>()
  const skills: Array<{ name: string, description: string, skillFile: string }> = []
  const mcpServers: Array<Parameters<ServerPluginContext['mcp']['registerServer']>[0]> = []
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
        mcpServers.push(config)
        return disposable
      },
    },
    skills: {
      register(skill) {
        skills.push(skill)
        return disposable
      },
    },
    providers: {
      externalSources: {
        register: () => disposable,
      },
    },
    issues: {
      externalSources: {
        register: () => disposable,
      },
    },
    runtimes: {
      register: () => disposable,
    },
    subscriptions: [],
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
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
    },
    sharedConfig,
    manifest,
    hooks: {
      chat: {
        onBeforeQuery: () => disposable,
        onAfterResponse: () => disposable,
      },
    },
    events: {
      on: () => disposable,
      emit() {},
    },
  }

  return { ctx, routes, storage, skills, mcpServers }
}

async function callRoute(
  route: ServerPluginRouteRegistration,
  input: {
    body?: unknown
    params?: Record<string, string>
    query?: Record<string, unknown>
  } = {},
): Promise<{ status?: number | string, body: unknown }> {
  const context: ServerPluginRouteContext = {
    body: input.body,
    params: input.params ?? {},
    query: input.query ?? {},
    headers: {},
    set: {},
  }
  const body = await route.handler(context)
  return { status: context.set.status, body }
}

function findRoute(
  routes: ServerPluginRouteRegistration[],
  method: ServerPluginRouteRegistration['method'],
  path: string,
): ServerPluginRouteRegistration {
  const route = routes.find(item => item.method === method && item.path === path)
  if (!route) {
    throw new Error(`Missing route ${method} ${path}`)
  }
  return route
}

describe('nowledge mem server plugin', () => {
  it('registers routes and bundled skill on activation', async () => {
    const { ctx, routes, skills, mcpServers } = createPluginContext()

    await activate(ctx)

    expect(routes.map(route => `${route.method} ${route.path}`)).toEqual([
      'GET /status',
      'GET /config',
      'PUT /config',
      'GET /working-memory',
      'GET /context-bundle',
      'GET /memories/search',
      'POST /memories',
      'GET /threads/search',
      'POST /threads',
      'GET /threads/:threadId',
      'POST /threads/:threadId/append',
    ])
    expect(skills).toEqual([
      expect.objectContaining({
        name: 'nowledge-mem',
        skillFile: expect.stringContaining('SKILL.md'),
      }),
    ])
    expect(mcpServers).toEqual([
      {
        transport: 'streamable-http',
        name: 'nowledge-mem',
        url: 'http://127.0.0.1:14242/mcp',
      },
    ])
  })

  it('registers configured streamable HTTP MCP without persisting or returning headers', async () => {
    const { ctx, mcpServers, routes, storage } = createPluginContext(new Map([
      ['NMEM_MCP_URL', 'https://nowledge.example.test/mcp/'],
      ['NMEM_API_KEY', 'shared-secret'],
    ]))

    await activate(ctx)

    expect(mcpServers).toEqual([
      {
        transport: 'streamable-http',
        name: 'nowledge-mem',
        url: 'https://nowledge.example.test/mcp',
        headers: { Authorization: 'Bearer shared-secret' },
      },
    ])

    const configResponse = await callRoute(findRoute(routes, 'GET', '/config'))
    expect(configResponse.body).toEqual({
      ok: true,
      data: {
        apiUrl: 'http://127.0.0.1:14242',
        mcpUrl: 'https://nowledge.example.test/mcp',
        enabled: true,
        recallEnabled: false,
        captureEnabled: false,
        hasApiKey: true,
      },
    })
    expect(JSON.stringify(configResponse.body)).not.toContain('shared-secret')
    expect(storage.get('config')).toBeUndefined()
  })

  it('does not persist or return API keys through config routes', async () => {
    const { ctx, routes, storage, mcpServers } = createPluginContext(new Map([
      ['NMEM_API_KEY', 'shared-secret'],
    ]))
    registerNowledgeRoutes(ctx)

    const putConfig = findRoute(routes, 'PUT', '/config')
    const getConfig = findRoute(routes, 'GET', '/config')

    const update = await callRoute(putConfig, {
      body: {
        apiUrl: 'http://nmem.test/',
        mcpUrl: 'https://nmem.test/mcp/',
        spaceId: 'Research Agent',
        enabled: true,
        apiKey: 'must-not-persist',
      },
    })
    const read = await callRoute(getConfig)

    expect(update.body).toEqual({
      ok: true,
      data: {
        apiUrl: 'http://nmem.test',
        mcpUrl: 'https://nmem.test/mcp',
        spaceId: 'Research Agent',
        enabled: true,
        recallEnabled: false,
        captureEnabled: false,
        hasApiKey: true,
      },
    })
    expect(read.body).toEqual(update.body)
    expect(mcpServers).toEqual([
      {
        transport: 'streamable-http',
        name: 'nowledge-mem',
        url: 'https://nmem.test/mcp',
        headers: { Authorization: 'Bearer shared-secret' },
      },
    ])
    expect(storage.get('config')).not.toContain('must-not-persist')
    expect(JSON.stringify(read.body)).not.toContain('shared-secret')
  })

  it('derives MCP URL from API URL and syncs registration after config updates', async () => {
    const { ctx, routes, mcpServers } = createPluginContext()
    registerNowledgeRoutes(ctx)

    const update = await callRoute(findRoute(routes, 'PUT', '/config'), {
      body: {
        apiUrl: 'http://nmem.test/',
        enabled: true,
      },
    })

    expect(update.body).toEqual({
      ok: true,
      data: {
        apiUrl: 'http://nmem.test',
        mcpUrl: 'http://nmem.test/mcp',
        enabled: true,
        recallEnabled: false,
        captureEnabled: false,
        hasApiKey: false,
      },
    })
    expect(mcpServers).toEqual([
      {
        transport: 'streamable-http',
        name: 'nowledge-mem',
        url: 'http://nmem.test/mcp',
      },
    ])
  })

  it('calls Nowledge memory search with q and never query', async () => {
    const { calls, fetch } = createJsonFetch({ memories: [] })
    const { ctx, routes } = createPluginContext(new Map([
      ['NMEM_API_URL', 'http://nmem.test'],
      ['NMEM_API_KEY', 'secret-token'],
    ]))
    registerNowledgeRoutes(ctx, { fetch })

    const response = await callRoute(findRoute(routes, 'GET', '/memories/search'), {
      query: { q: 'alpha', limit: '3', space_id: 'Research Agent' },
    })

    expect(response).toEqual({
      status: undefined,
      body: { ok: true, data: { memories: [] } },
    })
    expect(calls).toHaveLength(1)
    const url = new URL(calls[0]!.url)
    expect(url.pathname).toBe('/memories/search')
    expect(url.searchParams.get('q')).toBe('alpha')
    expect(url.searchParams.has('query')).toBe(false)
    expect(url.searchParams.get('space_id')).toBe('Research Agent')
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer secret-token')
  })

  it('calls Nowledge thread search with query and never q', async () => {
    const { calls, fetch } = createJsonFetch({ threads: [] })
    const { ctx, routes } = createPluginContext(new Map([
      ['NMEM_API_URL', 'http://nmem.test'],
    ]))
    registerNowledgeRoutes(ctx, { fetch })

    const response = await callRoute(findRoute(routes, 'GET', '/threads/search'), {
      query: { query: 'alpha', limit: '5', source: 'cradle' },
    })

    expect(response).toEqual({
      status: undefined,
      body: { ok: true, data: { threads: [] } },
    })
    expect(calls).toHaveLength(1)
    const url = new URL(calls[0]!.url)
    expect(url.pathname).toBe('/threads/search')
    expect(url.searchParams.get('query')).toBe('alpha')
    expect(url.searchParams.has('q')).toBe(false)
    expect(url.searchParams.get('source')).toBe('cradle')
  })

  it('passes source_app and explicit include_working_memory to context bundle reads', async () => {
    const { calls, fetch } = createJsonFetch({ context: [] })
    const { ctx, routes } = createPluginContext(new Map([
      ['NMEM_API_URL', 'http://nmem.test'],
    ]))
    registerNowledgeRoutes(ctx, { fetch })

    const response = await callRoute(findRoute(routes, 'GET', '/context-bundle'), {
      query: {
        agent_id: 'agent-1',
        host_agent_id: 'host-agent-1',
        include_working_memory: 'false',
      },
    })

    expect(response).toEqual({
      status: undefined,
      body: { ok: true, data: { context: [] } },
    })
    expect(calls).toHaveLength(1)
    const url = new URL(calls[0]!.url)
    expect(url.pathname).toBe('/context/bundle')
    expect(url.searchParams.get('source_app')).toBe('cradle')
    expect(url.searchParams.get('agent_id')).toBe('agent-1')
    expect(url.searchParams.get('host_agent_id')).toBe('host-agent-1')
    expect(url.searchParams.get('include_working_memory')).toBe('false')
  })

  it('returns structured validation errors for missing required query parameters', async () => {
    const { ctx, routes } = createPluginContext()
    registerNowledgeRoutes(ctx)

    const response = await callRoute(findRoute(routes, 'GET', '/memories/search'))

    expect(response.status).toBe(400)
    expect(response.body).toEqual({
      ok: false,
      code: 'invalid_request',
      message: expect.stringContaining('q'),
    })
  })
})
