import { rm } from 'node:fs/promises'
import path from 'node:path'

import type { ServerPluginContext, ServerPluginRouteContext } from '@cradle/plugin-sdk/server'
import { z } from 'zod'

import { createRuntimeResourceAdapter, readRuntimeStatus } from './runtime'
import type { CliProxyAuthProvider } from './sidecar'
import { CliProxySidecar } from './sidecar'

const ConfigBodySchema = z.object({
  port: z.number().int().min(1024).max(65535),
})
const AuthProviderSchema = z.enum(['codex', 'claude', 'gemini'])

let activeSidecar: CliProxySidecar | null = null

function routeFailure(routeCtx: ServerPluginRouteContext, error: unknown) {
  routeCtx.set.status = 409
  return {
    ok: false as const,
    error: error instanceof Error ? error.message : String(error),
  }
}

function registerRoutes(ctx: ServerPluginContext, sidecar: CliProxySidecar): void {
  ctx.routes.register({
    method: 'GET',
    path: '/status',
    label: 'CLIProxyAPI status',
    handler: async () => ({ ok: true, status: await sidecar.status() }),
  })
  ctx.routes.register({
    method: 'GET',
    path: '/config',
    label: 'CLIProxyAPI config',
    handler: async () => ({ ok: true, config: await sidecar.readConfig() }),
  })
  ctx.routes.register({
    method: 'PUT',
    path: '/config',
    label: 'Update CLIProxyAPI config',
    handler: async (routeCtx) => {
      try {
        const config = await sidecar.updateConfig(ConfigBodySchema.parse(routeCtx.body))
        return { ok: true, config }
      }
      catch (error) {
        return routeFailure(routeCtx, error)
      }
    },
  })
  ctx.routes.register({
    method: 'POST',
    path: '/start',
    label: 'Start CLIProxyAPI',
    handler: async (routeCtx) => {
      try {
        return { ok: true, status: await sidecar.start() }
      }
      catch (error) {
        return routeFailure(routeCtx, error)
      }
    },
  })
  ctx.routes.register({
    method: 'POST',
    path: '/stop',
    label: 'Stop CLIProxyAPI',
    handler: async () => ({ ok: true, status: await sidecar.stop() }),
  })
  ctx.routes.register({
    method: 'POST',
    path: '/auth/:provider',
    label: 'Authenticate a CLIProxyAPI account',
    handler: async (routeCtx) => {
      try {
        const provider: CliProxyAuthProvider = AuthProviderSchema.parse(routeCtx.params.provider)
        return { ok: true, status: await sidecar.login(provider) }
      }
      catch (error) {
        return routeFailure(routeCtx, error)
      }
    },
  })
}

export async function activate(ctx: ServerPluginContext): Promise<void> {
  const sidecar = new CliProxySidecar(ctx)
  activeSidecar = sidecar
  ctx.resources.register(createRuntimeResourceAdapter({
    dataDir: ctx.paths.dataDir,
    downloads: ctx.downloads,
  }))
  registerRoutes(ctx, sidecar)

  ctx.providers.externalSources.register({
    id: 'cli-proxy-api',
    label: 'CLIProxyAPI',
    description: 'Projects the Cradle-managed CLIProxyAPI loopback endpoint.',
    capabilities: { refresh: true },
    async readSnapshot() {
      const status = await sidecar.status()
      const installed = readRuntimeStatus({ dataDir: ctx.paths.dataDir }).installed
      if (!installed) {
        return {
          source: {
            status: 'warning',
            message: 'Install the CLIProxyAPI runtime from Resources.',
            observedAt: new Date().toISOString(),
          },
          providers: [],
          warnings: [{
            code: 'cli-proxy-api-runtime-not-installed',
            message: 'CLIProxyAPI runtime is not installed.',
            severity: 'warning',
          }],
        }
      }
      return {
        source: {
          status: status.healthy ? 'ok' : 'warning',
          message: status.healthy
            ? `CLIProxyAPI is healthy with ${status.models.length} models.`
            : 'CLIProxyAPI is installed but not running.',
          observedAt: new Date().toISOString(),
        },
        providers: [{
          externalId: 'cli-proxy-api:managed',
          app: 'cli-proxy-api',
          name: 'CLIProxyAPI',
          providerKind: 'openai-compatible',
          config: {
            baseUrl: status.endpoint,
            apiMode: 'responses',
            model: status.models[0],
          },
          credential: {
            kind: 'api-key',
            value: sidecar.dataPlaneKey(),
            label: 'CLIProxyAPI local API key',
          },
          current: true,
          readonly: true,
          metadata: {
            baseUrl: status.endpoint,
            model: status.models[0],
            apiFormat: 'openai_responses',
            iconSlug: 'openai',
          },
          warnings: status.healthy
            ? []
            : [{
                code: 'cli-proxy-api-not-running',
                message: 'Start CLIProxyAPI from its plugin panel before using this provider.',
                severity: 'warning',
              }],
        }],
      }
    },
  })

  ctx.lifecycle.registerUninstall({
    async inspect() {
      return {
        summary: 'Stop CLIProxyAPI, uninstall its managed executable, and remove generated local API secrets.',
        data: [
          {
            id: 'generated-config',
            label: 'Generated listener configuration and API secrets',
            effect: 'remove',
          },
          {
            id: 'oauth-accounts',
            label: 'CLIProxyAPI OAuth account files',
            effect: 'preserve',
            description: 'Account files remain in the plugin data directory so reinstalling the integration can reuse them.',
          },
        ],
      }
    },
    async execute() {
      await sidecar.stop()
      await rm(path.join(ctx.paths.dataDir, 'state', 'config.yaml'), { force: true })
      ctx.secrets.delete('data-plane-key')
      ctx.secrets.delete('management-key')
      await ctx.storage.delete('port')
    },
  })

  if (readRuntimeStatus({ dataDir: ctx.paths.dataDir }).installed) {
    void sidecar.start().catch(error => ctx.logger.warn('CLIProxyAPI autostart failed', error))
  }
  ctx.logger.info('CLIProxyAPI plugin activated')
}

export async function deactivate(): Promise<void> {
  await activeSidecar?.dispose()
  activeSidecar = null
}
