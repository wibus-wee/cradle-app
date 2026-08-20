import { afterEach, describe, expect, it } from 'vitest'

import { addHostMcpServer, removeHostMcpServer } from '../../../../plugins/mcp-registry'
import { AGENT_TOOLS_MCP_SERVER_NAME } from '../../../agent-tools/server'
import type { CodexConfig } from '../../../provider-contracts/provider-base'
import { readTrustedCodexConfig } from '../../../provider-contracts/provider-base'
import {
  bindCodexCradleMcpInvocation,
  buildCodexConfig,
  buildCodexMcpServersEnvironment,
  readCodexReasoningEffort,
} from './runtime-config'

function createCodexConfig(config: Partial<CodexConfig> = {}): CodexConfig {
  return readTrustedCodexConfig(JSON.stringify(config))
}

describe('buildCodexConfig MCP projection', () => {
  afterEach(() => {
    removeHostMcpServer('browser-use')
    removeHostMcpServer('nowledge-mem')
    removeHostMcpServer(AGENT_TOOLS_MCP_SERVER_NAME)
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

  it('binds the active invocation to session-scoped MCP servers', () => {
    addHostMcpServer({
      transport: 'stdio',
      name: AGENT_TOOLS_MCP_SERVER_NAME,
      command: 'node',
      args: ['/agent-tools/mcp-entry.mjs'],
      env: { CRADLE_SERVER_URL: 'http://127.0.0.1:21423' },
    })
    addHostMcpServer({
      transport: 'stdio',
      name: 'browser-use',
      command: 'node',
      args: ['/plugins/browser-use/dist/mcp-server.mjs'],
      env: { BROWSER_BACKEND_SOCKET: '/tmp/cradle-browser.sock' },
      scope: 'chat-session',
    })

    const config = bindCodexCradleMcpInvocation(
      buildCodexConfig(
        createCodexConfig(),
        '/tmp/cradle-workspace',
        () => [],
        'gpt-5-codex',
        { kind: 'none' },
      ),
      {
        CRADLE_CHAT_SESSION_ID: 'session-1',
        CRADLE_WORKSPACE_ID: 'workspace-1',
        CRADLE_WORKSPACE_PATH: '/tmp/cradle-workspace',
        CRADLE_AGENT_ID: 'agent-1',
        OPENAI_API_KEY: 'must-not-reach-mcp',
      },
    )

    expect(config.mcp_servers).toEqual({
      [AGENT_TOOLS_MCP_SERVER_NAME]: {
        command: 'node',
        args: ['/agent-tools/mcp-entry.mjs'],
        env: {
          CRADLE_SERVER_URL: 'http://127.0.0.1:21423',
          CRADLE_CHAT_SESSION_ID: 'session-1',
          CRADLE_WORKSPACE_ID: 'workspace-1',
          CRADLE_WORKSPACE_PATH: '/tmp/cradle-workspace',
          CRADLE_AGENT_ID: 'agent-1',
        },
      },
      'browser-use': {
        command: 'node',
        args: ['/plugins/browser-use/dist/mcp-server.mjs'],
        env: {
          BROWSER_BACKEND_SOCKET: '/tmp/cradle-browser.sock',
          CRADLE_CHAT_SESSION_ID: 'session-1',
        },
      },
    })
  })
})

describe('codex reasoning effort projection', () => {
  it('forwards ultra to the app-server boundary', () => {
    expect(readCodexReasoningEffort('ultra', 'high')).toBe('ultra')
  })
})
