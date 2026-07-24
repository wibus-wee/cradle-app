import { afterEach, describe, expect, it } from 'vitest'

import {
  addHostMcpServer,
  clearCustomMcpServers,
  getRegisteredMcpServers,
  getRegisteredStdioMcpServers,
  removeHostMcpServer,
  replaceCustomMcpServers,
} from './mcp-registry'

describe('custom MCP server registry projection', () => {
  afterEach(() => {
    clearCustomMcpServers()
    removeHostMcpServer('built-in')
  })

  it('combines custom servers with host servers and limits the ACP projection to stdio', () => {
    addHostMcpServer({
      transport: 'stdio',
      name: 'built-in',
      command: 'node',
      args: ['built-in.mjs'],
      env: {},
    })
    replaceCustomMcpServers([{
      transport: 'streamable-http',
      name: 'remote',
      url: 'https://mcp.example.test/mcp',
      headers: { Authorization: 'Bearer secret' },
    }])

    expect(Object.keys(getRegisteredMcpServers()).sort()).toEqual(['built-in', 'remote'])
    expect(Object.keys(getRegisteredStdioMcpServers())).toEqual(['built-in'])
  })

  it('keeps the previous custom projection when a replacement conflicts with a host server', () => {
    addHostMcpServer({
      transport: 'stdio',
      name: 'built-in',
      command: 'node',
      args: ['built-in.mjs'],
      env: {},
    })
    replaceCustomMcpServers([{
      transport: 'stdio',
      name: 'custom',
      command: 'node',
      args: ['custom.mjs'],
      env: {},
    }])

    expect(() => replaceCustomMcpServers([{
      transport: 'stdio',
      name: 'built-in',
      command: 'node',
      args: ['conflict.mjs'],
      env: {},
    }])).toThrow('Duplicate MCP server registration: built-in')
    expect(Object.keys(getRegisteredMcpServers()).sort()).toEqual(['built-in', 'custom'])
  })
})
