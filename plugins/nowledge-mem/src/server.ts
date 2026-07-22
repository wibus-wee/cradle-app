import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Disposable, ServerPluginContext, ServerPluginRouteContext } from '@cradle/plugin-sdk/server'
import { z } from 'zod'

import {
  projectPublicConfig,
  readNowledgePluginConfig,
  writeNowledgePluginConfig,
} from './config'
import { NowledgeClient, NowledgeClientError } from './nowledge-client'

const __dirname = dirname(fileURLToPath(import.meta.url))

const LimitQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  space_id: z.string().trim().min(1).optional(),
})

const BooleanQuerySchema = z.union([
  z.boolean(),
  z.enum(['true', 'false']).transform(value => value === 'true'),
])

const MemorySearchQuerySchema = LimitQuerySchema.extend({
  q: z.string().trim().min(1),
  mode: z.enum(['fast', 'deep']).optional(),
})

const ThreadSearchQuerySchema = LimitQuerySchema.extend({
  query: z.string().trim().min(1),
  source: z.string().trim().min(1).optional(),
})

const ContextBundleQuerySchema = z.object({
  agent_id: z.string().trim().min(1).optional(),
  host_agent_id: z.string().trim().min(1).optional(),
  include_working_memory: BooleanQuerySchema.optional(),
  space_id: z.string().trim().min(1).optional(),
})

const ThreadParamsSchema = z.object({
  threadId: z.string().trim().min(1),
})

const CreateMemoryBodySchema = z.object({
  content: z.string().trim().min(1),
}).passthrough()

const CreateThreadBodySchema = z.object({
  thread_id: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).optional(),
  source: z.string().trim().min(1).optional(),
  messages: z.array(z.unknown()).min(1),
}).passthrough()

const AppendThreadBodySchema = z.object({
  messages: z.array(z.unknown()).min(1),
  idempotency_key: z.string().trim().min(1).optional(),
  space_id: z.string().trim().min(1).optional(),
}).passthrough()

interface RegisterNowledgeRoutesOptions {
  fetch?: typeof fetch
}

let activeMcpRegistration: Disposable | undefined

export async function activate(ctx: ServerPluginContext): Promise<void> {
  registerNowledgeRoutes(ctx)
  await syncNowledgeMcpServer(ctx)

  ctx.skills.register({
    name: 'cradle-plugin-nowledge-mem',
    description: 'Guided Nowledge Mem access for Working Memory, Context Bundle, memory search, memory writes, and thread lookup through Cradle plugin routes.',
    skillFile: resolve(__dirname, 'SKILL.md'),
  })

  ctx.logger.info('Nowledge Mem plugin activated')
}

async function syncNowledgeMcpServer(ctx: ServerPluginContext): Promise<void> {
  activeMcpRegistration?.dispose()
  activeMcpRegistration = undefined

  const config = await readNowledgePluginConfig(ctx)
  if (!config.enabled || !config.mcpUrl) {
    return
  }

  activeMcpRegistration = await ctx.mcp.registerServer({
    transport: 'streamable-http',
    name: 'nowledge-mem',
    url: config.mcpUrl,
    ...(config.apiKey ? { headers: { Authorization: `Bearer ${config.apiKey}` } } : {}),
  })
}

