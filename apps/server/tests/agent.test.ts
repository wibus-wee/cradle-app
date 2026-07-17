import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { providerTargets } from '@cradle/db'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { db, shutdownInfra } from '../src/infra'
import { calculatePluginPackageChecksum } from '../src/plugins/package-checksum'
import { grantPluginTrust } from '../src/plugins/trust-grants'

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function createExecutable(dir: string, name: string): string {
  const path = join(dir, name)
  writeFileSync(path, '#!/bin/sh\nexit 0\n')
  chmodSync(path, 0o755)
  return path
}

function buildAvatarUrl(style: string, seed: string): string {
  return `https://api.dicebear.com/9.x/${encodeURIComponent(style)}/svg?seed=${encodeURIComponent(seed)}`
}

function repoPluginsDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../plugins')
}

async function grantCcSwitchPluginTrust(): Promise<void> {
  const packageDir = join(repoPluginsDir(), 'cc-switch')
  grantPluginTrust(
    '@cradle/cc-switch',
    await calculatePluginPackageChecksum(packageDir),
    'test trust grant',
  )
}

function writeCcSwitchOnboardingDatabase(path: string): void {
  const sqlite = new Database(path)
  try {
    sqlite.exec(`
      CREATE TABLE providers (
        id TEXT NOT NULL,
        app_type TEXT NOT NULL,
        name TEXT NOT NULL,
        settings_config TEXT NOT NULL,
        icon TEXT,
        meta TEXT NOT NULL DEFAULT '{}',
        is_current BOOLEAN NOT NULL DEFAULT 0,
        PRIMARY KEY (id, app_type)
      );
    `)
    sqlite
      .prepare(
        `
      INSERT INTO providers (id, app_type, name, settings_config, icon, meta, is_current)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        'claude-current',
        'claude',
        'CC Switch Claude',
        JSON.stringify({
          env: {
            ANTHROPIC_BASE_URL: 'https://cc-switch-claude.example.test',
            ANTHROPIC_AUTH_TOKEN: 'cc-switch-claude-secret',
            ANTHROPIC_MODEL: 'claude-cc-switch-model',
            ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-cc-switch-haiku',
            ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-cc-switch-sonnet',
            ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-cc-switch-opus',
          },
        }),
        'huoshan',
        JSON.stringify({ apiFormat: 'anthropic' }),
        1,
      )
    sqlite
      .prepare(
        `
      INSERT INTO providers (id, app_type, name, settings_config, icon, meta, is_current)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        'codex-current',
        'codex',
        'CC Switch Codex',
        JSON.stringify({
          auth: {
            OPENAI_API_KEY: 'cc-switch-codex-secret',
          },
          config: [
            'model_provider = "fixture"',
            'model = "gpt-cc-switch"',
            'model_reasoning_effort = "high"',
            'approval_policy = "on-request"',
            'sandbox_mode = "workspace-write"',
            '',
            '[model_providers.fixture]',
            'base_url = "https://cc-switch-codex.example.test/v1"',
            'wire_api = "responses"',
            '',
          ].join('\n'),
        }),
        null,
        JSON.stringify({}),
        1,
      )
  }
 finally {
    sqlite.close()
  }
}

function setEnv(key: string, value: string, previous: Map<string, string | undefined>): void {
  if (!previous.has(key)) {
    previous.set(key, process.env[key])
  }
  process.env[key] = value
}

function restoreEnv(previous: Map<string, string | undefined>): void {
  for (const [key, value] of previous) {
    if (value === undefined) {
      delete process.env[key]
    }
 else {
      process.env[key] = value
    }
  }
}

