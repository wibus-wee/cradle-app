// Verifies the providers-only local scan route: it persists external provider
// source/record rows and runtime targets without creating agent records.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createServerApp } from '../src/app'
import { shutdownInfra } from '../src/infra'

const SCAN_ENV_KEYS = [
  'CRADLE_LOCAL_AGENT_CONFIG_CLAUDE_DIR',
  'CRADLE_LOCAL_AGENT_CONFIG_CLAUDE_SETTINGS_PATH',
  'CRADLE_LOCAL_AGENT_CONFIG_CLAUDE_LOCAL_SETTINGS_PATH',
  'CRADLE_LOCAL_AGENT_CONFIG_CODEX_DIR',
  'CRADLE_LOCAL_AGENT_CONFIG_CODEX_CONFIG_PATH',
  'CRADLE_LOCAL_AGENT_CONFIG_CODEX_AUTH_PATH',
  'CRADLE_LOCAL_AGENT_CONFIG_INCLUDE_PROCESS_ENV',
  'CRADLE_DATA_DIR',
  'CRADLE_CREDENTIAL_SECRET',
  'CRADLE_PLUGINS_DIR',
  'CRADLE_EXTERNAL_PLUGINS_DIRS',
  'PATH',
] as const

function snapshotEnv(): Record<string, string | undefined> {
  return Object.fromEntries(SCAN_ENV_KEYS.map(key => [key, process.env[key]]))
}

function restoreEnv(previous: Record<string, string | undefined>): void {
  for (const key of SCAN_ENV_KEYS) {
    if (previous[key] === undefined) {
      delete process.env[key]
    }
 else {
      process.env[key] = previous[key]
    }
  }
}

describe('external provider sources local scan route', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('persists scanned local providers as external records without creating agents', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'cradle-local-scan-data-'))
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'cradle-local-scan-home-'))
    const previous = snapshotEnv()

    const claudeDir = join(fixtureRoot, '.claude')
    const codexDir = join(fixtureRoot, '.codex')
    mkdirSync(claudeDir, { recursive: true })
    mkdirSync(codexDir, { recursive: true })
    const claudeSettingsPath = join(claudeDir, 'settings.json')
    writeFileSync(
      claudeSettingsPath,
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: 'https://anthropic.example.test',
          ANTHROPIC_AUTH_TOKEN: 'test-local-scan-secret',
          ANTHROPIC_MODEL: 'claude-sonnet-test',
        },
      }),
    )

    process.env.CRADLE_DATA_DIR = dataDir
    process.env.CRADLE_CREDENTIAL_SECRET = 'local-scan-test-secret'
    process.env.CRADLE_PLUGINS_DIR = join(dataDir, 'plugins')
    process.env.CRADLE_EXTERNAL_PLUGINS_DIRS = ''
    process.env.CRADLE_LOCAL_AGENT_CONFIG_CLAUDE_DIR = claudeDir
    process.env.CRADLE_LOCAL_AGENT_CONFIG_CLAUDE_SETTINGS_PATH = claudeSettingsPath
    process.env.CRADLE_LOCAL_AGENT_CONFIG_CLAUDE_LOCAL_SETTINGS_PATH = join(claudeDir, 'settings.local.json')
    process.env.CRADLE_LOCAL_AGENT_CONFIG_CODEX_DIR = codexDir
    process.env.CRADLE_LOCAL_AGENT_CONFIG_CODEX_CONFIG_PATH = join(codexDir, 'config.toml')
    process.env.CRADLE_LOCAL_AGENT_CONFIG_CODEX_AUTH_PATH = join(codexDir, 'auth.json')
    process.env.CRADLE_LOCAL_AGENT_CONFIG_INCLUDE_PROCESS_ENV = 'false'
    process.env.PATH = ''

    try {
      const app = await createServerApp({ startBackgroundTasks: false })

      const scan = await app.handle(
        new Request('http://localhost/external-provider-sources/local-scan', {
          method: 'POST',
        }),
      )
      expect(scan.status).toBe(200)
      const summary = (await scan.json()) as {
        sourceKey: string
        status: string
        recordsSeen: number
        recordsProjected: number
        recordsMissing: number
        message?: string
      }
      expect(summary).toEqual({
        sourceKey: expect.stringMatching(/^external_source_/),
        status: 'ok',
        recordsSeen: 1,
        recordsProjected: 1,
        recordsMissing: 0,
        message: 'Detected 1 local agent config record.',
      })

      const recordsRes = await app.handle(
        new Request('http://localhost/external-provider-sources/records'),
      )
      expect(recordsRes.status).toBe(200)
      const records = (await recordsRes.json()) as Array<{
        externalId: string
        app: string
        providerKind: string
        status: string
        sourceKey: string
        providerTargetId: string | null
      }>
      expect(records).toEqual([
        expect.objectContaining({
          externalId: 'claude:local-current',
          app: 'claude',
          providerKind: 'anthropic',
          status: 'active',
          sourceKey: summary.sourceKey,
          providerTargetId: expect.any(String),
        }),
      ])
      expect(JSON.stringify(records)).not.toContain('test-local-scan-secret')

      const targetRes = await app.handle(
        new Request(
          `http://localhost/external-provider-sources/${summary.sourceKey}/records/claude:local-current/runtime-target`,
        ),
      )
      expect(targetRes.status).toBe(200)
      expect(await targetRes.json()).toEqual(
        expect.objectContaining({
          providerKind: 'anthropic',
          displayName: 'Local Claude',
          enabled: true,
          credentialRef: expect.stringMatching(/^external_credential_/),
        }),
      )

      // Providers-only scan: no agent records are created.
      const agentsRes = await app.handle(new Request('http://localhost/agents'))
      expect(agentsRes.status).toBe(200)
      expect(await agentsRes.json()).toEqual([])

      // Repeat scan merges with existing rows instead of duplicating or dropping them.
      const rescan = await app.handle(
        new Request('http://localhost/external-provider-sources/local-scan', {
          method: 'POST',
        }),
      )
      expect(rescan.status).toBe(200)
      expect(await rescan.json()).toEqual(
        expect.objectContaining({
          sourceKey: summary.sourceKey,
          status: 'ok',
          recordsSeen: 1,
          recordsProjected: 1,
          recordsMissing: 0,
        }),
      )
    }
 finally {
      shutdownInfra()
      restoreEnv(previous)
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(fixtureRoot, { recursive: true, force: true })
    }
  })
})
