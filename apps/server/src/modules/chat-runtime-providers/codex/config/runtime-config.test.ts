import { afterEach, describe, expect, it } from 'vitest'

import { addHostMcpServer, removeHostMcpServer } from '../../../../plugins/mcp-registry'
import type { CodexConfig } from '../../../provider-contracts/provider-base'
import { readTrustedCodexConfig } from '../../../provider-contracts/provider-base'
import { buildCodexConfig, buildCodexMcpServersEnvironment } from './runtime-config'

function createCodexConfig(config: Partial<CodexConfig> = {}): CodexConfig {
  return readTrustedCodexConfig(JSON.stringify(config))
}

describe('buildCodexConfig MCP projection', () => {
  afterEach(() => {
    removeHostMcpServer('browser-use')
    removeHostMcpServer('nowledge-mem')
  })

  it('includes stdio and streamable HTTP MCP servers without writing HTTP header values into config', () => {
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

    const config = buildCodexConfig(
      createCodexConfig(),
      '/tmp/cradle-workspace',
      () => [],
      null,
      'gpt-5-codex',
      { kind: 'none' },
    )

    expect(config.mcp_servers).toEqual({
      'browser-use': {
        command: 'node',
        args: ['/plugins/browser-use/dist/mcp-server.mjs'],
        env: { BROWSER_BACKEND_SOCKET: '/tmp/cradle-browser.sock' },
      },
      'nowledge-mem': {
        url: 'https://nowledge.example.test/mcp',
        env_http_headers: {
          Authorization: 'CRADLE_CODEX_MCP_HEADER_NOWLEDGE_MEM_AUTHORIZATION',
        },
      },
    })
    expect(JSON.stringify(config)).not.toContain('secret-token')
    expect(buildCodexMcpServersEnvironment()).toEqual({
      CRADLE_CODEX_MCP_HEADER_NOWLEDGE_MEM_AUTHORIZATION: 'Bearer secret-token',
    })
  })
})
