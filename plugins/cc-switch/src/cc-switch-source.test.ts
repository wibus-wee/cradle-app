/* Verifies CC Switch snapshot reading with fake local provider data. */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import { readCcSwitchExternalProviderSnapshot, readCcSwitchSnapshot } from './cc-switch-source'

const tempDirs: string[] = []

function createTempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cradle-cc-switch-plugin-'))
  tempDirs.push(dir)
  return dir
}

function writeFixtureDatabase(path: string): void {
  const db = new Database(path)
  try {
    db.exec(`
      CREATE TABLE providers (
        id TEXT NOT NULL,
        app_type TEXT NOT NULL,
        name TEXT NOT NULL,
        settings_config TEXT NOT NULL,
        website_url TEXT,
        category TEXT,
        created_at INTEGER,
        sort_index INTEGER,
        notes TEXT,
        icon TEXT,
        icon_color TEXT,
        meta TEXT NOT NULL DEFAULT '{}',
        is_current BOOLEAN NOT NULL DEFAULT 0,
        in_failover_queue BOOLEAN NOT NULL DEFAULT 0,
        PRIMARY KEY (id, app_type)
      );

      CREATE TABLE provider_endpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_id TEXT NOT NULL,
        app_type TEXT NOT NULL,
        url TEXT NOT NULL,
        added_at INTEGER
      );

      CREATE TABLE mcp_servers (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE prompts (id TEXT NOT NULL, app_type TEXT NOT NULL, name TEXT NOT NULL, content TEXT NOT NULL, PRIMARY KEY (id, app_type));
      CREATE TABLE skills (id TEXT PRIMARY KEY, name TEXT NOT NULL, directory TEXT NOT NULL);
      CREATE TABLE usage_daily_rollups (date TEXT NOT NULL, app_type TEXT NOT NULL, provider_id TEXT NOT NULL, model TEXT NOT NULL, PRIMARY KEY (date, app_type, provider_id, model));
      CREATE TABLE model_pricing (model_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, input_cost_per_million TEXT NOT NULL, output_cost_per_million TEXT NOT NULL);
      CREATE TABLE provider_health (provider_id TEXT NOT NULL, app_type TEXT NOT NULL, is_healthy INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (provider_id, app_type));

      INSERT INTO mcp_servers (id, name) VALUES ('mcp-a', 'Fixture MCP');
      INSERT INTO prompts (id, app_type, name, content) VALUES ('prompt-a', 'claude', 'Prompt A', 'hello');
      INSERT INTO skills (id, name, directory) VALUES ('skill-a', 'Skill A', '/tmp/skill-a');
      INSERT INTO usage_daily_rollups (date, app_type, provider_id, model) VALUES ('2026-05-21', 'claude', 'anthropic-a', 'claude-test');
      INSERT INTO model_pricing (model_id, display_name, input_cost_per_million, output_cost_per_million) VALUES ('claude-test', 'Claude Test', '1', '2');
    `)

    const insertProvider = db.prepare(`
      INSERT INTO providers (
        id, app_type, name, settings_config, website_url, category, created_at, sort_index,
        notes, icon, icon_color, meta, is_current, in_failover_queue
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    insertProvider.run(
      'anthropic-a',
      'claude',
      'Anthropic A',
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: 'https://anthropic-a.example.test',
          ANTHROPIC_AUTH_TOKEN: 'test-anthropic-key',
          ANTHROPIC_MODEL: 'claude-test',
          ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-test',
        },
      }),
      null,
      'custom',
      1_779_321_600,
      1,
      null,
      null,
      null,
      JSON.stringify({ apiFormat: 'anthropic' }),
      0,
      0,
    )

    insertProvider.run(
      'anthropic-b',
      'claude',
      'Anthropic B',
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: 'https://anthropic-b.example.test',
          ANTHROPIC_AUTH_TOKEN: 'test-anthropic-key-b',
          ANTHROPIC_MODEL: 'claude-test-b',
        },
      }),
      null,
      'custom',
      1_779_321_601,
      2,
      null,
      null,
      null,
      JSON.stringify({ apiFormat: 'anthropic' }),
      1,
      0,
    )

    insertProvider.run(
      'codex-a',
      'codex',
      'Codex A',
      JSON.stringify({
        auth: { OPENAI_API_KEY: 'test-openai-key' },
        config: [
          'model_provider = "fixture"',
          'model = "gpt-test"',
          'model_reasoning_effort = "high"',
          '',
          '[model_providers.fixture]',
          'base_url = "https://openai.example.test/v1"',
          'wire_api = "responses"',
        ].join('\n'),
      }),
      null,
      'custom',
      1_779_321_602,
      1,
      null,
      null,
      null,
      '{}',
      1,
      0,
    )

    insertProvider.run(
      'gemini-native',
      'gemini',
      'Gemini Native',
      JSON.stringify({
        env: {
          GOOGLE_GEMINI_BASE_URL: 'https://generativelanguage.googleapis.com',
          GEMINI_API_KEY: 'test-gemini-key',
          GEMINI_MODEL: 'gemini-test',
        },
      }),
      null,
      'custom',
      1_779_321_603,
      1,
      null,
      null,
      null,
      JSON.stringify({ apiFormat: 'gemini_native' }),
      1,
      0,
    )

    insertProvider.run(
      'opencode-a',
      'opencode',
      'OpenCode A',
      JSON.stringify({ options: { baseURL: 'https://opencode.example.test', apiKey: 'test-opencode-key' } }),
      null,
      'custom',
      1_779_321_604,
      1,
      null,
      null,
      null,
      '{}',
      0,
      0,
    )

    db.prepare('INSERT INTO provider_endpoints (provider_id, app_type, url, added_at) VALUES (?, ?, ?, ?)').run(
      'anthropic-a',
      'claude',
      'https://anthropic-a-alt.example.test',
      1_779_321_605,
    )
    db.prepare('INSERT INTO provider_health (provider_id, app_type, is_healthy, updated_at) VALUES (?, ?, ?, ?)').run(
      'anthropic-a',
      'claude',
      1,
      '2026-05-21T00:00:00.000Z',
    )
  }
  finally {
    db.close()
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('cC Switch external provider source', () => {
  it('reads providers and applies local settings current provider precedence', () => {
    const dir = createTempWorkspace()
    const dbPath = join(dir, 'cc-switch.db')
    const settingsPath = join(dir, 'settings.json')
    writeFixtureDatabase(dbPath)
    writeFileSync(settingsPath, JSON.stringify({ currentProviderClaude: 'anthropic-a' }))

    const snapshot = readCcSwitchSnapshot({ appConfigDir: dir, dbPath, settingsPath })

    expect(snapshot.inventory).toEqual({
      mcpServers: 1,
      prompts: 1,
      skills: 1,
      usageRollups: 1,
      modelPricingEntries: 1,
    })
    expect(snapshot.providers.find(provider => provider.id === 'anthropic-a')).toEqual(expect.objectContaining({
      appType: 'claude',
      isCurrent: true,
      health: 'healthy',
      endpoints: [expect.objectContaining({ url: 'https://anthropic-a-alt.example.test' })],
    }))
    expect(snapshot.providers.find(provider => provider.id === 'anthropic-b')).toEqual(expect.objectContaining({
      isCurrent: false,
    }))
  })

  it('maps supported providers into Cradle snapshot records without exposing unsupported app secrets', async () => {
    const dir = createTempWorkspace()
    const dbPath = join(dir, 'cc-switch.db')
    const settingsPath = join(dir, 'settings.json')
    writeFixtureDatabase(dbPath)
    writeFileSync(settingsPath, JSON.stringify({ currentProviderClaude: 'anthropic-a' }))

    const previousDbPath = process.env.CRADLE_CC_SWITCH_DB_PATH
    const previousSettingsPath = process.env.CRADLE_CC_SWITCH_SETTINGS_PATH
    process.env.CRADLE_CC_SWITCH_DB_PATH = dbPath
    process.env.CRADLE_CC_SWITCH_SETTINGS_PATH = settingsPath

    try {
      const snapshot = await readCcSwitchExternalProviderSnapshot({
        signal: new AbortController().signal,
        logger: {
          info() {},
          warn() {},
          error() {},
          debug() {},
        },
        sharedConfig: new Map(),
      })

      expect(snapshot.providers).toEqual(expect.arrayContaining([
        expect.objectContaining({
          externalId: 'cc-switch:claude:anthropic-a',
          providerKind: 'anthropic',
          current: true,
          config: expect.objectContaining({
            baseUrl: 'https://anthropic-a.example.test',
            model: 'claude-test',
          }),
          metadata: expect.objectContaining({ model: 'claude-test' }),
          credential: expect.objectContaining({ value: 'test-anthropic-key' }),
        }),
        expect.objectContaining({
          externalId: 'cc-switch:codex:codex-a',
          providerKind: 'openai-compatible',
          config: expect.objectContaining({
            baseUrl: 'https://openai.example.test/v1',
            model: 'gpt-test',
            apiMode: 'responses',
          }),
          metadata: expect.objectContaining({ model: 'gpt-test', apiFormat: 'openai_responses', iconSlug: 'codex' }),
          credential: expect.objectContaining({ value: 'test-openai-key' }),
        }),
      ]))
      for (const provider of snapshot.providers) {
        expect(provider.config).not.toHaveProperty('customModels')
        expect(provider.config).not.toHaveProperty('modelRegistryMappings')
      }
      expect(snapshot.providers.some(provider => provider.externalId.includes('gemini-native'))).toBe(false)
      expect(JSON.stringify(snapshot)).not.toContain('test-opencode-key')
      expect(snapshot.warnings).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: 'cc-switch-app-unsupported',
          severity: 'info',
        }),
      ]))
    }
    finally {
      if (previousDbPath === undefined) { delete process.env.CRADLE_CC_SWITCH_DB_PATH }
      else { process.env.CRADLE_CC_SWITCH_DB_PATH = previousDbPath }

      if (previousSettingsPath === undefined) { delete process.env.CRADLE_CC_SWITCH_SETTINGS_PATH }
      else { process.env.CRADLE_CC_SWITCH_SETTINGS_PATH = previousSettingsPath }
    }
  })

  it('skips Claude providers that require non-Anthropic Messages routing', async () => {
    const dir = createTempWorkspace()
    const dbPath = join(dir, 'cc-switch.db')
    const settingsPath = join(dir, 'settings.json')
    writeFixtureDatabase(dbPath)
    writeFileSync(settingsPath, JSON.stringify({ currentProviderClaude: 'anthropic-a' }))

    const db = new Database(dbPath)
    try {
      db.prepare(`
        INSERT INTO providers (id, app_type, name, settings_config, meta)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        'claude-openai-responses',
        'claude',
        'Claude Routed OpenAI',
        JSON.stringify({
          env: {
            ANTHROPIC_BASE_URL: 'https://routed-openai.example.test',
            ANTHROPIC_AUTH_TOKEN: 'test-routed-key',
            ANTHROPIC_MODEL: 'gpt-routed',
          },
        }),
        JSON.stringify({ apiFormat: 'openai_responses' }),
      )
    }
    finally {
      db.close()
    }

    const snapshot = await readCcSwitchExternalProviderSnapshot({
      signal: new AbortController().signal,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sharedConfig: new Map([
        ['CC_SWITCH_DB_PATH', dbPath],
        ['CC_SWITCH_SETTINGS_PATH', settingsPath],
      ]),
    })

    expect(snapshot.providers.some(provider => provider.externalId === 'cc-switch:claude:claude-openai-responses')).toBe(false)
    expect(JSON.stringify(snapshot)).not.toContain('test-routed-key')
    expect(snapshot.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'cc-switch-claude-api-format-unsupported',
        severity: 'info',
      }),
    ]))
  })

  it('maps Codex auth token JSON to a Cradle ChatGPT auth credential', async () => {
    const dir = createTempWorkspace()
    const dbPath = join(dir, 'cc-switch.db')
    const settingsPath = join(dir, 'settings.json')
    writeFixtureDatabase(dbPath)
    writeFileSync(settingsPath, JSON.stringify({ currentProviderCodex: 'codex-official-oauth' }))

    const db = new Database(dbPath)
    try {
      db.prepare(`
        INSERT INTO providers (id, app_type, name, settings_config, meta, is_current)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        'codex-official-oauth',
        'codex',
        'OpenAI Official',
        JSON.stringify({
          auth: {
            OPENAI_API_KEY: null,
            last_refresh: '2026-06-11T00:00:00.000Z',
            tokens: {
              access_token: 'fixture-access-token',
              refresh_token: 'fixture-refresh-token',
              id_token: 'fixture-id-token',
              account_id: 'fixture-chatgpt-account',
            },
          },
          config: [
            'model = "gpt-5-codex"',
            'model_reasoning_effort = "medium"',
          ].join('\n'),
        }),
        '{}',
        1,
      )
    }
    finally {
      db.close()
    }

    const snapshot = await readCcSwitchExternalProviderSnapshot({
      signal: new AbortController().signal,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sharedConfig: new Map([
        ['CC_SWITCH_DB_PATH', dbPath],
        ['CC_SWITCH_SETTINGS_PATH', settingsPath],
      ]),
    })

    const provider = snapshot.providers.find(provider => provider.externalId === 'cc-switch:codex:codex-official-oauth')
    expect(provider).toEqual(expect.objectContaining({
      providerKind: 'openai-compatible',
      config: expect.objectContaining({
        model: 'gpt-5-codex',
        reasoningEffort: 'medium',
      }),
      credential: expect.objectContaining({
        kind: 'chatgpt-auth',
        label: 'OpenAI Official',
      }),
      metadata: expect.objectContaining({
        authMode: 'chatgpt',
        credentialKind: 'chatgpt-auth',
      }),
    }))
    expect(provider?.config).not.toHaveProperty('baseUrl')

    const secret = JSON.parse(provider?.credential?.value ?? '{}') as Record<string, unknown>
    expect(secret).toEqual(expect.objectContaining({
      kind: 'chatgpt-auth',
      accessToken: 'fixture-access-token',
      refreshToken: 'fixture-refresh-token',
      chatgptAccountId: 'fixture-chatgpt-account',
      chatgptPlanType: null,
    }))
  })

  it('maps the CC Switch official Claude seed to Claude.ai auth mode without a credential', async () => {
    const dir = createTempWorkspace()
    const dbPath = join(dir, 'cc-switch.db')
    const settingsPath = join(dir, 'settings.json')
    writeFixtureDatabase(dbPath)
    writeFileSync(settingsPath, JSON.stringify({ currentProviderClaude: 'claude-official' }))

    const db = new Database(dbPath)
    try {
      db.prepare(`
        INSERT INTO providers (id, app_type, name, settings_config, meta, is_current)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        'claude-official',
        'claude',
        'Claude Official',
        JSON.stringify({ env: {} }),
        '{}',
        1,
      )
    }
    finally {
      db.close()
    }

    const snapshot = await readCcSwitchExternalProviderSnapshot({
      signal: new AbortController().signal,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sharedConfig: new Map([
        ['CC_SWITCH_DB_PATH', dbPath],
        ['CC_SWITCH_SETTINGS_PATH', settingsPath],
      ]),
    })

    const provider = snapshot.providers.find(provider => provider.externalId === 'cc-switch:claude:claude-official')
    expect(provider).toEqual(expect.objectContaining({
      providerKind: 'anthropic',
      current: true,
      config: expect.objectContaining({
        authMode: 'claudeAi',
      }),
      metadata: expect.objectContaining({
        authMode: 'claudeAi',
      }),
    }))
    expect(provider?.credential).toBeUndefined()
  })

  it('tolerates nullable external fields and skips only malformed provider rows', async () => {
    const dir = createTempWorkspace()
    const dbPath = join(dir, 'cc-switch.db')
    const settingsPath = join(dir, 'settings.json')
    writeFixtureDatabase(dbPath)
    writeFileSync(settingsPath, JSON.stringify({ currentProviderCodex: null }))

    const db = new Database(dbPath)
    try {
      const insertProvider = db.prepare(`
        INSERT INTO providers (id, app_type, name, settings_config, meta)
        VALUES (?, ?, ?, ?, ?)
      `)
      insertProvider.run(
        'codex-null-key',
        'codex',
        'Codex Null Key',
        JSON.stringify({
          env: null,
          auth: { OPENAI_API_KEY: null },
          config: [
            'model_provider = "fixture"',
            'model = "gpt-null-key"',
            '',
            '[model_providers.fixture]',
            'base_url = "https://null-key.example.test/v1"',
            'wire_api = "responses"',
          ].join('\n'),
        }),
        JSON.stringify({ apiFormat: null }),
      )
      insertProvider.run(
        'codex-bad-settings',
        'codex',
        'Codex Bad Settings',
        JSON.stringify({
          auth: { OPENAI_API_KEY: 123 },
          config: [
            'model_provider = "fixture"',
            'model = "gpt-bad-settings"',
            '',
            '[model_providers.fixture]',
            'base_url = "https://bad-settings.example.test/v1"',
          ].join('\n'),
        }),
        '{}',
      )
    }
    finally {
      db.close()
    }

    const snapshot = await readCcSwitchExternalProviderSnapshot({
      signal: new AbortController().signal,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sharedConfig: new Map([
        ['CC_SWITCH_DB_PATH', dbPath],
        ['CC_SWITCH_SETTINGS_PATH', settingsPath],
      ]),
    })

    const nullableProvider = snapshot.providers.find(provider => provider.externalId === 'cc-switch:codex:codex-null-key')
    expect(snapshot.source.status).toBe('warning')
    expect(nullableProvider).toEqual(expect.objectContaining({
      providerKind: 'openai-compatible',
      config: expect.objectContaining({
        baseUrl: 'https://null-key.example.test/v1',
        model: 'gpt-null-key',
        apiMode: 'responses',
      }),
      metadata: expect.objectContaining({ model: 'gpt-null-key' }),
    }))
    expect(nullableProvider?.credential).toBeUndefined()
    expect(snapshot.providers.some(provider => provider.externalId === 'cc-switch:codex:codex-bad-settings')).toBe(false)
    expect(snapshot.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'cc-switch-provider-settings-invalid',
        severity: 'warning',
      }),
    ]))
  })
})
