/* Verifies server plugin context registration and disposal behavior. */

import type { Disposable, PluginManifest } from '@cradle/plugin-sdk'
import { CradlePluginPackageJsonSchema } from '@cradle/plugin-sdk/manifest'
import type { UIMessageChunk } from 'ai'
import { afterEach, describe, expect, it } from 'vitest'

import { listRuntimeCatalog } from '../modules/chat-runtime/chat-runtime-provider-registry'
import type { ChatRuntime, ChatRuntimeCapabilities, ChatRuntimeMetadata } from '../modules/chat-runtime/runtime-provider-types'
import { createServerPluginContext } from './context'
import { listConversationBridgeAdapters, resetConversationBridgeAdapterRegistry } from './conversation-adapter-registry'
import { getRegisteredMcpServers } from './mcp-registry'
import { dispatchPluginRoute, resetPluginRouteRegistry } from './route-registry'
import {
  classifyPluginSource,
  createPluginDescriptor,
  listPluginDescriptors,
  registerPluginDescriptor,
  resetPluginRuntimeRegistry,
} from './runtime-registry'
import { getPluginSkills, resetPluginSkillRegistry } from './skill-registry'

function manifest(name: string): PluginManifest {
  const pkg = CradlePluginPackageJsonSchema.parse({
    name,
    version: '1.0.0',
    cradle: {
      apiVersion: '1',
      server: 'src/server.ts',
      contributes: {
        capabilities: [],
        permissions: [],
      },
    },
  })

  return {
    name: pkg.name,
    version: pkg.version,
    packageDir: `/plugins/${name}`,
    cradle: pkg.cradle,
  }
}

function registerDescriptor(pluginManifest: PluginManifest): void {
  registerPluginDescriptor(
    createPluginDescriptor(
      pluginManifest,
      classifyPluginSource(pluginManifest.packageDir, '/plugins'),
    ),
  )
}

