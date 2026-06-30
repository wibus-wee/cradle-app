// Verifies local agent onboarding config mapping without reading real user config.

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createLocalAgentConfigExternalProviderSource,
  readLocalAgentConfigExternalProviderSnapshot,
  resolveLocalAgentConfigSourceConfig,
} from '../src/modules/external-provider-sources/local-agent-config-source'

const tempDirs: string[] = []
let previousPath: string | undefined

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cradle-local-agent-config-'))
  tempDirs.push(dir)
  return dir
}

function createFixtureConfig(root: string) {
  const claudeDir = join(root, 'claude')
  const codexDir = join(root, 'codex')
  mkdirSync(claudeDir, { recursive: true })
  mkdirSync(codexDir, { recursive: true })
  return {
    claudeDir,
    claudeSettingsPath: join(claudeDir, 'settings.json'),
    claudeLocalSettingsPath: join(claudeDir, 'settings.local.json'),
    codexDir,
    codexConfigPath: join(codexDir, 'config.toml'),
    codexAuthPath: join(codexDir, 'auth.json'),
    includeProcessEnv: false,
  }
}

function setPath(value: string): void {
  previousPath ??= process.env.PATH
  process.env.PATH = value
}

function createExecutable(dir: string, name: string): string {
  const path = join(dir, name)
  writeFileSync(path, '#!/bin/sh\nexit 0\n')
  chmodSync(path, 0o755)
  return path
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  if (previousPath === undefined) {
    delete process.env.PATH
  }
  else {
    process.env.PATH = previousPath
    previousPath = undefined
  }
})

