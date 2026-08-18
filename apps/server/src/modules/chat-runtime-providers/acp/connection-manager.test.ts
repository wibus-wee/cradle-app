import { afterEach, describe, expect, it } from 'vitest'

import { addHostMcpServer, removeHostMcpServer } from '../../../plugins/mcp-registry'
import { listRegisteredAcpMcpServers } from './connection-manager'

describe('listRegisteredAcpMcpServers', () => {
  afterEach(() => {
    removeHostMcpServer('browser-use')
    removeHostMcpServer('nowledge-mem')
  })

  it('projects stdio MCP servers and skips streamable HTTP MCP servers', () => {
    addHostMcpServer({
      transport: 'stdio',
      name: 'browser-use',
      command: 'node',
      args: ['/plugins/browser-use/dist/mcp-server.mjs'],
      env: { BROWSER_BACKEND_SOCKET: '/tmp/cradle-browser.sock' },
      scope: 'chat-session',
    })
    addHostMcpServer({
      transport: 'streamable-http',
      name: 'nowledge-mem',
      url: 'https://nowledge.example.test/mcp',
      headers: { Authorization: 'Bearer secret-token' },
    })

    expect(listRegisteredAcpMcpServers()).toEqual([])
    expect(listRegisteredAcpMcpServers('session-a')).toEqual([
      {
        name: 'browser-use',
        command: 'node',
        args: ['/plugins/browser-use/dist/mcp-server.mjs'],
        env: [
          { name: 'BROWSER_BACKEND_SOCKET', value: '/tmp/cradle-browser.sock' },
          { name: 'CRADLE_CHAT_SESSION_ID', value: 'session-a' },
        ],
      },
    ])
    expect(JSON.stringify(listRegisteredAcpMcpServers('session-a'))).not.toContain('secret-token')
  })
})
