import { mkdirSync } from 'node:fs'
import path from 'node:path'

import type { Disposable, PluginManifest } from '@cradle/plugin-sdk'
import { derivePluginRouteSegment } from '@cradle/plugin-sdk'
import type {
  McpServerConfig,
  PluginManagedResourceAdapter,
  ServerPluginContext,
  ServerPluginRouteRegistration,
} from '@cradle/plugin-sdk/server'

import { AppError } from '../errors/app-error'
import { createChildLogger } from '../logging/logger'
import { assertChatRuntime, registerRuntime, unregisterRuntime } from '../modules/chat-runtime/chat-runtime-provider-registry'
import type { ChatRuntimeMetadata } from '../modules/chat-runtime/runtime-provider-types'
import type { DownloadCenterService } from '../modules/download-center/service'
import type { ManagedResourceAdapter, ManagedResourceKey, ManagedResourceProjection, ManagedResourceService } from '../modules/managed-resources/service'
import type { ProviderKind } from '../modules/provider-contracts/types'
import { readSecret, removeSecret, upsertSecret } from '../modules/secrets/service'
import { registerConversationBridgeAdapter } from './conversation-adapter-registry'
import { createPluginEventBus } from './event-bus'
import { registerExternalIssueSource } from './external-issue-source-registry'
import { registerExternalProviderSource } from './external-provider-source-registry'
import { registerOwnedAfterResponseHook, registerOwnedBeforeQueryHook } from './hooks'
import { registerPluginMcpServer } from './mcp-registry'
import { createPluginProcessService } from './process-registry'
import { normalizePluginRoutePath, registerPluginRoute, unregisterPluginRoute } from './route-registry'
import { registerPluginCapability, unregisterPluginCapability } from './runtime-registry'
import { registerOwnedPluginSkill } from './skill-registry'
import { createPluginStorage } from './storage'
import { registerPluginUninstallHandler } from './uninstall-registry'

export interface PluginHostServices {
  downloadCenter: Pick<DownloadCenterService, 'execute' | 'release'>
  managedResources: ManagedResourceService
  dataDir: string
}

interface ServerPluginContextOptions {
  routeSegment?: string
  hostServices?: PluginHostServices
}

function pluginResourceNamespace(routeSegment: string): string {
  return `plugin.${routeSegment}`
}

function pluginSecretId(owner: string, key: string): string {
  if (!/^[a-z0-9][\w.-]{0,127}$/i.test(key)) {
    throw new Error('Plugin secret key must use 1-128 letters, numbers, dots, underscores, or hyphens.')
  }
  return `plugin:${Buffer.from(owner).toString('base64url')}:${key}`
}

function toHostManagedResourceAdapter(
  namespace: string,
  adapter: PluginManagedResourceAdapter,
): ManagedResourceAdapter {
  function pluginKey(key: ManagedResourceKey) {
    return { resourceType: key.resourceType, resourceId: key.resourceId }
  }
  function hostProjection(projection: Awaited<ReturnType<PluginManagedResourceAdapter['project']>>): ManagedResourceProjection {
    return projection
  }
  return {
    namespace,
    declarations: () => adapter.declarations().map(declaration => ({
      ...declaration,
      key: { ...declaration.key, namespace },
    })),
    project: async key => hostProjection(await adapter.project(pluginKey(key))),
    execute: async (key, action) => hostProjection(await adapter.execute(pluginKey(key), action)),
  }
}