export function registerNowledgeRoutes(
  ctx: ServerPluginContext,
  options: RegisterNowledgeRoutesOptions = {},
): void {
  ctx.routes.register({
    method: 'GET',
    path: '/status',
    label: 'Nowledge status',
    handler: async (routeCtx) => {
      const config = await readNowledgePluginConfig(ctx)
      const client = createClient(config, options.fetch)
      try {
        const health = config.enabled ? await client.readHealth() : { skipped: true, reason: 'plugin_disabled' }
        return ok({
          config: projectPublicConfig(config),
          health,
        })
      }
      catch (error) {
        return fail(routeCtx, error)
      }
    },
  })

  ctx.routes.register({
    method: 'GET',
    path: '/config',
    label: 'Nowledge config',
    handler: async () => {
      const config = await readNowledgePluginConfig(ctx)
      return ok(projectPublicConfig(config))
    },
  })

  ctx.routes.register({
    method: 'PUT',
    path: '/config',
    label: 'Update Nowledge config',
    handler: async (routeCtx) => {
      try {
        const config = await writeNowledgePluginConfig(ctx, routeCtx.body)
        const resolved = await readNowledgePluginConfig(ctx)
        await syncNowledgeMcpServer(ctx)
        return ok({
          ...config,
          hasApiKey: resolved.hasApiKey,
        })
      }
      catch (error) {
        return fail(routeCtx, error)
      }
    },
  })

  ctx.routes.register({
    method: 'GET',
    path: '/working-memory',
    label: 'Nowledge Working Memory',
    handler: async (routeCtx) => {
      try {
        const query = LimitQuerySchema.pick({ space_id: true }).parse(routeCtx.query)
        const client = await createResolvedClient(ctx, options.fetch)
        return await upstream(routeCtx, () => client.readWorkingMemory({ spaceId: query.space_id }))
      }
      catch (error) {
        return fail(routeCtx, error)
      }
    },
  })

  ctx.routes.register({
    method: 'GET',
    path: '/context-bundle',
    label: 'Nowledge Context Bundle',
    handler: async (routeCtx) => {
      try {
        const query = ContextBundleQuerySchema.parse(routeCtx.query)
        const client = await createResolvedClient(ctx, options.fetch)
        return await upstream(routeCtx, () => client.readContextBundle({
          agentId: query.agent_id,
          hostAgentId: query.host_agent_id,
          includeWorkingMemory: query.include_working_memory,
          spaceId: query.space_id,
        }))
      }
      catch (error) {
        return fail(routeCtx, error)
      }
    },
  })

  ctx.routes.register({
    method: 'GET',
    path: '/memories/search',
    label: 'Nowledge memory search',
    handler: async (routeCtx) => {
      try {
        const query = MemorySearchQuerySchema.parse(routeCtx.query)
        const client = await createResolvedClient(ctx, options.fetch)
        return await upstream(routeCtx, () => client.searchMemories({
          q: query.q,
          limit: query.limit,
          mode: query.mode,
          spaceId: query.space_id,
        }))
      }
      catch (error) {
        return fail(routeCtx, error)
      }
    },
  })

  ctx.routes.register({
    method: 'POST',
    path: '/memories',
    label: 'Nowledge memory create',
    handler: async (routeCtx) => {
      try {
        const body = CreateMemoryBodySchema.parse(routeCtx.body)
        const client = await createResolvedClient(ctx, options.fetch)
        return await upstream(routeCtx, () => client.createMemory(body))
      }
      catch (error) {
        return fail(routeCtx, error)
      }
    },
  })

  ctx.routes.register({
    method: 'GET',
    path: '/threads/search',
    label: 'Nowledge thread search',
    handler: async (routeCtx) => {
      try {
        const query = ThreadSearchQuerySchema.parse(routeCtx.query)
        const client = await createResolvedClient(ctx, options.fetch)
        return await upstream(routeCtx, () => client.searchThreads({
          query: query.query,
          limit: query.limit,
          source: query.source,
          spaceId: query.space_id,
        }))
      }
      catch (error) {
        return fail(routeCtx, error)
      }
    },
  })

  ctx.routes.register({
    method: 'POST',
    path: '/threads',
    label: 'Nowledge thread create',
    handler: async (routeCtx) => {
      try {
        const body = CreateThreadBodySchema.parse(routeCtx.body)
        const client = await createResolvedClient(ctx, options.fetch)
        return await upstream(routeCtx, () => client.createThread({
          ...body,
          source: body.source ?? 'cradle',
        }))
      }
      catch (error) {
        return fail(routeCtx, error)
      }
    },
  })

  ctx.routes.register({
    method: 'GET',
    path: '/threads/:threadId',
    label: 'Nowledge thread read',
    handler: async (routeCtx) => {
      try {
        const params = ThreadParamsSchema.parse(routeCtx.params)
        const query = LimitQuerySchema.parse(routeCtx.query)
        const client = await createResolvedClient(ctx, options.fetch)
        return await upstream(routeCtx, () => client.readThread({
          threadId: params.threadId,
          limit: query.limit,
          offset: query.offset,
          spaceId: query.space_id,
        }))
      }
      catch (error) {
        return fail(routeCtx, error)
      }
    },
  })

  ctx.routes.register({
    method: 'POST',
    path: '/threads/:threadId/append',
    label: 'Nowledge thread append',
    handler: async (routeCtx) => {
      try {
        const params = ThreadParamsSchema.parse(routeCtx.params)
        const body = AppendThreadBodySchema.parse(routeCtx.body)
        const client = await createResolvedClient(ctx, options.fetch)
        return await upstream(routeCtx, () => client.appendThread({
          threadId: params.threadId,
          messages: body.messages,
          idempotencyKey: body.idempotency_key,
          spaceId: body.space_id,
        }))
      }
      catch (error) {
        return fail(routeCtx, error)
      }
    },
  })
}

async function createResolvedClient(
  ctx: ServerPluginContext,
  fetchImpl?: typeof fetch,
): Promise<NowledgeClient> {
  return createClient(await readNowledgePluginConfig(ctx), fetchImpl)
}

function createClient(
  config: Awaited<ReturnType<typeof readNowledgePluginConfig>>,
  fetchImpl?: typeof fetch,
): NowledgeClient {
  return new NowledgeClient({
    apiUrl: config.apiUrl,
    apiKey: config.apiKey,
    spaceId: config.spaceId,
    fetch: fetchImpl,
  })
}

async function upstream(
  routeCtx: ServerPluginRouteContext,
  read: () => Promise<unknown>,
): Promise<{ ok: true, data: unknown } | { ok: false, code: string, message: string }> {
  try {
    return ok(await read())
  }
  catch (error) {
    return fail(routeCtx, error)
  }
}

function ok<T>(data: T): { ok: true, data: T } {
  return { ok: true, data }
}

function fail(
  routeCtx: ServerPluginRouteContext,
  error: unknown,
): { ok: false, code: string, message: string } {
  if (error instanceof z.ZodError) {
    routeCtx.set.status = 400
    return {
      ok: false,
      code: 'invalid_request',
      message: error.issues.map(issue => `${issue.path.join('.') || 'request'}: ${issue.message}`).join('; '),
    }
  }

  if (error instanceof NowledgeClientError) {
    routeCtx.set.status = error.status && error.status >= 400 && error.status < 600 ? error.status : 502
    return {
      ok: false,
      code: error.code,
      message: error.message,
    }
  }

  routeCtx.set.status = 500
  return {
    ok: false,
    code: 'nowledge_plugin_error',
    message: error instanceof Error ? error.message : String(error),
  }
}
