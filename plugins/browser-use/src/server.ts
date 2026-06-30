import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ServerPluginContext } from '@cradle/plugin-sdk/server'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function activate(ctx: ServerPluginContext): void {
  const socketPath = ctx.sharedConfig.get('BROWSER_BACKEND_SOCKET') ?? ''

  // Only register MCP server if the socket path is available (desktop deployment)
  if (socketPath) {
    ctx.mcp.registerServer({
      transport: 'stdio',
      name: 'browser-use',
      command: 'node',
      args: [resolve(__dirname, 'mcp-server.mjs')],
      env: { BROWSER_BACKEND_SOCKET: socketPath },
    })
  }

  // Register the browser-use skill for agent discovery
  const skillFile = resolve(__dirname, 'SKILL.md')
  ctx.skills.register({
    name: 'browser-use',
    description: 'Browser automation CLI for AI agents. Use when the user needs to interact with websites.',
    skillFile,
  })

  ctx.logger.info('Browser Use plugin activated')
}
