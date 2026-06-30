import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { createServerApp } from '../src/app'
import { shutdownInfra } from '../src/infra'

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function repoPluginsDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../plugins')
}

function writeCcSwitchDatabase(path: string): void {
  const db = new Database(path)
  try {
    db.exec(`
      CREATE TABLE providers (
        id TEXT NOT NULL,
        app_type TEXT NOT NULL,
        name TEXT NOT NULL,
        settings_config TEXT NOT NULL,
        meta TEXT NOT NULL DEFAULT '{}',
        is_current BOOLEAN NOT NULL DEFAULT 0,
        PRIMARY KEY (id, app_type)
      );

      CREATE TABLE provider_endpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_id TEXT NOT NULL,
        app_type TEXT NOT NULL,
        url TEXT NOT NULL,
        added_at INTEGER
      );
    `)
    db.prepare(`
      INSERT INTO providers (id, app_type, name, settings_config, meta, is_current)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'claude-fixture',
      'claude',
      'Claude Fixture',
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: 'https://cc-switch-claude.example.test',
          ANTHROPIC_AUTH_TOKEN: 'cc-switch-secret',
          ANTHROPIC_MODEL: 'claude-fixture-model',
        },
      }),
      JSON.stringify({ apiFormat: 'anthropic' }),
      1,
    )
    db.prepare(`
      INSERT INTO providers (id, app_type, name, settings_config, meta, is_current)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'claude-routed-openai',
      'claude',
      'Claude Routed OpenAI',
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: 'https://cc-switch-routed.example.test',
          ANTHROPIC_AUTH_TOKEN: 'cc-switch-routed-secret',
          ANTHROPIC_MODEL: 'gpt-routed',
        },
      }),
      JSON.stringify({ apiFormat: 'openai_responses' }),
      0,
    )
  }
  finally {
    db.close()
  }
}

function restoreEnv(previous: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) {
      delete process.env[key]
    }
    else {
      process.env[key] = value
    }
  }
}

describe('cc switch external provider plugin', () => {
  it('is discovered as a plugin source and stores CC Switch providers as external runtime targets', async () => {
    const dataDir = tempDir('cradle-cc-switch-plugin-host-')
    const ccSwitchDir = join(dataDir, 'cc-switch')
    const dbPath = join(ccSwitchDir, 'cc-switch.db')
    const settingsPath = join(ccSwitchDir, 'settings.json')
    const previous = {
      CRADLE_DATA_DIR: process.env.CRADLE_DATA_DIR,
      CRADLE_CREDENTIAL_SECRET: process.env.CRADLE_CREDENTIAL_SECRET,
      CRADLE_PLUGINS_DIR: process.env.CRADLE_PLUGINS_DIR,
      CRADLE_EXTERNAL_PLUGINS_DIRS: process.env.CRADLE_EXTERNAL_PLUGINS_DIRS,
      CRADLE_PLUGIN_ALLOWED_CC_SWITCH_PERMISSIONS: process.env.CRADLE_PLUGIN_ALLOWED_CC_SWITCH_PERMISSIONS,
      CRADLE_CC_SWITCH_DB_PATH: process.env.CRADLE_CC_SWITCH_DB_PATH,
      CRADLE_CC_SWITCH_SETTINGS_PATH: process.env.CRADLE_CC_SWITCH_SETTINGS_PATH,
    }

    try {
      process.env.CRADLE_DATA_DIR = dataDir
      process.env.CRADLE_CREDENTIAL_SECRET = 'cc-switch-plugin-host-secret'
      process.env.CRADLE_PLUGINS_DIR = repoPluginsDir()
      process.env.CRADLE_EXTERNAL_PLUGINS_DIRS = ''
      process.env.CRADLE_PLUGIN_ALLOWED_CC_SWITCH_PERMISSIONS = 'filesystem.cc-switch.read'
      process.env.CRADLE_CC_SWITCH_DB_PATH = dbPath
      process.env.CRADLE_CC_SWITCH_SETTINGS_PATH = settingsPath

      mkdirSync(ccSwitchDir, { recursive: true })
      writeFileSync(settingsPath, JSON.stringify({ currentProviderClaude: 'claude-fixture' }), { flag: 'w' })
      writeCcSwitchDatabase(dbPath)

      const app = await createServerApp({ startBackgroundTasks: false })
      const sourcesRes = await app.handle(new Request('http://localhost/external-provider-sources'))
      expect(sourcesRes.status).toBe(200)
      const sources = await sourcesRes.json() as Array<{ id: string, label: string }>
      const ccSwitchSource = sources.find(source => source.label === 'CC Switch')
      expect(ccSwitchSource).toBeTruthy()

      const refresh = await app.handle(new Request(`http://localhost/external-provider-sources/${ccSwitchSource!.id}/refresh`, { method: 'POST' }))
      expect(refresh.status).toBe(200)
      expect(await refresh.json()).toEqual(expect.objectContaining({
        status: 'warning',
        recordsSeen: 1,
        recordsProjected: 1,
      }))

      const profilesRes = await app.handle(new Request('http://localhost/profiles'))
      expect(profilesRes.status).toBe(200)
      const profiles = await profilesRes.json() as Array<unknown>
      expect(profiles).toEqual([])

      const recordsRes = await app.handle(new Request('http://localhost/external-provider-sources/records'))
      expect(recordsRes.status).toBe(200)
      const records = await recordsRes.json() as Array<{ externalId: string, name: string }>
      expect(JSON.stringify(records)).not.toContain('cc-switch-secret')
      expect(JSON.stringify(records)).not.toContain('cc-switch-routed-secret')
      expect(records.some(record => record.externalId === 'cc-switch:claude:claude-routed-openai')).toBe(false)
      expect(records).toEqual([
        expect.objectContaining({
          externalId: 'cc-switch:claude:claude-fixture',
          name: 'Claude Fixture',
        }),
      ])

      const targetRes = await app.handle(new Request(`http://localhost/external-provider-sources/${ccSwitchSource!.id}/records/cc-switch:claude:claude-fixture/runtime-target`))
      expect(targetRes.status).toBe(200)
      expect(await targetRes.json()).toEqual(expect.objectContaining({
        sourceKey: ccSwitchSource!.id,
        externalRecordId: 'cc-switch:claude:claude-fixture',
        displayName: 'Claude Fixture',
        credentialRef: expect.stringMatching(/^external_credential_/),
      }))
    }
    finally {
      shutdownInfra()
      restoreEnv(previous)
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
