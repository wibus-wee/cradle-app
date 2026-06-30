import { describe, expect, it } from 'vitest'

import { AnthropicConfigSchema, ClaudeAgentConfigSchema, CodexConfigSchema, readTrustedClaudeAgentConfig, readTrustedCodexConfig } from '../src/modules/provider-contracts/provider-base'

describe('provider config defaults', () => {
  it('uses full-access Codex app-server permissions when no profile override is stored', () => {
    expect(CodexConfigSchema.parse({})).toEqual(expect.objectContaining({
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
    }))

    expect(readTrustedCodexConfig('{}')).toEqual(expect.objectContaining({
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
    }))
  })

  it('does not enable Claude Agent global skill discovery by default', () => {
    expect(readTrustedClaudeAgentConfig('{}')).toEqual(expect.objectContaining({
      authMode: 'apiKey',
      skills: [],
    }))

    expect(readTrustedClaudeAgentConfig('{"skills":"all"}')).toEqual(expect.objectContaining({
      skills: 'all',
    }))
  })

  it('parses Claude Agent owned auth modes separately from Codex auth modes', () => {
    expect(ClaudeAgentConfigSchema.parse({ authMode: 'claudeAi' })).toEqual(expect.objectContaining({
      authMode: 'claudeAi',
    }))
    expect(AnthropicConfigSchema.parse({ authMode: 'claudeAi' })).toEqual(expect.objectContaining({
      authMode: 'claudeAi',
    }))
    expect(readTrustedClaudeAgentConfig('{"authMode":"claudeAi"}')).toEqual(expect.objectContaining({
      authMode: 'claudeAi',
    }))
    expect(() => AnthropicConfigSchema.parse({ authMode: 'authToken' })).toThrow()
    expect(() => ClaudeAgentConfigSchema.parse({ authMode: 'authToken' })).toThrow()
    expect(() => ClaudeAgentConfigSchema.parse({ authMode: 'chatgptAuthTokens' })).toThrow()
  })
})
