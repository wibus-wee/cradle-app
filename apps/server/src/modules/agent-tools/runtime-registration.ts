import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { getServerConfig } from '../../infra'
import { addHostMcpServer } from '../../plugins/mcp-registry'
import { AGENT_TOOLS_MCP_SERVER_NAME } from './server'

const require = createRequire(import.meta.url)

function resolveMcpEntryArgs(): string[] {
  if (import.meta.url.endsWith('.ts')) {
    return [
      '--import',
      pathToFileURL(require.resolve('tsx')).href,
      fileURLToPath(new URL('./mcp-entry.ts', import.meta.url)),
    ]
  }
  const serverEntryPath = process.argv[1]
  if (!serverEntryPath) {
    throw new Error('Cannot resolve the Cradle server runtime entry path')
  }
  return [resolve(dirname(serverEntryPath), 'agent-tools-mcp.js')]
}

export function registerAgentToolsMcpServer(): void {
  const config = getServerConfig()
  addHostMcpServer({
    transport: 'stdio',
    name: AGENT_TOOLS_MCP_SERVER_NAME,
    command: process.execPath,
    args: resolveMcpEntryArgs(),
    env: {
      CRADLE_SERVER_URL: `http://127.0.0.1:${config.port}`,
    },
  })
}