describe('server plugin context lifecycle', () => {
  afterEach(() => {
    resetPluginRuntimeRegistry()
    resetPluginRouteRegistry()
    resetPluginSkillRegistry()
    resetConversationBridgeAdapterRegistry()
  })

  it('skips MCP registration when an async predicate returns false', async () => {
    const pluginManifest = manifest('@cradle/context-async-skip')
    registerDescriptor(pluginManifest)
    const ctx = createServerPluginContext(pluginManifest)

    const disposable = await ctx.mcp.registerServer({
      transport: 'stdio',
      name: 'context-async-skip',
      command: 'node',
      args: ['server.mjs'],
      when: async () => false,
    })

    expect(disposable).toBeUndefined()
    expect(ctx.subscriptions).toHaveLength(1)
    expect(getRegisteredMcpServers()).not.toHaveProperty('context-async-skip')
    expect(listPluginDescriptors()[0]?.capabilities).toHaveLength(0)
  })

  it('does not register an async MCP server after the pending subscription is disposed', async () => {
    const pluginManifest = manifest('@cradle/context-async-dispose')
    registerDescriptor(pluginManifest)
    const ctx = createServerPluginContext(pluginManifest)

    let resolvePredicate: (value: boolean) => void = () => {}
    const registration = ctx.mcp.registerServer({
      transport: 'stdio',
      name: 'context-async-dispose',
      command: 'node',
      args: ['server.mjs'],
      when: () => new Promise<boolean>((resolve) => {
        resolvePredicate = resolve
      }),
    })

    expect(ctx.subscriptions).toHaveLength(1)
    ctx.subscriptions[0]?.dispose()
    resolvePredicate(true)
    await registration

    expect(getRegisteredMcpServers()).not.toHaveProperty('context-async-dispose')
    expect(listPluginDescriptors()[0]?.capabilities).toHaveLength(0)
  })

  it('tracks MCP registrations and removes registry plus capability records on dispose', () => {
    const pluginManifest = manifest('@cradle/context-dispose')
    registerDescriptor(pluginManifest)
    const ctx = createServerPluginContext(pluginManifest)

    const disposable = ctx.mcp.registerServer({
      transport: 'stdio',
      name: 'context-dispose',
      command: 'node',
      args: ['server.mjs'],
    }) as Disposable

    expect(ctx.subscriptions).toEqual([disposable])
    expect(getRegisteredMcpServers()).toHaveProperty('context-dispose', {
      transport: 'stdio',
      name: 'context-dispose',
      command: 'node',
      args: ['server.mjs'],
      env: {},
    })
    expect(listPluginDescriptors()[0]?.capabilities).toEqual([
      expect.objectContaining({
        type: 'mcp-server',
        metadata: expect.objectContaining({
          transport: 'stdio',
          command: 'node',
          args: ['server.mjs'],
          hasEnv: false,
        }),
      }),
    ])

    disposable.dispose()

    expect(getRegisteredMcpServers()).not.toHaveProperty('context-dispose')
    expect(listPluginDescriptors()[0]?.capabilities).toHaveLength(0)
  })

  it('tracks streamable HTTP MCP registrations without exposing headers in capability metadata', () => {
    const pluginManifest = manifest('@cradle/context-http-mcp')
    registerDescriptor(pluginManifest)
    const ctx = createServerPluginContext(pluginManifest)

    const disposable = ctx.mcp.registerServer({
      transport: 'streamable-http',
      name: 'context-http-mcp',
      url: 'https://nowledge.example.test/mcp',
      headers: {
        Authorization: 'Bearer secret-token',
      },
    }) as Disposable

    expect(ctx.subscriptions).toEqual([disposable])
    expect(getRegisteredMcpServers()).toHaveProperty('context-http-mcp', {
      transport: 'streamable-http',
      name: 'context-http-mcp',
      url: 'https://nowledge.example.test/mcp',
      headers: {
        Authorization: 'Bearer secret-token',
      },
    })
    expect(listPluginDescriptors()[0]?.capabilities).toEqual([
      expect.objectContaining({
        type: 'mcp-server',
        metadata: expect.objectContaining({
          transport: 'streamable-http',
          urlOrigin: 'https://nowledge.example.test',
          urlPathname: '/mcp',
          hasHeaders: true,
        }),
      }),
    ])
    expect(JSON.stringify(listPluginDescriptors()[0]?.capabilities)).not.toContain('secret-token')
    expect(JSON.stringify(listPluginDescriptors()[0]?.capabilities)).not.toContain('Authorization')

    disposable.dispose()

    expect(getRegisteredMcpServers()).not.toHaveProperty('context-http-mcp')
    expect(listPluginDescriptors()[0]?.capabilities).toHaveLength(0)
  })

  it('skips streamable HTTP MCP registration when an async predicate returns false', async () => {
    const pluginManifest = manifest('@cradle/context-http-async-skip')
    registerDescriptor(pluginManifest)
    const ctx = createServerPluginContext(pluginManifest)

    const disposable = await ctx.mcp.registerServer({
      transport: 'streamable-http',
      name: 'context-http-async-skip',
      url: 'https://nowledge.example.test/mcp',
      when: async () => false,
    })

    expect(disposable).toBeUndefined()
    expect(ctx.subscriptions).toHaveLength(1)
    expect(getRegisteredMcpServers()).not.toHaveProperty('context-http-async-skip')
    expect(listPluginDescriptors()[0]?.capabilities).toHaveLength(0)
  })

  it('tracks skill registrations and removes capability records on dispose', () => {
    const pluginManifest = manifest('@cradle/context-skill')
    registerDescriptor(pluginManifest)
    const ctx = createServerPluginContext(pluginManifest)

    const disposable = ctx.skills.register({
      name: 'context-skill',
      description: 'A test skill',
      skillFile: '/tmp/SKILL.md',
    })

    expect(ctx.subscriptions).toEqual([disposable])
    expect(listPluginDescriptors()[0]?.capabilities.map(capability => capability.type)).toEqual(['skill'])
    expect(getPluginSkills()).toEqual([{
      owner: '@cradle/context-skill',
      skill: {
        name: 'context-skill',
        description: 'A test skill',
        skillFile: '/tmp/SKILL.md',
      },
    }])

    disposable.dispose()

    expect(listPluginDescriptors()[0]?.capabilities).toHaveLength(0)
    expect(getPluginSkills()).toEqual([])
  })

  it('supports namespace registration APIs without changing capability ownership', () => {
    const pluginManifest = manifest('@cradle/context-namespaces')
    registerDescriptor(pluginManifest)
    const ctx = createServerPluginContext(pluginManifest)

    const mcp = ctx.mcp.registerServer({
      transport: 'stdio',
      name: 'context-namespaces',
      command: 'node',
      args: ['server.mjs'],
    }) as Disposable
    const skill = ctx.skills.register({
      name: 'context-namespaces',
      description: 'A namespaced test skill',
      skillFile: '/tmp/SKILL.md',
    })
    const hook = ctx.hooks.chat.onAfterResponse(async () => {})

    expect(ctx.subscriptions).toEqual([mcp, skill, hook])
    expect(listPluginDescriptors()[0]?.capabilities.map(capability => capability.type)).toEqual([
      'mcp-server',
      'skill',
      'hook',
    ])

    for (const subscription of [...ctx.subscriptions].reverse()) {
      subscription.dispose()
    }

    expect(getRegisteredMcpServers()).not.toHaveProperty('context-namespaces')
    expect(listPluginDescriptors()[0]?.capabilities).toHaveLength(0)
  })

  it('tracks route registrations and removes handlers on dispose', async () => {
    const pluginManifest = manifest('@cradle/context-route')
    registerDescriptor(pluginManifest)
    const ctx = createServerPluginContext(pluginManifest)

    const disposable = ctx.routes.register({
      method: 'GET',
      path: '/status',
      handler: () => ({ ok: true }),
    })

    expect(ctx.subscriptions).toEqual([disposable])
    expect(listPluginDescriptors()[0]?.capabilities.map(capability => capability.type)).toEqual(['server-route'])

    const activeResponse = await dispatchPluginRoute({
      routeSegment: 'context-route',
      method: 'GET',
      path: '/status',
      body: undefined,
      query: {},
      headers: {},
      set: {},
    })
    expect(activeResponse).toEqual({ found: true, body: { ok: true } })

    disposable.dispose()

    expect(listPluginDescriptors()[0]?.capabilities).toHaveLength(0)

    const disposedResponse = await dispatchPluginRoute({
      routeSegment: 'context-route',
      method: 'GET',
      path: '/status',
      body: undefined,
      query: {},
      headers: {},
      set: {},
    })
    expect(disposedResponse).toEqual({ found: false })
  })

  it('tracks plugin chat runtime registrations and removes them on dispose', () => {
    const pluginManifest = manifest('@cradle/context-runtime')
    registerDescriptor(pluginManifest)
    const ctx = createServerPluginContext(pluginManifest)
    const runtime = {
      runtimeKind: 'plugin-runtime',
      metadata: {
        label: 'Plugin Runtime',
        providerKinds: ['openai-compatible'],
      } satisfies ChatRuntimeMetadata,
      capabilities: {
        supportsSteerTurn: false,
        supportsShellExecution: false,
        supportsLastTurnRollback: false,
        supportsRuntimeSettings: false,
        supportsUiSlotStates: false,
        supportsDynamicCapabilities: false,
        supportsTitleGeneration: false,
        sessionModelSwitch: 'unsupported',
      } satisfies ChatRuntimeCapabilities,
      async startChatSession(input) {
        return {
          id: input.chatSessionId,
          chatSessionId: input.chatSessionId,
          providerTargetId: input.profile?.providerTargetId ?? failPluginRuntimeProfile(),
          runtimeKind: 'plugin-runtime',
          providerSessionId: null,
          providerStateSnapshot: null,
        }
      },
      async resumeChatSession(input) {
        return input.runtimeSession
      },
      async* streamTurn(): AsyncGenerator<UIMessageChunk, void, void> {},
      async cancelTurn() {},
    } satisfies ChatRuntime

    const disposable = ctx.runtimes.register(runtime, {
      runtimeKind: 'plugin-runtime',
      label: 'Plugin Runtime',
      description: 'Runtime from a server plugin',
      providerKinds: ['openai-compatible'],
      surfaces: ['chat', 'jarvis'],
    })

    expect(ctx.subscriptions).toEqual([disposable])
    expect(listPluginDescriptors()[0]?.capabilities.map(capability => capability.type)).toEqual(['chat-runtime'])
    expect(listRuntimeCatalog()).toContainEqual(expect.objectContaining({
      runtimeKind: 'plugin-runtime',
      label: 'Plugin Runtime',
      source: 'plugin',
      pluginOwner: '@cradle/context-runtime',
      surfaces: ['chat', 'jarvis'],
    }))

    disposable.dispose()

    expect(listRuntimeCatalog().some(runtime => runtime.runtimeKind === 'plugin-runtime')).toBe(false)
    expect(listPluginDescriptors()[0]?.capabilities).toHaveLength(0)
  })

  it('tracks conversation adapter registrations and removes capability records on dispose', () => {
    const pluginManifest = manifest('@cradle/context-conversation')
    registerDescriptor(pluginManifest)
    const ctx = createServerPluginContext(pluginManifest)

    const disposable = ctx.conversation.adapters.register({
      id: 'test-chat',
      platform: 'test',
      label: 'Test Chat',
      createRuntime: () => ({
        async start() {},
        async stop() {},
        async sendMessage() {
          return { externalMessageId: null }
        },
      }),
    })

    expect(ctx.subscriptions).toEqual([disposable])
    expect(listConversationBridgeAdapters()).toEqual([
      expect.objectContaining({
        key: '@cradle/context-conversation:test-chat',
        owner: '@cradle/context-conversation',
        adapter: expect.objectContaining({
          id: 'test-chat',
          platform: 'test',
          label: 'Test Chat',
        }),
      }),
    ])
    expect(listPluginDescriptors()[0]?.capabilities).toEqual([
      expect.objectContaining({
        type: 'conversation-adapter',
        metadata: expect.objectContaining({
          platform: 'test',
        }),
      }),
    ])

    disposable.dispose()

    expect(listConversationBridgeAdapters()).toEqual([])
    expect(listPluginDescriptors()[0]?.capabilities).toHaveLength(0)
  })
})

function failPluginRuntimeProfile(): never {
  throw new Error('plugin test runtime requires a provider target profile')
}
