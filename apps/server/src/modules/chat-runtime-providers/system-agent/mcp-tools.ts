import type { RuntimeLogger } from '@cradle/chat-runtime-contracts'
import type { executeIngressCommand } from '@hijarvis/core'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'

import type { RegisteredMcpServer } from '../../../plugins/mcp-registry'
import { getRegisteredMcpServers } from '../../../plugins/mcp-registry'

type SystemAgentTool = NonNullable<NonNullable<Parameters<typeof executeIngressCommand>[0]['pluginOverrides']>['tools']>[number]

interface ConnectedMcpClient {
  client: Client
  serverName: string
}

const MCP_DISCOVERY_TIMEOUT_MS = 10_000

export interface SystemAgentMcpTools {
  tools: SystemAgentTool[]
  close: () => Promise<void>
}

export async function createSystemAgentMcpTools(
  servers: Record<string, RegisteredMcpServer> = getRegisteredMcpServers(),
  logger?: RuntimeLogger,
): Promise<SystemAgentMcpTools> {
  const connections = (await Promise.all(
    Object.entries(servers).map(async ([serverName, server]) => {
      const client = new Client({ name: 'cradle-jarvis', version: '1.0.0' })
      try {
        await client.connect(createTransport(server), { timeout: MCP_DISCOVERY_TIMEOUT_MS })
        return { client, serverName } satisfies ConnectedMcpClient
      }
      catch (error) {
        await client.close().catch(() => {})
        logger?.warn('system agent MCP server connection failed', {
          server: serverName,
          error: error instanceof Error ? error.message : String(error),
        })
        return null
      }
    }),
  )).filter((connection): connection is ConnectedMcpClient => connection !== null)

  const tools = (await Promise.all(connections.map(async ({ client, serverName }) => {
    try {
      const listed = await client.listTools(undefined, { timeout: MCP_DISCOVERY_TIMEOUT_MS })
      return listed.tools.map(tool => createSystemAgentTool({
        client,
        serverName,
        toolName: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }))
    }
    catch (error) {
      await client.close().catch(() => {})
      logger?.warn('system agent MCP tool discovery failed', {
        server: serverName,
        error: error instanceof Error ? error.message : String(error),
      })
      return []
    }
  }))).flat()

  return {
    tools,
    close: async () => {
      await Promise.allSettled(connections.map(connection => connection.client.close()))
    },
  }
}

function createTransport(server: RegisteredMcpServer): Transport {
  if (server.transport === 'stdio') {
    return new StdioClientTransport({
      command: server.command,
      args: server.args,
      env: { ...getDefaultEnvironment(), ...server.env },
    })
  }

  return new StreamableHTTPClientTransport(new URL(server.url), {
    ...(Object.keys(server.headers).length > 0 ? { requestInit: { headers: server.headers } } : {}),
  })
}

function createSystemAgentTool(input: {
  client: Client
  serverName: string
  toolName: string
  description?: string
  inputSchema: Record<string, unknown>
}): SystemAgentTool {
  return {
    name: `mcp__${input.serverName}__${input.toolName}`,
    label: `${input.serverName}: ${input.toolName}`,
    description: input.description ?? `MCP tool ${input.toolName} from ${input.serverName}`,
    parameters: input.inputSchema as SystemAgentTool['parameters'],
    execute: async (_toolCallId, params, signal) => {
      const result = await input.client.callTool(
        {
          name: input.toolName,
          arguments: params as Record<string, unknown>,
        },
        undefined,
        signal ? { signal } : undefined,
      )
      const parsedResult = CallToolResultSchema.parse(result)
      const text = parsedResult.content
        .map(item => item.type === 'text' ? item.text : JSON.stringify(item))
        .filter(Boolean)
        .join('\n')
      return {
        content: [{ type: 'text', text: text || '(MCP tool returned no text content)' }],
        details: parsedResult,
      }
    },
  }
}
