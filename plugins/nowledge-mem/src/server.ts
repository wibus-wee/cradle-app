import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Disposable, ServerPluginContext, ServerPluginRouteContext } from '@cradle/plugin-sdk/server'
import { z } from 'zod'

import {
  clearNowledgePluginConfig,
  projectPublicConfig,
  readNowledgePluginConfig,
  writeNowledgePluginConfig,
} from './config'

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function activate(ctx: ServerPluginContext): Promise<void> {
  let activeMcpRegistration: Disposable | undefined

  async function syncMcpRegistration(): Promise<void> {
    activeMcpRegistration?.dispose()
    activeMcpRegistration = undefined

    const config = await readNowledgePluginConfig(ctx)
    if (!config.enabled) {
      return
    }

    activeMcpRegistration = await ctx.mcp.registerServer({
      transport: 'streamable-http',
      name: 'nowledge-mem',
      url: config.mcpUrl,
      headers: {
        APP: 'Cradle',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
    })
  }

  registerConfigRoutes(ctx, syncMcpRegistration)
  await syncMcpRegistration()

  ctx.skills.register({
    name: 'cradle-plugin-nowledge-mem',
    description: 'Guidance for using the Nowledge Mem MCP tools registered by Cradle.',
    skillFile: resolve(__dirname, 'SKILL.md'),
  })

  ctx.lifecycle.registerUninstall({
    inspect: () => ({
      summary: 'Remove the Cradle-owned Nowledge Mem connection settings.',
      data: [
        {
          id: 'config',
          label: 'MCP endpoint and encrypted API key',
          effect: 'remove',
        },
        {
          id: 'nowledge-data',
          label: 'Memories and threads owned by Nowledge Mem',
          effect: 'preserve',
        },
      ],
    }),
    execute: () => clearNowledgePluginConfig(ctx),
  })

  ctx.logger.info('Nowledge Mem MCP plugin activated')
}

function registerConfigRoutes(
  ctx: ServerPluginContext,
  syncMcpRegistration: () => Promise<void>,
): void {
  ctx.routes.register({
    method: 'GET',
    path: '/config',
    label: 'Nowledge MCP config',
    handler: async () => ok(projectPublicConfig(await readNowledgePluginConfig(ctx))),
  })

  ctx.routes.register({
    method: 'PUT',
    path: '/config',
    label: 'Update Nowledge MCP config',
    handler: async (routeCtx) => {
      try {
        const config = await writeNowledgePluginConfig(ctx, routeCtx.body)
        await syncMcpRegistration()
        return ok(config)
      }
      catch (error) {
        return fail(routeCtx, error)
      }
    },
  })
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

  routeCtx.set.status = 500
  return {
    ok: false,
    code: 'nowledge_plugin_error',
    message: error instanceof Error ? error.message : String(error),
  }
}
