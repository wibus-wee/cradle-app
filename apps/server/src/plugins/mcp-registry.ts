import type { Disposable } from '@cradle/plugin-sdk'
import type { McpServerConfig } from '@cradle/plugin-sdk/server'
import { z } from 'zod'

import { registerPluginCapability, unregisterPluginCapability } from './runtime-registry'

const McpServerNameSchema = z.string().trim().min(1)

const StdioMcpServerConfigSchema = z.object({
  transport: z.literal('stdio'),
  name: McpServerNameSchema,
  command: z.string().trim().min(1),
  args: z.array(z.string()),
  env: z.record(z.string(), z.string()).default({}),
  timeout: z.number().positive().optional(),
  scope: z.enum(['global', 'chat-session']).default('global'),
  when: z.function().optional(),
})

const StreamableHttpMcpServerConfigSchema = z.object({
  transport: z.literal('streamable-http'),
  name: McpServerNameSchema,
  url: z.string().trim().url(),
  headers: z.record(z.string(), z.string()).default({}),
  timeout: z.number().positive().optional(),
  scope: z.enum(['global', 'chat-session']).default('global'),
  when: z.function().optional(),
})

const McpServerConfigSchema = z.discriminatedUnion('transport', [
  StdioMcpServerConfigSchema,
  StreamableHttpMcpServerConfigSchema,
])

type RegisteredMcpServerConfig = z.infer<typeof McpServerConfigSchema>
type RegisteredStdioMcpServerConfig = z.infer<typeof StdioMcpServerConfigSchema>

export interface RegisteredStdioMcpServer {
  transport: 'stdio'
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  timeout?: number
}

export interface RegisteredStreamableHttpMcpServer {
  transport: 'streamable-http'
  name: string
  url: string
  headers: Record<string, string>
  timeout?: number
}

export type RegisteredMcpServer = RegisteredStdioMcpServer | RegisteredStreamableHttpMcpServer

export interface McpInvocationContext {
  chatSessionId: string
}

const registry = new Map<string, RegisteredMcpServerConfig>()
const customRegistry = new Map<string, RegisteredMcpServerConfig>()

export function addHostMcpServer(config: McpServerConfig): void {
  const registered = McpServerConfigSchema.parse(config)
  registry.set(registered.name, registered)
}

export function registerHostMcpServer(owner: string, config: McpServerConfig): Disposable {
  const registered = McpServerConfigSchema.parse(config)
  if (customRegistry.has(registered.name)) {
    throw new Error(`Duplicate MCP server registration: ${registered.name}`)
  }
  const record = registerPluginCapability(
    owner,
    'mcp-server',
    'server',
    config.name,
    config.name,
    projectCapabilityMetadata(registered),
    [`mcp.${config.name}`],
  )
  registry.set(registered.name, registered)
  let disposed = false
  return {
    dispose() {
      if (disposed) { return }
      disposed = true
      registry.delete(config.name)
      unregisterPluginCapability(owner, record.id)
    },
  }
}

export function registerPluginMcpServer(owner: string, config: McpServerConfig): Disposable {
  if (registry.has(config.name) || customRegistry.has(config.name)) {
    throw new Error(`Duplicate MCP server registration: ${config.name}`)
  }
  return registerHostMcpServer(owner, config)
}

export function removeHostMcpServer(name: string): void {
  registry.delete(name)
}

export function hasHostMcpServer(name: string): boolean {
  return registry.has(name)
}

export function replaceCustomMcpServers(configs: McpServerConfig[]): void {
  const next = new Map<string, RegisteredMcpServerConfig>()
  for (const config of configs) {
    const registered = McpServerConfigSchema.parse(config)
    if (registry.has(registered.name) || next.has(registered.name)) {
      throw new Error(`Duplicate MCP server registration: ${registered.name}`)
    }
    next.set(registered.name, registered)
  }

  customRegistry.clear()
  for (const [name, config] of next) {
    customRegistry.set(name, config)
  }
}

export function clearCustomMcpServers(): void {
  customRegistry.clear()
}

export function getRegisteredMcpServers(context?: McpInvocationContext): Record<string, RegisteredMcpServer> {
  return Object.fromEntries(
    [...registry, ...customRegistry].flatMap(([name, config]) => {
      if (config.scope === 'chat-session' && !context) {
        return []
      }
      return [[name, projectRuntimeConfig(config, context)]]
    }),
  )
}

export function getRegisteredStdioMcpServers(context?: McpInvocationContext): Record<string, RegisteredStdioMcpServer> {
  return Object.fromEntries(
    [...registry, ...customRegistry]
      .filter((entry): entry is [string, RegisteredStdioMcpServerConfig] => entry[1].transport === 'stdio')
      .flatMap(([name, config]) => {
        if (config.scope === 'chat-session' && !context) {
          return []
        }
        return [[name, projectStdioRuntimeConfig(config, context)]]
      }),
  )
}

function projectRuntimeConfig(
  config: RegisteredMcpServerConfig,
  context?: McpInvocationContext,
): RegisteredMcpServer {
  if (config.transport === 'stdio') {
    return projectStdioRuntimeConfig(config, context)
  }

  return {
    transport: 'streamable-http',
    name: config.name,
    url: config.url,
    ...(config.timeout !== undefined ? { timeout: config.timeout } : {}),
    headers: config.scope === 'chat-session' && context
      ? { ...config.headers, 'x-cradle-chat-session-id': context.chatSessionId }
      : config.headers,
  }
}

function projectStdioRuntimeConfig(
  config: RegisteredStdioMcpServerConfig,
  context?: McpInvocationContext,
): RegisteredStdioMcpServer {
  return {
    transport: 'stdio',
    name: config.name,
    command: config.command,
    args: config.args,
    env: config.scope === 'chat-session' && context
      ? { ...config.env, CRADLE_CHAT_SESSION_ID: context.chatSessionId }
      : config.env,
    ...(config.timeout !== undefined ? { timeout: config.timeout } : {}),
  }
}

function projectCapabilityMetadata(config: RegisteredMcpServerConfig): Record<string, unknown> {
  if (config.transport === 'stdio') {
    return {
      transport: 'stdio',
      command: config.command,
      args: config.args,
      hasEnv: Object.keys(config.env).length > 0,
      timeout: config.timeout ?? null,
      scope: config.scope,
    }
  }

  const url = new URL(config.url)
  return {
    transport: 'streamable-http',
    urlOrigin: url.origin,
    urlPathname: url.pathname,
    hasHeaders: Object.keys(config.headers).length > 0,
    timeout: config.timeout ?? null,
    scope: config.scope,
  }
}
