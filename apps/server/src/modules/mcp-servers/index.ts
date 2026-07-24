import { Elysia, t } from 'elysia'

import { McpServersModel } from './model'
import { getCustomMcpServerService } from './service'

export const mcpServers = new Elysia({
  prefix: '/mcp-servers',
  detail: { tags: ['mcp-servers'] },
})
  .get('/', async () => await getCustomMcpServerService().list(), {
    detail: {
      'summary': 'List custom MCP servers',
      'x-cradle-cli': { command: ['mcp-server', 'list'] },
    },
    response: { 200: t.Array(McpServersModel.summary) },
  })
  .post('/', async ({ body }) => await getCustomMcpServerService().create(body), {
    detail: {
      summary: 'Create a custom MCP server',
      description: 'Sensitive env or header values are encrypted and are intentionally not exposed through the CLI.',
    },
    body: McpServersModel.saveBody,
    response: { 200: McpServersModel.summary },
  })
  .put('/:id', async ({ body, params }) => await getCustomMcpServerService().update(params.id, body), {
    detail: {
      summary: 'Update a custom MCP server',
      description: 'Omit secretValues to retain the existing encrypted values; pass an empty object to remove them.',
    },
    params: McpServersModel.idParams,
    body: McpServersModel.saveBody,
    response: { 200: McpServersModel.summary },
  })
  .patch('/:id/enabled', async ({ body, params }) =>
    await getCustomMcpServerService().setEnabled(params.id, body.enabled), {
    detail: {
      'summary': 'Enable or disable a custom MCP server',
      'x-cradle-cli': { command: ['mcp-server', 'set-enabled'] },
    },
    params: McpServersModel.idParams,
    body: McpServersModel.enabledBody,
    response: { 200: McpServersModel.summary },
  })
  .delete('/:id', async ({ params }) => {
    await getCustomMcpServerService().remove(params.id)
    return { ok: true as const }
  }, {
    detail: {
      'summary': 'Delete a custom MCP server',
      'x-cradle-cli': { command: ['mcp-server', 'delete'] },
    },
    params: McpServersModel.idParams,
    response: { 200: t.Object({ ok: t.Literal(true) }) },
  })
