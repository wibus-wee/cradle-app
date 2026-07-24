import { describe, expect, it } from 'vitest'

import type { RuntimeProviderTargetProfile } from '../../chat-runtime/runtime-provider-types'
import { projectKimiProviderConfig, renderKimiConfigToml, renderKimiMcpConfig, resolveKimiModelReference } from './config'

function createProfile(configJson: string): RuntimeProviderTargetProfile {
  return {
    id: 'target-a',
    name: 'Target A',
    providerTargetId: 'target-a',
    providerKind: 'openai-compatible',
    providerTargetKind: 'manual',
    credentialRef: null,
    enabled: true,
    customModels: '[]',
    iconSlug: null,
    configJson,
  }
}

describe('kimi provider config', () => {
  it('uses the canonical defaultModel target setting as Kimi global default_model', () => {
    const provider = projectKimiProviderConfig(createProfile(JSON.stringify({
      baseUrl: 'https://example.test/v1',
defaultModel: 'gpt-4.1',
    })))

    expect(provider.defaultModel).toBe('gpt-4.1')
    expect(renderKimiConfigToml({ provider, credential: 'test-key' })).toContain('default_model = "cradle-target-a/gpt-4.1"')
    expect(resolveKimiModelReference(provider, 'gpt-4.1')).toBe('cradle-target-a/gpt-4.1')
  })

  it('renders stdio and HTTP MCP servers in Kimi native mcp.json shape', () => {
    expect(JSON.parse(renderKimiMcpConfig({
      browser: {
        transport: 'stdio',
        name: 'browser',
        command: 'node',
        args: ['server.js'],
        env: { TOKEN: 'secret' },
      },
      remote: {
        transport: 'streamable-http',
        name: 'remote',
        url: 'https://mcp.example.test/mcp',
        headers: { Authorization: 'Bearer secret' },
      },
    }))).toEqual({
      mcpServers: {
        browser: {
          transport: 'stdio',
          command: 'node',
          args: ['server.js'],
          env: { TOKEN: 'secret' },
        },
        remote: {
          transport: 'http',
          url: 'https://mcp.example.test/mcp',
          headers: { Authorization: 'Bearer secret' },
        },
      },
    })
  })
})
