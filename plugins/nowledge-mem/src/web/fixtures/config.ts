import type { NowledgePluginConfig } from '../types'

export const localNowledgeConfigFixture: NowledgePluginConfig = {
  mcpUrl: 'http://127.0.0.1:14242/mcp/',
  enabled: true,
  hasApiKey: false,
  apiKeySource: 'none',
}

export const remoteNowledgeConfigFixture: NowledgePluginConfig = {
  mcpUrl: 'https://mem.example.com/mcp/',
  enabled: true,
  hasApiKey: true,
  apiKeySource: 'plugin',
}
