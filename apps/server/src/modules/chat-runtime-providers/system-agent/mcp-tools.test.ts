import { describe, expect, it } from 'vitest'

import { createSystemAgentMcpTools } from './mcp-tools'

const MCP_SERVER_SOURCE = `
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
const server = new Server({ name: 'fixture', version: '1.0.0' }, { capabilities: { tools: {} } })
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'echo',
    description: 'Echo a value',
    inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
  }],
}))
server.setRequestHandler(CallToolRequestSchema, async request => ({
  content: [{ type: 'text', text: 'echo:' + request.params.arguments.value }],
}))
await server.connect(new StdioServerTransport())
`

const BROKEN_MCP_SERVER_SOURCE = `
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
const server = new Server({ name: 'broken-fixture', version: '1.0.0' }, { capabilities: { tools: {} } })
server.setRequestHandler(ListToolsRequestSchema, async () => { throw new Error('discovery failed') })
await server.connect(new StdioServerTransport())
`

describe('system agent MCP tools', () => {
  it('discovers and calls qualified tools through a real stdio MCP transport', async () => {
    const connected = await createSystemAgentMcpTools({
      fixture: {
        transport: 'stdio',
        name: 'fixture',
        command: process.execPath,
        args: ['--input-type=module', '--eval', MCP_SERVER_SOURCE],
        env: {},
      },
    })

    try {
      expect(connected.tools.map(tool => tool.name)).toEqual(['mcp__fixture__echo'])
      const result = await connected.tools[0]!.execute('call-1', { value: 'hello' })
      expect(result.content).toEqual([{ type: 'text', text: 'echo:hello' }])
    }
    finally {
      await connected.close()
    }
  })

  it('keeps healthy servers available when another server fails tool discovery', async () => {
    const connected = await createSystemAgentMcpTools({
      fixture: {
        transport: 'stdio',
        name: 'fixture',
        command: process.execPath,
        args: ['--input-type=module', '--eval', MCP_SERVER_SOURCE],
        env: {},
      },
      broken: {
        transport: 'stdio',
        name: 'broken',
        command: process.execPath,
        args: ['--input-type=module', '--eval', BROKEN_MCP_SERVER_SOURCE],
        env: {},
      },
    })

    try {
      expect(connected.tools.map(tool => tool.name)).toEqual(['mcp__fixture__echo'])
    }
    finally {
      await connected.close()
    }
  })
})