export function createServerPluginContext(
  manifest: PluginManifest,
  options: ServerPluginContextOptions = {},
): ServerPluginContext {
  const routeSegment = options.routeSegment ?? derivePluginRouteSegment(manifest.name)
  const pluginLogger = createChildLogger({ module: 'plugin', plugin: manifest.name })
  const logger = {
    info: (msg: string, ...args: unknown[]) => pluginLogger.info(msg, { args }),
    warn: (msg: string, ...args: unknown[]) => pluginLogger.warn(msg, { args }),
    error: (msg: string, ...args: unknown[]) => pluginLogger.error(msg, { args }),
    debug: (msg: string, ...args: unknown[]) => pluginLogger.debug(msg, { args }),
  }

  // Build shared config from env vars (CRADLE_PLUGIN_* prefix)
  const sharedConfig = new Map<string, string>()
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('CRADLE_PLUGIN_') && value !== undefined) {
      sharedConfig.set(key.replace('CRADLE_PLUGIN_', ''), value)
    }
  }

  const eventBus = createPluginEventBus()
  const subscriptions: Disposable[] = []
  const hostServices = options.hostServices
  const resourceNamespace = pluginResourceNamespace(routeSegment)
  const dataDir = hostServices
    ? path.resolve(hostServices.dataDir, 'plugins', routeSegment)
    : path.resolve(process.cwd(), '.cradle-plugin-data-unavailable', routeSegment)
  const processService = createPluginProcessService(manifest.name, dataDir)
  const processCapabilities = new Map<string, string>()

  function track(disposable: Disposable): Disposable {
    subscriptions.push(disposable)
    return disposable
  }

  function skipMcpRegistration(name: string): undefined {
    logger.debug(`MCP server ${name} skipped because when() returned false`)
    return undefined
  }

  function registerServerAfterAsyncPredicate(config: McpServerConfig, enabled: Promise<boolean>): Promise<Disposable | undefined> {
    let disposed = false
    let registered: Disposable | undefined
    const pending: Disposable = {
      dispose() {
        disposed = true
        registered?.dispose()
      },
    }
    track(pending)
    return enabled.then((result) => {
      if (!result || disposed) {
        return skipMcpRegistration(config.name)
      }
      registered = registerPluginMcpServer(manifest.name, config)
      return registered
    })
  }

  function registerRoute(route: ServerPluginRouteRegistration): Disposable {
    let disposed = false
    const normalizedPath = normalizePluginRoutePath(route.path)
    const routePathId = normalizedPath.replace(/^\//, '').replaceAll('/', '.') || 'root'
    const capability = registerPluginCapability(
      manifest.name,
      'server-route',
      'server',
      `${route.method.toLowerCase()}.${routePathId}`,
      route.label ?? `${route.method} ${normalizedPath}`,
      {
        method: route.method,
        path: normalizedPath,
        ...route.metadata,
      },
      [`route.${routePathId}`],
    )
    const routeId = registerPluginRoute(manifest.name, routeSegment, {
      ...route,
      path: normalizedPath,
    })

    return track({
      dispose() {
        if (disposed) { return }
        disposed = true
        unregisterPluginRoute(routeId)
        unregisterPluginCapability(manifest.name, capability.id)
      },
    })
  }

  const mcp = {
    registerServer(config) {
      if (config.when) {
        return registerServerAfterAsyncPredicate(config, Promise.resolve(config.when()))
      }
      return track(registerPluginMcpServer(manifest.name, config))
    },
  } satisfies ServerPluginContext['mcp']

  const skills = {
    register(skill) {
      return track(registerOwnedPluginSkill(manifest.name, skill))
    },
  } satisfies ServerPluginContext['skills']

  const providers = {
    externalSources: {
      register(source) {
        return track(registerExternalProviderSource(manifest.name, source))
      },
    },
  } satisfies ServerPluginContext['providers']

  const issues = {
    externalSources: {
      register(source) {
        return track(registerExternalIssueSource(manifest.name, source))
      },
    },
  } satisfies ServerPluginContext['issues']

  const conversation = {
    adapters: {
      register(adapter) {
        return track(registerConversationBridgeAdapter(manifest.name, adapter))
      },
    },
  } satisfies ServerPluginContext['conversation']

  const runtimes = {
    register(runtime, metadata) {
      assertChatRuntime(runtime)
      const runtimeProvider = runtime
      if (runtimeProvider.runtimeKind !== metadata.runtimeKind) {
        throw new Error(`Plugin runtime metadata id ${metadata.runtimeKind} does not match runtime id ${runtimeProvider.runtimeKind}.`)
      }
      const capability = registerPluginCapability(
        manifest.name,
        'chat-runtime',
        'server',
        metadata.runtimeKind,
        metadata.label,
        {
          runtimeKind: metadata.runtimeKind,
          providerKinds: metadata.providerKinds,
          surfaces: metadata.surfaces ?? ['chat'],
          iconKey: metadata.iconKey,
        },
        [`runtime.${metadata.runtimeKind}`],
      )
      const runtimeMetadata: ChatRuntimeMetadata = {
        label: metadata.label,
        description: metadata.description,
        providerKinds: metadata.providerKinds as ProviderKind[],
        iconKey: metadata.iconKey,
        surfaces: metadata.surfaces,
        sortOrder: metadata.sortOrder,
      }
      registerRuntime(runtimeProvider, runtimeMetadata, manifest.name)
      return track({
        dispose() {
          unregisterRuntime(metadata.runtimeKind, manifest.name)
          unregisterPluginCapability(manifest.name, capability.id)
        },
      })
    },
  } satisfies ServerPluginContext['runtimes']

  const chatHooks = {
    onBeforeQuery(handler) {
      return track(registerOwnedBeforeQueryHook(manifest.name, handler))
    },
    onAfterResponse(handler) {
      return track(registerOwnedAfterResponseHook(manifest.name, handler))
    },
  } satisfies ServerPluginContext['hooks']['chat']

  const resources = {
    register(adapter) {
      if (!hostServices) { throw new Error('Plugin managed resources are unavailable in this host.') }
      const capability = registerPluginCapability(
        manifest.name,
        'managed-resource',
        'server',
        'resources',
        `${manifest.name} managed resources`,
        { namespace: resourceNamespace },
        ['resource.runtime', 'resources'],
      )
      const registration = hostServices.managedResources.registerAdapter(
        toHostManagedResourceAdapter(resourceNamespace, adapter),
      )
      return track({
        dispose() {
          registration.dispose()
          unregisterPluginCapability(manifest.name, capability.id)
        },
      })
    },
  } satisfies ServerPluginContext['resources']

  const downloads = {
    async execute(request) {
      if (!hostServices) { throw new Error('Plugin downloads are unavailable in this host.') }
      for (const source of request.sources) {
        const url = new URL(source.url)
        if (url.protocol !== 'https:') {
          throw new Error('Plugin downloads require HTTPS sources.')
        }
      }
      return await hostServices.downloadCenter.execute({
        ...request,
        owner: {
          ...request.owner,
          namespace: resourceNamespace,
        },
      })
    },
    async release(taskId) {
      if (!hostServices) { throw new Error('Plugin downloads are unavailable in this host.') }
      await hostServices.downloadCenter.release(taskId)
    },
  } satisfies ServerPluginContext['downloads']

  const secrets = {
    get(key) {
      try {
        return readSecret(pluginSecretId(manifest.name, key))
      }
      catch (error) {
        if (error instanceof AppError && error.code === 'secret_not_found') { return null }
        throw error
      }
    },
    set(key, value) {
      upsertSecret({
        id: pluginSecretId(manifest.name, key),
        kind: `system:plugin:${routeSegment}`,
        label: `${manifest.name} ${key}`,
        secret: value,
      })
    },
    delete(key) {
      removeSecret(pluginSecretId(manifest.name, key))
    },
  } satisfies ServerPluginContext['secrets']

  const processes = {
    ...processService,
    async spawn(spec) {
      if (!hostServices) { throw new Error('Plugin managed processes are unavailable in this host.') }
      if (!processCapabilities.has(spec.id)) {
        const capability = registerPluginCapability(
          manifest.name,
          'managed-process',
          'server',
          spec.id,
          spec.displayName,
          undefined,
          [`process.${spec.id}`, 'process.sidecar'],
        )
        processCapabilities.set(spec.id, capability.id)
        track({
          dispose() {
            unregisterPluginCapability(manifest.name, capability.id)
          },
        })
      }
      return await processService.spawn(spec)
    },
  } satisfies ServerPluginContext['processes']

  const lifecycle = {
    registerUninstall(handler) {
      const capability = registerPluginCapability(
        manifest.name,
        'lifecycle-uninstall',
        'server',
        'uninstall',
        `${manifest.name} uninstall lifecycle`,
        undefined,
        ['lifecycle.uninstall', 'uninstall'],
      )
      const registration = registerPluginUninstallHandler(manifest.name, handler)
      return track({
        dispose() {
          registration.dispose()
          unregisterPluginCapability(manifest.name, capability.id)
        },
      })
    },
  } satisfies ServerPluginContext['lifecycle']

  if (hostServices) {
    mkdirSync(dataDir, { recursive: true })
  }

  return {
    subscriptions,
    routes: {
      register: registerRoute,
    },
    mcp,
    skills,
    providers,
    issues,
    conversation,
    runtimes,
    storage: createPluginStorage(manifest.name),
    resources,
    downloads,
    paths: { dataDir },
    secrets,
    processes,
    lifecycle,
    logger,
    sharedConfig,
    manifest,
    hooks: {
      chat: chatHooks,
    },
    events: {
      on(event, handler) {
        return track(eventBus.on(event, handler))
      },
      emit: eventBus.emit,
    },
  }
}