describe('local agent config external provider source', () => {
  it('maps local Claude and Codex fixture config into external provider records', () => {
    const root = createTempDir()
    const config = createFixtureConfig(root)
    writeFileSync(config.claudeSettingsPath, JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: 'https://anthropic.example.test',
        ANTHROPIC_MODEL: 'claude-sonnet-test',
        ANTHROPIC_AUTH_TOKEN: 'test-anthropic-secret',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-test',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-test',
      },
    }))
    writeFileSync(config.codexConfigPath, [
      'model_provider = "fixture"',
      'model = "gpt-test"',
      'model_reasoning_effort = "high"',
      'approval_policy = "on-request"',
      'sandbox_mode = "workspace-write"',
      '',
      '[model_providers.fixture]',
      'base_url = "https://openai.example.test/v1"',
      'wire_api = "responses"',
    ].join('\n'))
    writeFileSync(config.codexAuthPath, JSON.stringify({
      OPENAI_API_KEY: 'test-openai-secret',
    }))
    setPath('')

    const snapshot = readLocalAgentConfigExternalProviderSnapshot(config)

    expect(snapshot.source.status).toBe('ok')
    expect(snapshot.providers).toEqual([
      expect.objectContaining({
        externalId: 'claude:local-current',
        app: 'claude',
        name: 'Local Claude',
        providerKind: 'anthropic',
        config: {
          baseUrl: 'https://anthropic.example.test',
          model: 'claude-sonnet-test',
          claudeAgent: {
            modelAliases: {
              haiku: 'claude-haiku-test',
              sonnet: 'claude-sonnet-test',
            },
          },
        },
        credential: { kind: 'api-key', value: 'test-anthropic-secret', label: 'Local Claude' },
        current: true,
      }),
      expect.objectContaining({
        externalId: 'codex:local-current',
        app: 'codex',
        name: 'Local Codex',
        providerKind: 'openai-compatible',
        config: {
          baseUrl: 'https://openai.example.test/v1',
          model: 'gpt-test',
          apiMode: 'responses',
          reasoningEffort: 'high',
          approvalPolicy: 'on-request',
          sandboxMode: 'workspace-write',
        },
        credential: { kind: 'api-key', value: 'test-openai-secret', label: 'Local Codex' },
        current: true,
      }),
    ])
    expect(JSON.stringify(snapshot.providers.map(provider => provider.metadata))).not.toContain('test-anthropic-secret')
    expect(JSON.stringify(snapshot.providers.map(provider => provider.metadata))).not.toContain('test-openai-secret')
  })

  it('keeps CLI import records alongside Claude and Codex provider config', () => {
    const root = createTempDir()
    const binDir = join(root, 'bin')
    mkdirSync(binDir, { recursive: true })
    const config = createFixtureConfig(root)
    const claudePath = createExecutable(binDir, 'claude')
    const codexPath = createExecutable(binDir, 'codex')
    setPath(binDir)
    writeFileSync(config.claudeSettingsPath, JSON.stringify({
      env: {
        ANTHROPIC_MODEL: 'claude-overlap-test',
      },
    }))
    writeFileSync(config.codexConfigPath, [
      'model = "gpt-overlap-test"',
      '',
    ].join('\n'))

    const snapshot = readLocalAgentConfigExternalProviderSnapshot(config)

    expect(snapshot.providers).toEqual([
      expect.objectContaining({
        externalId: 'claude:local-current',
        app: 'claude',
        providerKind: 'anthropic',
        config: expect.objectContaining({
          authMode: 'claudeAi',
          model: 'claude-overlap-test',
        }),
      }),
      expect.objectContaining({
        externalId: 'codex:local-current',
        app: 'codex',
        providerKind: 'openai-compatible',
      }),
      expect.objectContaining({
        externalId: 'claude:local-command',
        app: 'claude',
        name: 'Local Claude CLI',
        providerKind: 'cli-tool',
        config: { executable: claudePath },
        metadata: expect.objectContaining({ runtimeKind: 'cli-tui', iconSlug: 'claudecode' }),
      }),
      expect.objectContaining({
        externalId: 'codex:local-command',
        app: 'codex',
        name: 'Local Codex CLI',
        providerKind: 'cli-tool',
        config: { executable: codexPath },
        metadata: expect.objectContaining({ runtimeKind: 'cli-tui', iconSlug: 'codex' }),
      }),
    ])
  })

  it('returns an empty snapshot when allowlisted local config files do not exist', () => {
    const root = createTempDir()
    const config = createFixtureConfig(root)
    setPath('')

    const snapshot = readLocalAgentConfigExternalProviderSnapshot(config)

    expect(snapshot.source.status).toBe('ok')
    expect(snapshot.providers).toEqual([])
    expect(snapshot.source.message).toBe('No local agent config records were detected.')
  })

  it('detects installed local agent commands as CLI import records', () => {
    const root = createTempDir()
    const binDir = join(root, 'bin')
    mkdirSync(binDir, { recursive: true })
    const config = createFixtureConfig(root)
    const claudePath = createExecutable(binDir, 'claude')
    const codexPath = createExecutable(binDir, 'codex')
    const geminiPath = createExecutable(binDir, 'gemini')
    const piPath = createExecutable(binDir, 'pi')
    const kimiPath = createExecutable(binDir, 'kimi')
    setPath(binDir)

    const snapshot = readLocalAgentConfigExternalProviderSnapshot(config)

    expect(snapshot.providers).toEqual([
      expect.objectContaining({
        externalId: 'claude:local-command',
        app: 'claude',
        providerKind: 'cli-tool',
        config: { executable: claudePath },
        metadata: expect.objectContaining({ runtimeKind: 'cli-tui', iconSlug: 'claudecode' }),
      }),
      expect.objectContaining({
        externalId: 'codex:local-command',
        app: 'codex',
        providerKind: 'cli-tool',
        config: { executable: codexPath },
        metadata: expect.objectContaining({ runtimeKind: 'cli-tui', iconSlug: 'codex' }),
      }),
      expect.objectContaining({
        externalId: 'gemini:local-command',
        app: 'gemini',
        providerKind: 'cli-tool',
        config: { executable: geminiPath },
        metadata: expect.objectContaining({ runtimeKind: 'cli-tui', iconSlug: 'geminicli' }),
      }),
      expect.objectContaining({
        externalId: 'pi:local-command',
        app: 'pi',
        providerKind: 'cli-tool',
        config: { executable: piPath },
        metadata: expect.objectContaining({ runtimeKind: 'cli-tui' }),
      }),
      expect.objectContaining({
        externalId: 'kimi:local-command',
        app: 'kimi',
        providerKind: 'cli-tool',
        config: { executable: kimiPath },
        metadata: expect.objectContaining({ runtimeKind: 'cli-tui', iconSlug: 'kimi' }),
      }),
    ])
  })

  it('detects the Kimi CI command alias as a Kimi CLI import record', () => {
    const root = createTempDir()
    const binDir = join(root, 'bin')
    mkdirSync(binDir, { recursive: true })
    const config = createFixtureConfig(root)
    const kimiCiPath = createExecutable(binDir, 'kimi-ci')
    setPath(binDir)

    const snapshot = readLocalAgentConfigExternalProviderSnapshot(config)

    expect(snapshot.providers).toEqual([
      expect.objectContaining({
        externalId: 'kimi:local-command',
        app: 'kimi',
        providerKind: 'cli-tool',
        config: { executable: kimiCiPath },
        metadata: expect.objectContaining({
          executable: kimiCiPath,
          runtimeKind: 'cli-tui',
          iconSlug: 'kimi',
        }),
      }),
    ])
  })

  it('emits warnings for partial config without credentials', () => {
    const root = createTempDir()
    const config = createFixtureConfig(root)
    writeFileSync(config.claudeSettingsPath, JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: 'https://anthropic.example.test',
        ANTHROPIC_MODEL: 'claude-sonnet-test',
      },
    }))
    writeFileSync(config.codexConfigPath, [
      'model_provider = "fixture"',
      'model = "gpt-test"',
      '',
      '[model_providers.fixture]',
      'base_url = "https://openai.example.test/v1"',
      'wire_api = "responses"',
    ].join('\n'))
    setPath('')

    const snapshot = readLocalAgentConfigExternalProviderSnapshot(config)

    expect(snapshot.source.status).toBe('ok')
    expect(snapshot.providers).toHaveLength(2)
    expect(snapshot.providers).toEqual([
      expect.objectContaining({
        credential: undefined,
        warnings: [expect.objectContaining({ code: 'local-claude-credential-missing', severity: 'info' })],
      }),
      expect.objectContaining({
        credential: undefined,
        warnings: [expect.objectContaining({ code: 'local-codex-credential-missing', severity: 'info' })],
      }),
    ])
  })

  it('resolves context overrides without registering the source on startup', async () => {
    const root = createTempDir()
    const config = createFixtureConfig(root)
    const source = createLocalAgentConfigExternalProviderSource()
    setPath('')
    writeFileSync(config.codexConfigPath, 'model = "gpt-test"\nopenai_base_url = "https://openai.example.test/v1"\n')
    writeFileSync(config.codexAuthPath, JSON.stringify({ OPENAI_API_KEY: 'test-openai-secret' }))

    const resolved = resolveLocalAgentConfigSourceConfig({
      signal: new AbortController().signal,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sharedConfig: new Map([
        ['LOCAL_AGENT_CONFIG_CLAUDE_DIR', config.claudeDir],
        ['LOCAL_AGENT_CONFIG_CLAUDE_SETTINGS_PATH', config.claudeSettingsPath],
        ['LOCAL_AGENT_CONFIG_CLAUDE_LOCAL_SETTINGS_PATH', config.claudeLocalSettingsPath],
        ['LOCAL_AGENT_CONFIG_CODEX_DIR', config.codexDir],
        ['LOCAL_AGENT_CONFIG_CODEX_CONFIG_PATH', config.codexConfigPath],
        ['LOCAL_AGENT_CONFIG_CODEX_AUTH_PATH', config.codexAuthPath],
        ['LOCAL_AGENT_CONFIG_INCLUDE_PROCESS_ENV', 'false'],
      ]),
    })

    const snapshot = await source.readSnapshot({
      signal: new AbortController().signal,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sharedConfig: new Map([
        ['LOCAL_AGENT_CONFIG_CLAUDE_DIR', config.claudeDir],
        ['LOCAL_AGENT_CONFIG_CLAUDE_SETTINGS_PATH', config.claudeSettingsPath],
        ['LOCAL_AGENT_CONFIG_CLAUDE_LOCAL_SETTINGS_PATH', config.claudeLocalSettingsPath],
        ['LOCAL_AGENT_CONFIG_CODEX_DIR', config.codexDir],
        ['LOCAL_AGENT_CONFIG_CODEX_CONFIG_PATH', config.codexConfigPath],
        ['LOCAL_AGENT_CONFIG_CODEX_AUTH_PATH', config.codexAuthPath],
        ['LOCAL_AGENT_CONFIG_INCLUDE_PROCESS_ENV', 'false'],
      ]),
    })

    expect(source.id).toBe('local-agent-config')
    expect(resolved.codexConfigPath).toBe(config.codexConfigPath)
    expect(snapshot.providers).toEqual([
      expect.objectContaining({
        externalId: 'codex:local-current',
        config: {
          baseUrl: 'https://openai.example.test/v1',
          model: 'gpt-test',
        },
      }),
    ])
  })
})
