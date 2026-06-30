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
    })
    addHostMcpServer({
      transport: 'streamable-http',
      name: 'nowledge-mem',
      url: 'https://nowledge.example.test/mcp',
      headers: { Authorization: 'Bearer secret-token' },
    })

    expect(listRegisteredAcpMcpServers()).toEqual([
      {
        name: 'browser-use',
        command: 'node',
        args: ['/plugins/browser-use/dist/mcp-server.mjs'],
        env: [{ name: 'BROWSER_BACKEND_SOCKET', value: '/tmp/cradle-browser.sock' }],
      },
    ])
    expect(JSON.stringify(listRegisteredAcpMcpServers())).not.toContain('secret-token')
  })
})
