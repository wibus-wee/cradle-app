import type { Disposable, PluginManifest } from '@cradle/plugin-sdk'
import { derivePluginRouteSegment } from '@cradle/plugin-sdk'
import type { McpServerConfig, ServerPluginContext, ServerPluginRouteRegistration } from '@cradle/plugin-sdk/server'

import { createChildLogger } from '../logging/logger'
import { assertChatRuntime, registerRuntime, unregisterRuntime } from '../modules/chat-runtime/chat-runtime-provider-registry'
import type { ChatRuntimeMetadata } from '../modules/chat-runtime/runtime-provider-types'
import type { ProviderKind } from '../modules/provider-contracts/types'
import { registerConversationBridgeAdapter } from './conversation-adapter-registry'
import { createPluginEventBus } from './event-bus'
import { registerExternalIssueSource } from './external-issue-source-registry'
import { registerExternalProviderSource } from './external-provider-source-registry'
import { registerOwnedAfterResponseHook, registerOwnedBeforeQueryHook } from './hooks'
import { registerPluginMcpServer } from './mcp-registry'
import { normalizePluginRoutePath, registerPluginRoute, unregisterPluginRoute } from './route-registry'
import { registerPluginCapability, unregisterPluginCapability } from './runtime-registry'
import { registerOwnedPluginSkill } from './skill-registry'
import { createPluginStorage } from './storage'

interface ServerPluginContextOptions {
  routeSegment?: string
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
