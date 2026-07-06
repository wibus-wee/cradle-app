import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { AccountInfo } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it, vi } from 'vitest'

import type { ResolvedProviderTarget } from '../../provider-targets/service'
import type { ClaudeAgentAccountProbeQuery, ClaudeAgentAccountProbeQueryFactory, ClaudeAgentAuthDiagnostics } from './account-diagnostics'
import {
  readClaudeAgentAuthDiagnostics,
} from './account-diagnostics'

describe('claude agent auth diagnostics', () => {
  it('returns unsupported for non-Anthropic provider targets without running Claude', async () => {
    await withTempCradleDataDir(async () => {
      const runCommand = vi.fn()
      const diagnostics = await readClaudeAgentAuthDiagnostics({
        providerTargetId: 'openai-target',
      }, createDiagnosticsDeps({
        providerTargetId: 'openai-target',
        providerKind: 'openai-compatible',
        config: {},
        credentialRef: null,
        runCommand,
      }))

      expect(diagnostics.supported).toBe(false)
      expect(diagnostics.unavailableReason).toBe('Claude Agent auth diagnostics are only available for Anthropic provider targets.')
      expect(runCommand).not.toHaveBeenCalled()
    })
  })

  it('reports API key auth as ready when a credential is available', async () => {
    await withTempCradleDataDir(async () => {
      const runCommand = vi.fn()
      const diagnostics = await readClaudeAgentAuthDiagnostics({
        providerTargetId: 'claude-api-key-target',
      }, createDiagnosticsDeps({
        providerTargetId: 'claude-api-key-target',
        providerKind: 'anthropic',
        config: { authMode: 'apiKey' },
        credentialRef: 'credential-claude',
        readSecret: () => 'sk-ant-test',
        runCommand,
      }))

      expect(diagnostics).toMatchObject({
        supported: true,
        status: 'ready',
        available: true,
        authStatus: 'authenticated',
        authMode: 'apiKey',
        authType: 'apiKey',
        authLabel: 'Claude API Key',
      } satisfies Partial<ClaudeAgentAuthDiagnostics>)
      expect(runCommand).not.toHaveBeenCalled()
    })
  })

  it('reports API key auth as unauthenticated when no credential is available', async () => {
    await withTempCradleDataDir(async () => {
      const diagnostics = await readClaudeAgentAuthDiagnostics({
        providerTargetId: 'claude-missing-key-target',
      }, createDiagnosticsDeps({
        providerTargetId: 'claude-missing-key-target',
        providerKind: 'anthropic',
        config: { authMode: 'apiKey' },
        credentialRef: null,
        readSecret: () => '',
      }))

      expect(diagnostics).toMatchObject({
        status: 'error',
        available: false,
        authStatus: 'unauthenticated',
        message: 'Claude API key authentication is selected, but no API key is configured.',
      } satisfies Partial<ClaudeAgentAuthDiagnostics>)
    })
  })

  it('projects API key credential read failures as diagnostics errors', async () => {
    await withTempCradleDataDir(async () => {
      const diagnostics = await readClaudeAgentAuthDiagnostics({
        providerTargetId: 'claude-unreadable-key-target',
      }, createDiagnosticsDeps({
        providerTargetId: 'claude-unreadable-key-target',
        providerKind: 'anthropic',
        config: { authMode: 'apiKey' },
        credentialRef: 'credential-claude',
        readSecret: () => {
          throw new Error('secret store unavailable')
        },
      }))

      expect(diagnostics).toMatchObject({
        status: 'error',
        available: false,
        authStatus: 'unknown',
        authMode: 'apiKey',
        message: 'Claude API key credential could not be read: secret store unavailable.',
      } satisfies Partial<ClaudeAgentAuthDiagnostics>)
    })
  })

  it('reads Claude.ai auth status and subscription from Claude CLI JSON', async () => {
    await withTempCradleDataDir(async () => {
      const previousAnthropicApiKey = process.env.ANTHROPIC_API_KEY
      const previousAnthropicAuthToken = process.env.ANTHROPIC_AUTH_TOKEN
      const previousAnthropicBaseUrl = process.env.ANTHROPIC_BASE_URL
      const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
      process.env.ANTHROPIC_API_KEY = 'inherited-api-key'
      process.env.ANTHROPIC_AUTH_TOKEN = 'inherited-auth-token'
      process.env.ANTHROPIC_BASE_URL = 'https://example.invalid'
      process.env.CLAUDE_CONFIG_DIR = join(process.env.CRADLE_DATA_DIR!, 'runtimes', 'claude-agent')

      try {
        const runCommand = vi.fn(async (_command: string, args: string[], env: NodeJS.ProcessEnv) => {
          expect(env.ANTHROPIC_API_KEY).toBeUndefined()
          expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
          expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
          expect(env.CLAUDE_CONFIG_DIR).toBeUndefined()
          if (args[0] === '--version') {
            return { code: 0, stdout: 'Claude Code 1.2.3\n', stderr: '' }
          }
          return {
            code: 0,
            stdout: JSON.stringify({
              loggedIn: true,
              authMethod: 'claudeai',
              account: { subscriptionType: 'max' },
            }),
            stderr: '',
          }
        })

        const diagnostics = await readClaudeAgentAuthDiagnostics({
          providerTargetId: 'claude-official-target',
        }, createDiagnosticsDeps({
          providerTargetId: 'claude-official-target',
          providerKind: 'anthropic',
          config: { authMode: 'claudeAi' },
          credentialRef: null,
          runCommand,
        }))

        expect(diagnostics).toMatchObject({
          supported: true,
          status: 'ready',
          available: true,
          authStatus: 'authenticated',
          authMode: 'claudeAi',
          authType: 'max',
          authLabel: 'Claude Max Subscription',
          version: '1.2.3',
        } satisfies Partial<ClaudeAgentAuthDiagnostics>)
        expect(runCommand.mock.calls.map(call => call[1])).toEqual([
          ['--version'],
          ['auth', 'status'],
        ])
      }
      finally {
        restoreEnv('ANTHROPIC_API_KEY', previousAnthropicApiKey)
        restoreEnv('ANTHROPIC_AUTH_TOKEN', previousAnthropicAuthToken)
        restoreEnv('ANTHROPIC_BASE_URL', previousAnthropicBaseUrl)
        restoreEnv('CLAUDE_CONFIG_DIR', previousClaudeConfigDir)
      }
    })
  })

  it('preserves user-provided Claude config directory for Claude.ai auth diagnostics', async () => {
    await withTempCradleDataDir(async () => {
      const userClaudeConfigDir = join(process.env.CRADLE_DATA_DIR!, 'user-shell-claude-config')
      const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
      process.env.CLAUDE_CONFIG_DIR = userClaudeConfigDir

      try {
        const runCommand = vi.fn(async (_command: string, args: string[], env: NodeJS.ProcessEnv) => {
          expect(env.CLAUDE_CONFIG_DIR).toBe(userClaudeConfigDir)
          if (args[0] === '--version') {
            return { code: 0, stdout: 'Claude Code 1.2.3\n', stderr: '' }
          }
          return { code: 0, stdout: JSON.stringify({ loggedIn: true }), stderr: '' }
        })

        const diagnostics = await readClaudeAgentAuthDiagnostics({
          providerTargetId: 'claude-custom-config-target',
        }, createDiagnosticsDeps({
          providerTargetId: 'claude-custom-config-target',
          providerKind: 'anthropic',
          config: { authMode: 'claudeAi' },
          credentialRef: null,
          runCommand,
        }))

        expect(diagnostics.authStatus).toBe('authenticated')
      }
      finally {
        restoreEnv('CLAUDE_CONFIG_DIR', previousClaudeConfigDir)
      }
    })
  })

  it('reports Claude.ai auth as unauthenticated when auth status says logged out', async () => {
    await withTempCradleDataDir(async () => {
      const diagnostics = await readClaudeAgentAuthDiagnostics({
        providerTargetId: 'claude-logged-out-target',
      }, createDiagnosticsDeps({
        providerTargetId: 'claude-logged-out-target',
        providerKind: 'anthropic',
        config: { authMode: 'claudeAi' },
        credentialRef: null,
        runCommand: async (_command, args) => args[0] === '--version'
          ? { code: 0, stdout: 'Claude Code 1.2.3\n', stderr: '' }
          : { code: 0, stdout: JSON.stringify({ loggedIn: false }), stderr: '' },
      }))

      expect(diagnostics).toMatchObject({
        status: 'error',
        available: true,
        authStatus: 'unauthenticated',
        message: 'Claude is not authenticated. Run `claude auth login` and try again.',
      } satisfies Partial<ClaudeAgentAuthDiagnostics>)
    })
  })

  it('falls back to SDK account metadata when auth status omits subscription type', async () => {
    await withTempCradleDataDir(async () => {
      const query = vi.fn(() => createAccountQuery({
        email: 'user@example.com',
        organization: 'Cradle',
        subscriptionType: 'pro',
        tokenSource: 'claudeAi',
        apiProvider: 'firstParty',
      }))
      const diagnostics = await readClaudeAgentAuthDiagnostics({
        providerTargetId: 'claude-sdk-probe-target',
      }, createDiagnosticsDeps({
        providerTargetId: 'claude-sdk-probe-target',
        providerKind: 'anthropic',
        config: { authMode: 'claudeAi' },
        credentialRef: null,
        query,
        runCommand: async (_command, args) => args[0] === '--version'
          ? { code: 0, stdout: 'Claude Code 1.2.3\n', stderr: '' }
          : { code: 0, stdout: JSON.stringify({ loggedIn: true }), stderr: '' },
      }))

      expect(diagnostics).toMatchObject({
        status: 'ready',
        authStatus: 'authenticated',
        authType: 'pro',
        authLabel: 'Claude Pro Subscription',
        account: {
          email: 'user@example.com',
          organization: 'Cradle',
          subscriptionType: 'pro',
          tokenSource: 'claudeAi',
          apiKeySource: null,
          apiProvider: 'firstParty',
        },
      } satisfies Partial<ClaudeAgentAuthDiagnostics>)
      expect(query).toHaveBeenCalled()
    })
  })
})

