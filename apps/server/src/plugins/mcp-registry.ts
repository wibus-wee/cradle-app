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
  when: z.function().optional(),
})

const StreamableHttpMcpServerConfigSchema = z.object({
  transport: z.literal('streamable-http'),
  name: McpServerNameSchema,
  url: z.string().trim().url(),
  headers: z.record(z.string(), z.string()).default({}),
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
}

export interface RegisteredStreamableHttpMcpServer {
  transport: 'streamable-http'
  name: string
  url: string
  headers: Record<string, string>
}

export type RegisteredMcpServer = RegisteredStdioMcpServer | RegisteredStreamableHttpMcpServer

const registry = new Map<string, RegisteredMcpServerConfig>()

export function addHostMcpServer(config: McpServerConfig): void {
  const registered = McpServerConfigSchema.parse(config)
  registry.set(registered.name, registered)
}

export function registerHostMcpServer(owner: string, config: McpServerConfig): Disposable {
  const registered = McpServerConfigSchema.parse(config)
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
  if (registry.has(config.name)) {
    throw new Error(`Duplicate MCP server registration: ${config.name}`)
  }
  return registerHostMcpServer(owner, config)
}

export function removeHostMcpServer(name: string): void {
  registry.delete(name)
}

export function getRegisteredMcpServers(): Record<string, RegisteredMcpServer> {
  return Object.fromEntries(
    Array.from(registry.entries(), ([name, config]) => [name, projectRuntimeConfig(config)]),
  )
}

export function getRegisteredStdioMcpServers(): Record<string, RegisteredStdioMcpServer> {
  return Object.fromEntries(
    Array.from(registry.entries())
      .filter((entry): entry is [string, RegisteredStdioMcpServerConfig] => entry[1].transport === 'stdio')
      .map(([name, config]) => [name, projectStdioRuntimeConfig(config)]),
  )
}

function projectRuntimeConfig(config: RegisteredMcpServerConfig): RegisteredMcpServer {
  if (config.transport === 'stdio') {
    return projectStdioRuntimeConfig(config)
  }

  return {
    transport: 'streamable-http',
    name: config.name,
    url: config.url,
    headers: config.headers,
  }
}

function projectStdioRuntimeConfig(config: RegisteredStdioMcpServerConfig): RegisteredStdioMcpServer {
  return {
    transport: 'stdio',
    name: config.name,
    command: config.command,
    args: config.args,
    env: config.env,
  }
}

function projectCapabilityMetadata(config: RegisteredMcpServerConfig): Record<string, unknown> {
  if (config.transport === 'stdio') {
    return {
      transport: 'stdio',
      command: config.command,
      args: config.args,
      hasEnv: Object.keys(config.env).length > 0,
    }
  }

  const url = new URL(config.url)
  return {
    transport: 'streamable-http',
    urlOrigin: url.origin,
    urlPathname: url.pathname,
    hasHeaders: Object.keys(config.headers).length > 0,
  }
}