describe('agent identity capability', () => {
  it('supports CRUD, filters, and avatar URL policy', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const previousDataDir = process.env.CRADLE_DATA_DIR
    process.env.CRADLE_DATA_DIR = dataDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      app = await createServerApp()
      const d = db()

      const providerTargetOneId = randomUUID()
      const providerTargetTwoId = randomUUID()
      d.insert(providerTargets)
        .values([
          {
            id: providerTargetOneId,
            kind: 'manual',
            displayName: 'Provider Target One',
            providerKind: 'openai-compatible',
          },
          {
            id: providerTargetTwoId,
            kind: 'manual',
            displayName: 'Provider Target Two',
            providerKind: 'openai-compatible',
          },
        ])
        .run()

      const createOne = await app.handle(
        new Request('http://localhost/agents', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Agent One',
            description: 'First agent',
            avatarStyle: 'bottts-neutral',
            avatarSeed: 'seed-one',
            providerTargetId: providerTargetOneId,
            modelId: 'gpt-test',
            thinkingEffort: 'high',
            configJson: '{"systemPrompt":"hello"}',
          }),
        }),
      )
      expect(createOne.status).toBe(200)
      const agentOne = await createOne.json()
      expect(agentOne).toEqual(
        expect.objectContaining({
          name: 'Agent One',
          description: 'First agent',
          providerTargetId: providerTargetOneId,
          modelId: 'gpt-test',
          thinkingEffort: 'high',
          enabled: true,
        }),
      )
      expect(agentOne.avatarUrl).toBe(buildAvatarUrl('bottts-neutral', 'seed-one'))

      const createTwo = await app.handle(
        new Request('http://localhost/agents', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Agent Two',
            avatarStyle: 'identicon',
            avatarSeed: 'seed-two',
            providerTargetId: providerTargetTwoId,
          }),
        }),
      )
      expect(createTwo.status).toBe(200)
      const agentTwo = await createTwo.json()
      expect(agentTwo.avatarUrl).toBe(buildAvatarUrl('identicon', 'seed-two'))
      expect(agentTwo.enabled).toBe(true)

      const createCli = await app.handle(
        new Request('http://localhost/agents', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Terminal Agent',
            avatarStyle: 'bottts-neutral',
            avatarSeed: 'seed-cli',
            runtimeKind: 'cli-tui',
            configJson: JSON.stringify({
              cliTui: {
                preset: 'claude-code',
                executable: 'claude',
                args: ['--dangerously-skip-permissions'],
              },
            }),
          }),
        }),
      )
      expect(createCli.status).toBe(200)
      const cliAgent = await createCli.json()
      expect(cliAgent).toEqual(
        expect.objectContaining({
          name: 'Terminal Agent',
          runtimeKind: 'cli-tui',
          providerTargetId: null,
          modelId: null,
        }),
      )

      const listRes = await app.handle(new Request('http://localhost/agents'))
      expect(listRes.status).toBe(200)
      const list = await listRes.json()
      expect(list).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: agentOne.id }),
          expect.objectContaining({ id: agentTwo.id }),
          expect.objectContaining({ id: cliAgent.id }),
        ]),
      )

      const getRes = await app.handle(new Request(`http://localhost/agents/${agentOne.id}`))
      expect(getRes.status).toBe(200)
      expect(await getRes.json()).toEqual(expect.objectContaining({ id: agentOne.id }))

      const missingGet = await app.handle(new Request('http://localhost/agents/missing-agent'))
      expect(missingGet.status).toBe(404)

      const updateRes = await app.handle(
        new Request(`http://localhost/agents/${agentTwo.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            description: 'Updated agent',
            avatarSeed: 'seed-two-next',
            enabled: false,
            modelId: 'codex-next',
            thinkingEffort: 'medium',
          }),
        }),
      )
      expect(updateRes.status).toBe(200)
      const updated = await updateRes.json()
      expect(updated).toEqual(
        expect.objectContaining({
          id: agentTwo.id,
          description: 'Updated agent',
          enabled: false,
          modelId: 'codex-next',
          thinkingEffort: 'medium',
        }),
      )
      expect(updated.avatarStyle).toBe('identicon')
      expect(updated.avatarSeed).toBe('seed-two-next')
      expect(updated.avatarUrl).toBe(buildAvatarUrl('identicon', 'seed-two-next'))

      const enabledRes = await app.handle(new Request('http://localhost/agents?enabled=true'))
      expect(enabledRes.status).toBe(200)
      expect(await enabledRes.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: agentOne.id, enabled: true }),
          expect.objectContaining({ id: cliAgent.id, enabled: true }),
        ]),
      )

      const disabledRes = await app.handle(new Request('http://localhost/agents?enabled=false'))
      expect(disabledRes.status).toBe(200)
      expect(await disabledRes.json()).toEqual([
        expect.objectContaining({ id: agentTwo.id, enabled: false }),
      ])

      const targetFiltered = await app.handle(
        new Request(
          `http://localhost/agents?providerTargetId=${encodeURIComponent(providerTargetTwoId)}`,
        ),
      )
      expect(targetFiltered.status).toBe(200)
      expect(await targetFiltered.json()).toEqual([
        expect.objectContaining({ id: agentTwo.id, providerTargetId: providerTargetTwoId }),
      ])

      const invalidCreate = await app.handle(
        new Request('http://localhost/agents', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: '',
            avatarStyle: '',
            avatarSeed: '',
            providerTargetId: '',
          }),
        }),
      )
      expect(invalidCreate.status).toBe(400)
      const invalidCreateBody = await invalidCreate.json()
      expect(invalidCreateBody.code).toBe('validation_error')

      const invalidProvider = await app.handle(
        new Request('http://localhost/agents', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Broken Agent',
            avatarStyle: 'thumbs',
            avatarSeed: 'broken-seed',
            providerTargetId: randomUUID(),
          }),
        }),
      )
      expect(invalidProvider.status).toBe(400)
      const invalidProviderBody = await invalidProvider.json()
      expect(invalidProviderBody.code).toBe('invalid_agent_input')

      const ultraThinkingEffort = await app.handle(
        new Request('http://localhost/agents', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Ultra Thinking Agent',
            avatarStyle: 'thumbs',
            avatarSeed: 'ultra-thinking-seed',
            providerTargetId: providerTargetOneId,
            thinkingEffort: 'ultra',
          }),
        }),
      )
      expect(ultraThinkingEffort.status).toBe(200)
      expect(await ultraThinkingEffort.json()).toEqual(
        expect.objectContaining({ thinkingEffort: 'ultra' }),
      )

      const invalidThinkingEffort = await app.handle(
        new Request('http://localhost/agents', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Unsupported Thinking Agent',
            avatarStyle: 'thumbs',
            avatarSeed: 'unsupported-thinking-seed',
            providerTargetId: providerTargetOneId,
            thinkingEffort: 'unsupported',
          }),
        }),
      )
      expect(invalidThinkingEffort.status).toBe(400)
      expect((await invalidThinkingEffort.json()).code).toBe('validation_error')

      const invalidCli = await app.handle(
        new Request('http://localhost/agents', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'Broken CLI Agent',
            avatarStyle: 'bottts-neutral',
            avatarSeed: 'seed-broken-cli',
            runtimeKind: 'cli-tui',
          }),
        }),
      )
      expect(invalidCli.status).toBe(400)
      expect((await invalidCli.json()).code).toBe('invalid_agent_input')

      const missingUpdate = await app.handle(
        new Request('http://localhost/agents/missing-agent', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Missing Agent' }),
        }),
      )
      expect(missingUpdate.status).toBe(404)

      const deleteRes = await app.handle(
        new Request(`http://localhost/agents/${agentOne.id}`, { method: 'DELETE' }),
      )
      expect(deleteRes.status).toBe(200)
      expect(await deleteRes.json()).toEqual({ ok: true })

      const afterDelete = await app.handle(new Request(`http://localhost/agents/${agentOne.id}`))
      expect(afterDelete.status).toBe(404)
    }
 finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
 else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
    }
  })

  it('imports local Claude and Codex config as deduplicated agents', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const homeDir = makeTempDir('cradle-local-agent-home-')
    const claudeDir = join(homeDir, '.claude')
    const codexDir = join(homeDir, '.codex')
    const previousEnv = new Map<string, string | undefined>()
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousCredentialSecret = process.env.CRADLE_CREDENTIAL_SECRET
    const previousHome = process.env.HOME
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'local-agent-import-secret'
    process.env.HOME = homeDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      mkdirSync(claudeDir, { recursive: true })
      mkdirSync(codexDir, { recursive: true })
      const claudeSettingsPath = join(claudeDir, 'settings.json')
      const claudeLocalSettingsPath = join(claudeDir, 'settings.local.json')
      const codexConfigPath = join(codexDir, 'config.toml')
      const codexAuthPath = join(codexDir, 'auth.json')

      writeFileSync(
        claudeSettingsPath,
        JSON.stringify({
          env: {
            ANTHROPIC_API_KEY: 'test-anthropic-secret',
            ANTHROPIC_MODEL: 'claude-3-7-sonnet-latest',
            ANTHROPIC_BASE_URL: 'https://anthropic.example.test',
          },
        }),
      )
      writeFileSync(
        codexConfigPath,
        [
          'model_provider = "fixture"',
          'model = "gpt-5-test"',
          'model_reasoning_effort = "ultra"',
          'approval_policy = "on-request"',
          'sandbox_mode = "workspace-write"',
          '',
          '[model_providers.fixture]',
          'base_url = "https://openai.example.test/v1"',
          'wire_api = "responses"',
          '',
        ].join('\n'),
      )
      writeFileSync(codexAuthPath, JSON.stringify({ OPENAI_API_KEY: 'test-openai-secret' }))

      setEnv('CRADLE_LOCAL_AGENT_CONFIG_CLAUDE_DIR', claudeDir, previousEnv)
      setEnv('CRADLE_LOCAL_AGENT_CONFIG_CLAUDE_SETTINGS_PATH', claudeSettingsPath, previousEnv)
      setEnv(
        'CRADLE_LOCAL_AGENT_CONFIG_CLAUDE_LOCAL_SETTINGS_PATH',
        claudeLocalSettingsPath,
        previousEnv,
      )
      setEnv('CRADLE_LOCAL_AGENT_CONFIG_CODEX_DIR', codexDir, previousEnv)
      setEnv('CRADLE_LOCAL_AGENT_CONFIG_CODEX_CONFIG_PATH', codexConfigPath, previousEnv)
      setEnv('CRADLE_LOCAL_AGENT_CONFIG_CODEX_AUTH_PATH', codexAuthPath, previousEnv)
      setEnv('CRADLE_LOCAL_AGENT_CONFIG_INCLUDE_PROCESS_ENV', 'false', previousEnv)
      setEnv('PATH', '', previousEnv)

      app = await createServerApp()
      const importBody = { includeProcessEnv: false }

      const firstImport = await app.handle(
        new Request('http://localhost/agents/import/local-config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(importBody),
        }),
      )
      expect(firstImport.status).toBe(200)
      const firstBody = await firstImport.json()
      expect(JSON.stringify(firstBody)).not.toContain('test-anthropic-secret')
      expect(JSON.stringify(firstBody)).not.toContain('test-openai-secret')
      expect(firstBody.preview.sourceRefreshes[0]).toEqual(
        expect.objectContaining({
          sourceLabel: 'Local Agent Config',
          recordsSeen: 2,
          recordsProjected: 2,
        }),
      )
      expect(firstBody).toEqual(
        expect.objectContaining({
          created: 2,
          existing: 0,
          skipped: 0,
        }),
      )
      expect(firstBody.agents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            app: 'claude',
            externalRecordId: 'claude:local-current',
            runtimeKind: 'claude-agent',
            status: 'created',
            agent: expect.objectContaining({
              name: 'Local Claude',
              modelId: 'claude-3-7-sonnet-latest',
              runtimeKind: 'claude-agent',
            }),
          }),
          expect.objectContaining({
            app: 'codex',
            externalRecordId: 'codex:local-current',
            runtimeKind: 'codex',
            status: 'created',
            agent: expect.objectContaining({
              name: 'Local Codex',
              modelId: 'gpt-5-test',
              thinkingEffort: 'ultra',
              runtimeKind: 'codex',
            }),
          }),
        ]),
      )

      const secondImport = await app.handle(
        new Request('http://localhost/agents/import/local-config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(importBody),
        }),
      )
      expect(secondImport.status).toBe(200)
      const secondBody = await secondImport.json()
      expect(secondBody.preview.sourceRefreshes[0]).toEqual(
        expect.objectContaining({
          sourceLabel: 'Local Agent Config',
          recordsSeen: 2,
          recordsProjected: 2,
        }),
      )
      expect(secondBody).toEqual(
        expect.objectContaining({
          created: 0,
          existing: 2,
          skipped: 0,
        }),
      )

      const listRes = await app.handle(new Request('http://localhost/agents'))
      expect(listRes.status).toBe(200)
      const list = await listRes.json()
      expect(list).toHaveLength(2)
      expect(list.map((agent: { name: string }) => agent.name).sort()).toEqual([
        'Local Claude',
        'Local Codex',
      ])
    }
 finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(homeDir, { recursive: true, force: true })
      restoreEnv(previousEnv)
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
 else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousCredentialSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      }
 else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousCredentialSecret
      }
      if (previousHome === undefined) {
        delete process.env.HOME
      }
 else {
        process.env.HOME = previousHome
      }
    }
  })

  it('keeps Claude and Codex CLI TUI candidates when provider config exists', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const homeDir = makeTempDir('cradle-local-agent-cli-overlap-home-')
    const claudeDir = join(homeDir, '.claude')
    const codexDir = join(homeDir, '.codex')
    const binDir = join(homeDir, 'bin')
    const previousEnv = new Map<string, string | undefined>()
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousHome = process.env.HOME
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.HOME = homeDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      mkdirSync(claudeDir, { recursive: true })
      mkdirSync(codexDir, { recursive: true })
      mkdirSync(binDir, { recursive: true })
      const claudePath = createExecutable(binDir, 'claude')
      const codexPath = createExecutable(binDir, 'codex')
      const claudeSettingsPath = join(claudeDir, 'settings.json')
      const claudeLocalSettingsPath = join(claudeDir, 'settings.local.json')
      const codexConfigPath = join(codexDir, 'config.toml')
      const codexAuthPath = join(codexDir, 'auth.json')

      writeFileSync(
        claudeSettingsPath,
        JSON.stringify({
          env: {
            ANTHROPIC_MODEL: 'claude-overlap-model',
          },
        }),
      )
      writeFileSync(codexConfigPath, ['model = "gpt-overlap"', ''].join('\n'))

      setEnv('CRADLE_LOCAL_AGENT_CONFIG_CLAUDE_DIR', claudeDir, previousEnv)
      setEnv('CRADLE_LOCAL_AGENT_CONFIG_CLAUDE_SETTINGS_PATH', claudeSettingsPath, previousEnv)
      setEnv(
        'CRADLE_LOCAL_AGENT_CONFIG_CLAUDE_LOCAL_SETTINGS_PATH',
        claudeLocalSettingsPath,
        previousEnv,
      )
      setEnv('CRADLE_LOCAL_AGENT_CONFIG_CODEX_DIR', codexDir, previousEnv)
      setEnv('CRADLE_LOCAL_AGENT_CONFIG_CODEX_CONFIG_PATH', codexConfigPath, previousEnv)
      setEnv('CRADLE_LOCAL_AGENT_CONFIG_CODEX_AUTH_PATH', codexAuthPath, previousEnv)
      setEnv('CRADLE_LOCAL_AGENT_CONFIG_INCLUDE_PROCESS_ENV', 'false', previousEnv)
      setEnv('PATH', binDir, previousEnv)

      app = await createServerApp()
      const previewRes = await app.handle(
        new Request('http://localhost/agents/import/local-config/preview', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ includeProcessEnv: false }),
        }),
      )
      expect(previewRes.status).toBe(200)
      const preview = await previewRes.json()

      expect(preview.candidates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            app: 'claude',
            externalRecordId: 'claude:local-current',
            runtimeKind: 'claude-agent',
            agentName: 'Local Claude',
          }),
          expect.objectContaining({
            app: 'claude',
            externalRecordId: 'claude:local-command',
            runtimeKind: 'cli-tui',
            agentName: 'Local Claude CLI',
            executable: claudePath,
            importable: true,
          }),
          expect.objectContaining({
            app: 'codex',
            externalRecordId: 'codex:local-current',
            runtimeKind: 'codex',
            agentName: 'Local Codex',
          }),
          expect.objectContaining({
            app: 'codex',
            externalRecordId: 'codex:local-command',
            runtimeKind: 'cli-tui',
            agentName: 'Local Codex CLI',
            executable: codexPath,
            importable: true,
          }),
        ]),
      )
    }
 finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(homeDir, { recursive: true, force: true })
      restoreEnv(previousEnv)
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
 else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousHome === undefined) {
        delete process.env.HOME
      }
 else {
        process.env.HOME = previousHome
      }
    }
  })

  it('imports local CLI command agents with the detected executable path', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const homeDir = makeTempDir('cradle-local-cli-home-')
    const binDir = join(homeDir, 'bin')
    const previousEnv = new Map<string, string | undefined>()
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousHome = process.env.HOME
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.HOME = homeDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      mkdirSync(binDir, { recursive: true })
      const claudePath = createExecutable(binDir, 'claude')
      const codexPath = createExecutable(binDir, 'codex')
      const piPath = createExecutable(binDir, 'pi')
      const kimiPath = createExecutable(binDir, 'kimi')

      setEnv('CRADLE_LOCAL_AGENT_CONFIG_INCLUDE_PROCESS_ENV', 'false', previousEnv)
      setEnv('PATH', binDir, previousEnv)

      app = await createServerApp()
      const importRes = await app.handle(
        new Request('http://localhost/agents/import/local-config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ includeProcessEnv: false }),
        }),
      )
      expect(importRes.status).toBe(200)
      const imported = await importRes.json()

      expect(imported).toEqual(
        expect.objectContaining({
          created: 4,
          existing: 0,
          skipped: 0,
        }),
      )
      expect(imported.preview.candidates).toHaveLength(4)
      expect(imported.preview.candidates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            app: 'claude',
            externalRecordId: 'claude:local-command',
            runtimeKind: 'cli-tui',
            agentName: 'Local Claude CLI',
            executable: claudePath,
            importable: true,
          }),
          expect.objectContaining({
            app: 'codex',
            externalRecordId: 'codex:local-command',
            runtimeKind: 'cli-tui',
            agentName: 'Local Codex CLI',
            executable: codexPath,
            importable: true,
          }),
          expect.objectContaining({
            app: 'pi',
            externalRecordId: 'pi:local-command',
            runtimeKind: 'cli-tui',
            executable: piPath,
            importable: true,
          }),
          expect.objectContaining({
            app: 'kimi',
            externalRecordId: 'kimi:local-command',
            runtimeKind: 'cli-tui',
            executable: kimiPath,
            importable: true,
          }),
        ]),
      )
      expect(imported.agents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            app: 'claude',
            externalRecordId: 'claude:local-command',
            runtimeKind: 'cli-tui',
            status: 'created',
            agent: expect.objectContaining({
              name: 'Local Claude CLI',
              runtimeKind: 'cli-tui',
              providerTargetId: null,
            }),
          }),
          expect.objectContaining({
            app: 'codex',
            externalRecordId: 'codex:local-command',
            runtimeKind: 'cli-tui',
            status: 'created',
            agent: expect.objectContaining({
              name: 'Local Codex CLI',
              runtimeKind: 'cli-tui',
              providerTargetId: null,
            }),
          }),
          expect.objectContaining({
            app: 'pi',
            externalRecordId: 'pi:local-command',
            runtimeKind: 'cli-tui',
            status: 'created',
            agent: expect.objectContaining({
              name: 'Local Pi',
              runtimeKind: 'cli-tui',
              providerTargetId: null,
            }),
          }),
          expect.objectContaining({
            app: 'kimi',
            externalRecordId: 'kimi:local-command',
            runtimeKind: 'cli-tui',
            status: 'created',
            agent: expect.objectContaining({
              name: 'Local Kimi',
              runtimeKind: 'cli-tui',
              providerTargetId: null,
            }),
          }),
        ]),
      )
      const kimiImport = imported.agents.find((entry: { app: string }) => entry.app === 'kimi')
      expect(JSON.parse(kimiImport.agent.configJson)).toEqual(
        expect.objectContaining({
          cliTui: {
            executable: kimiPath,
            args: [],
          },
          cradleOnboarding: expect.objectContaining({
            localApp: 'kimi',
            sourceKind: 'local-config',
            externalRecordId: 'kimi:local-command',
          }),
        }),
      )
    }
 finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(homeDir, { recursive: true, force: true })
      restoreEnv(previousEnv)
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
 else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousHome === undefined) {
        delete process.env.HOME
      }
 else {
        process.env.HOME = previousHome
      }
    }
  })

  it('maps local CC Switch proxy config to CC Switch current provider agents', async () => {
    const dataDir = makeTempDir('cradle-data-')
    const homeDir = makeTempDir('cradle-local-cc-switch-home-')
    const claudeDir = join(homeDir, '.claude')
    const codexDir = join(homeDir, '.codex')
    const ccSwitchDir = join(homeDir, '.cc-switch')
    const ccSwitchDbPath = join(ccSwitchDir, 'cc-switch.db')
    const ccSwitchSettingsPath = join(ccSwitchDir, 'settings.json')
    const previousEnv = new Map<string, string | undefined>()
    const previousDataDir = process.env.CRADLE_DATA_DIR
    const previousCredentialSecret = process.env.CRADLE_CREDENTIAL_SECRET
    const previousHome = process.env.HOME
    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'local-agent-cc-switch-secret'
    process.env.HOME = homeDir
    let app: Awaited<ReturnType<typeof createServerApp>> | undefined

    try {
      mkdirSync(claudeDir, { recursive: true })
      mkdirSync(codexDir, { recursive: true })
      mkdirSync(ccSwitchDir, { recursive: true })
      const claudeSettingsPath = join(claudeDir, 'settings.json')
      const claudeLocalSettingsPath = join(claudeDir, 'settings.local.json')
      const codexConfigPath = join(codexDir, 'config.toml')
      const codexAuthPath = join(codexDir, 'auth.json')

      writeCcSwitchOnboardingDatabase(ccSwitchDbPath)
      writeFileSync(
        ccSwitchSettingsPath,
        JSON.stringify({
          currentProviderClaude: 'claude-current',
          currentProviderCodex: 'codex-current',
        }),
      )
      writeFileSync(
        claudeSettingsPath,
        JSON.stringify({
          env: {
            ANTHROPIC_BASE_URL: 'http://127.0.0.1:15721',
            ANTHROPIC_API_KEY: 'local-proxy-placeholder',
            ANTHROPIC_MODEL: 'claude-local-proxy-model',
          },
        }),
      )
      writeFileSync(
        codexConfigPath,
        [
          'model_provider = "ccswitch"',
          'model = "gpt-local-proxy"',
          '',
          '[model_providers.ccswitch]',
          'base_url = "http://127.0.0.1:15721/v1"',
          'wire_api = "responses"',
          '',
        ].join('\n'),
      )
      writeFileSync(codexAuthPath, JSON.stringify({ OPENAI_API_KEY: 'local-proxy-placeholder' }))

      setEnv('CRADLE_PLUGINS_DIR', repoPluginsDir(), previousEnv)
      setEnv('CRADLE_EXTERNAL_PLUGINS_DIRS', '', previousEnv)
      setEnv(
        'CRADLE_PLUGIN_ALLOWED_CC_SWITCH_PERMISSIONS',
        'filesystem.cc-switch.read',
        previousEnv,
      )
      setEnv('CRADLE_CC_SWITCH_DB_PATH', ccSwitchDbPath, previousEnv)
      setEnv('CRADLE_CC_SWITCH_SETTINGS_PATH', ccSwitchSettingsPath, previousEnv)
      setEnv('CRADLE_LOCAL_AGENT_CONFIG_CLAUDE_DIR', claudeDir, previousEnv)
      setEnv('CRADLE_LOCAL_AGENT_CONFIG_CLAUDE_SETTINGS_PATH', claudeSettingsPath, previousEnv)
      setEnv(
        'CRADLE_LOCAL_AGENT_CONFIG_CLAUDE_LOCAL_SETTINGS_PATH',
        claudeLocalSettingsPath,
        previousEnv,
      )
      setEnv('CRADLE_LOCAL_AGENT_CONFIG_CODEX_DIR', codexDir, previousEnv)
      setEnv('CRADLE_LOCAL_AGENT_CONFIG_CODEX_CONFIG_PATH', codexConfigPath, previousEnv)
      setEnv('CRADLE_LOCAL_AGENT_CONFIG_CODEX_AUTH_PATH', codexAuthPath, previousEnv)
      setEnv('CRADLE_LOCAL_AGENT_CONFIG_INCLUDE_PROCESS_ENV', 'false', previousEnv)
      setEnv('PATH', '', previousEnv)
      await grantCcSwitchPluginTrust()

      app = await createServerApp({ startBackgroundTasks: false })
      const previewRes = await app.handle(
        new Request('http://localhost/agents/import/local-config/preview', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ includeProcessEnv: false }),
        }),
      )
      expect(previewRes.status).toBe(200)
      const preview = await previewRes.json()
      expect(JSON.stringify(preview)).not.toContain('local-proxy-placeholder')
      expect(JSON.stringify(preview)).not.toContain('cc-switch-claude-secret')
      expect(JSON.stringify(preview)).not.toContain('cc-switch-codex-secret')
      expect(preview.candidates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            app: 'claude',
            sourceKind: 'cc-switch',
            agentName: 'Local Claude',
            name: 'Local Claude',
            resolvedProviderName: 'CC Switch Claude',
            modelId: 'claude-cc-switch-model',
            importable: true,
          }),
          expect.objectContaining({
            app: 'codex',
            sourceKind: 'cc-switch',
            agentName: 'Local Codex',
            name: 'Local Codex',
            resolvedProviderName: 'CC Switch Codex',
            modelId: 'gpt-cc-switch',
            importable: true,
          }),
        ]),
      )
      expect(
        preview.candidates.some(
          (candidate: { sourceKind: string }) => candidate.sourceKind === 'local-config',
        ),
      ).toBe(false)

      const claudeCandidate = preview.candidates.find(
        (candidate: { app: string }) => candidate.app === 'claude',
      )
      expect(claudeCandidate).toEqual(
        expect.objectContaining({
          importable: true,
          providerTargetId: expect.any(String),
          iconSlug: 'volcengine',
          avatarUrl: null,
        }),
      )
      const recordsRes = await app.handle(
        new Request('http://localhost/external-provider-sources/records'),
      )
      expect(recordsRes.status).toBe(200)
      const records = await recordsRes.json()
      const claudeRecord = records.find(
        (record: { externalId: string }) => record.externalId === claudeCandidate.externalRecordId,
      )
      expect(claudeRecord).toEqual(
        expect.objectContaining({
          externalId: claudeCandidate.externalRecordId,
          providerTargetId: claudeCandidate.providerTargetId,
          runtimeTargetEnabled: true,
        }),
      )
      const disableTarget = await app.handle(
        new Request(
          `http://localhost/external-provider-sources/${claudeRecord.sourceKey}/records/${claudeRecord.externalId}/runtime-target`,
          {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ enabled: false }),
          },
        ),
      )
      expect(disableTarget.status).toBe(200)
      expect(await disableTarget.json()).toEqual(
        expect.objectContaining({
          id: claudeCandidate.providerTargetId,
          enabled: false,
        }),
      )

      const importRes = await app.handle(
        new Request('http://localhost/agents/import/local-config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ includeProcessEnv: false }),
        }),
      )
      expect(importRes.status).toBe(200)
      const imported = await importRes.json()
      expect(imported).toEqual(
        expect.objectContaining({
          created: 2,
          existing: 0,
          skipped: 0,
        }),
      )
      expect(imported.agents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            app: 'claude',
            sourceKind: 'cc-switch',
            externalRecordId: 'cc-switch:claude:claude-current',
            providerTargetId: claudeCandidate.providerTargetId,
            agent: expect.objectContaining({
              name: 'Local Claude',
              modelId: 'claude-cc-switch-model',
              runtimeKind: 'claude-agent',
              providerTargetId: claudeCandidate.providerTargetId,
              enabled: false,
            }),
          }),
          expect.objectContaining({
            app: 'codex',
            sourceKind: 'cc-switch',
            externalRecordId: 'cc-switch:codex:codex-current',
            agent: expect.objectContaining({
              name: 'Local Codex',
              modelId: 'gpt-cc-switch',
              runtimeKind: 'codex',
              enabled: true,
            }),
          }),
        ]),
      )
      const claudeImport = imported.agents.find((entry: { app: string }) => entry.app === 'claude')
      const codexImport = imported.agents.find((entry: { app: string }) => entry.app === 'codex')
      expect(JSON.parse(claudeImport.agent.configJson)).toEqual(
        expect.objectContaining({
          model: 'claude-cc-switch-model',
          claudeAgent: {
            modelAliases: {
              haiku: 'claude-cc-switch-haiku',
              sonnet: 'claude-cc-switch-sonnet',
              opus: 'claude-cc-switch-opus',
            },
          },
          cradleOnboarding: expect.objectContaining({
            localApp: 'claude',
            sourceKind: 'cc-switch',
            resolvedProviderName: 'CC Switch Claude',
          }),
        }),
      )
      expect(JSON.parse(codexImport.agent.configJson)).toEqual(
        expect.objectContaining({
          model: 'gpt-cc-switch',
          reasoningEffort: 'high',
          approvalPolicy: 'on-request',
          sandboxMode: 'workspace-write',
          cradleOnboarding: expect.objectContaining({
            localApp: 'codex',
            sourceKind: 'cc-switch',
            resolvedProviderName: 'CC Switch Codex',
          }),
        }),
      )
    }
 finally {
      shutdownInfra()
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(homeDir, { recursive: true, force: true })
      restoreEnv(previousEnv)
      if (previousDataDir === undefined) {
        delete process.env.CRADLE_DATA_DIR
      }
 else {
        process.env.CRADLE_DATA_DIR = previousDataDir
      }
      if (previousCredentialSecret === undefined) {
        delete process.env.CRADLE_CREDENTIAL_SECRET
      }
 else {
        process.env.CRADLE_CREDENTIAL_SECRET = previousCredentialSecret
      }
      if (previousHome === undefined) {
        delete process.env.HOME
      }
 else {
        process.env.HOME = previousHome
      }
    }
  })
})