function createDiagnosticsDeps(input: {
  providerTargetId: string
  providerKind: ResolvedProviderTarget['providerKind']
  config: Record<string, unknown>
  credentialRef: string | null
  readSecret?: (secretRef: string) => string
  runCommand?: (command: string, args: string[], env: NodeJS.ProcessEnv) => Promise<{
    code: number
    stdout: string
    stderr: string
  }>
  query?: ClaudeAgentAccountProbeQueryFactory
}) {
  return {
    resolveProviderTarget: () => createResolvedProviderTarget(input),
    readSecret: input.readSecret ?? (() => ''),
    runCommand: input.runCommand ?? vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
    query: input.query ?? vi.fn(() => createAccountQuery(null)),
  }
}

function createResolvedProviderTarget(input: {
  providerTargetId: string
  providerKind: ResolvedProviderTarget['providerKind']
  config: Record<string, unknown>
  credentialRef: string | null
}): ResolvedProviderTarget {
  return {
    target: {
      id: input.providerTargetId,
      kind: 'manual',
    },
    id: input.providerTargetId,
    kind: 'manual',
    label: 'Provider',
    providerKind: input.providerKind,
    enabled: true,
    connectionConfigJson: JSON.stringify(input.config),
    configJson: JSON.stringify(input.config),
    credentialRef: input.credentialRef,
    enabledModelsJson: '[]',
    customModelsJson: '[]',
    iconSlug: null,
    sourceMetadata: null,
  }
}

function createAccountQuery(account: AccountInfo | null): ClaudeAgentAccountProbeQuery {
  return {
    initializationResult: vi.fn(async () => ({ account: account ?? undefined })),
    close: vi.fn(),
  }
}

async function withTempCradleDataDir(run: () => Promise<void>): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), 'cradle-claude-diagnostics-'))
  const previousDataDir = process.env.CRADLE_DATA_DIR
  const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CRADLE_DATA_DIR = dataDir
  try {
    await run()
  }
  finally {
    restoreEnv('CRADLE_DATA_DIR', previousDataDir)
    restoreEnv('CLAUDE_CONFIG_DIR', previousClaudeConfigDir)
    rmSync(dataDir, { recursive: true, force: true })
  }
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  }
  else {
    process.env[key] = value
  }
}
