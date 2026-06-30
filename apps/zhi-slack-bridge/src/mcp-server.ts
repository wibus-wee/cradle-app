import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import { callBridge } from './bridge-client.js'

const SOCKET_PATH = process.env.ZHI_SOCKET_PATH || '/tmp/zhi-bridge.sock'
const RETRY_DELAY_MS = Number(process.env.ZHI_BRIDGE_RETRY_MS || 1000)

/**
 * MCP server that exposes the `zhi` tool.
 * Runs as a stdio MCP server (spawned by agent hosts like VS Code / Claude Desktop).
 * Forwards zhi calls to the bridge via Unix socket.
 */

const server = new McpServer({
  name: 'zhi-slack',
  version: '0.1.0',
})

server.tool(
  'zhi',
  '将 Markdown 消息转发到 Slack thread，并等待用户回复',
  {
    message: z.string().describe('要显示给用户的消息'),
  },
  async ({ message }) => {
    try {
      const response = await callBridge(message, {
        socketPath: SOCKET_PATH,
        retryDelayMs: RETRY_DELAY_MS,
      })
      if (response.success) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                user_input: response.result.user_input,
                selected_options: response.result.selected_options,
                images: [],
                metadata: {
                  request_id: crypto.randomUUID(),
                  source: 'slack',
                  timestamp: new Date().toISOString(),
                },
              }),
            },
          ],
        }
      }
 else {
        return {
          content: [{ type: 'text' as const, text: `Error: ${response.error}` }],
          isError: true,
        }
      }
    }
 catch (err) {
      return {
        content: [{ type: 'text' as const, text: `Bridge connection error: ${(err as Error).message}` }],
        isError: true,
      }
    }
  },
)

interface _BridgeResponse {
  success: boolean
  result?: { user_input: string, selected_options: string[] }
  error?: string
}

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[mcp-server] Zhi MCP server started (stdio mode)')
}

main().catch((err) => {
  console.error('[mcp-server] Fatal:', err)
  process.exit(1)
})
