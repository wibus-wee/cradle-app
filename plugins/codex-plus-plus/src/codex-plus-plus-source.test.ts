/* 使用伪造本地配置验证 Codex++ relay profile 读取。 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { readCodexPlusPlusExternalProviderSnapshot } from './codex-plus-plus-source'

const tempDirs: string[] = []

function createTempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cradle-codex-plus-plus-plugin-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('codex++ external provider source', () => {
  it('maps relay profiles and model lists from local settings', async () => {
    const dir = createTempWorkspace()
    const settingsPath = join(dir, 'settings.json')
    writeFileSync(settingsPath, JSON.stringify({
      activeRelayId: 'relay-direct',
      relayTestModel: 'gpt-active-fallback',
      relayProfiles: [
        {
          id: 'relay-direct',
          name: 'Direct Relay',
          upstreamBaseUrl: 'https://direct.example.test/v1',
          protocol: 'responses',
          relayMode: 'pureApi',
          configContents: [
            'model_provider = "custom"',
            'model = "gpt-direct"',
            'model_reasoning_effort = "medium"',
            '',
            '[model_providers.custom]',
            'base_url = "http://127.0.0.1:57321/v1"',
            'wire_api = "responses"',
          ].join('\n'),
          authContents: JSON.stringify({ OPENAI_API_KEY: 'codex-plus-plus-key' }),
          modelList: 'gpt-direct\ngpt-direct-mini\n',
        },
        {
          id: 'relay-official',
          name: 'Official Relay',
          protocol: 'responses',
          relayMode: 'official',
          authContents: JSON.stringify({
            auth_mode: 'chatgpt',
            tokens: {
              access_token: 'fixture-access-token',
              refresh_token: 'fixture-refresh-token',
              account_id: 'fixture-chatgpt-account',
            },
          }),
        },
      ],
    }))

    const snapshot = await readCodexPlusPlusExternalProviderSnapshot({
      signal: new AbortController().signal,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
      sharedConfig: new Map([
        ['CODEX_PLUS_PLUS_SETTINGS_PATH', settingsPath],
      ]),
    })

    expect(snapshot.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        externalId: 'codex-plus-plus:relay:relay-direct',
        app: 'codex-plus-plus',
        providerKind: 'openai-compatible',
        current: true,
        config: expect.objectContaining({
          baseUrl: 'https://direct.example.test/v1',
          model: 'gpt-direct',
          reasoningEffort: 'medium',
          apiMode: 'responses',
        }),
        credential: expect.objectContaining({
          kind: 'api-key',
          value: 'codex-plus-plus-key',
        }),
        metadata: expect.objectContaining({
          models: [
            { id: 'gpt-direct', label: 'gpt-direct' },
            { id: 'gpt-direct-mini', label: 'gpt-direct-mini' },
          ],
          apiFormat: 'openai_responses',
          iconSlug: 'codex',
        }),
      }),
      expect.objectContaining({
        externalId: 'codex-plus-plus:relay:relay-official',
        credential: expect.objectContaining({
          kind: 'chatgpt-auth',
          label: 'Official Relay',
        }),
        metadata: expect.objectContaining({
          authMode: 'chatgpt',
          credentialKind: 'chatgpt-auth',
        }),
      }),
    ]))
    expect(JSON.stringify(snapshot.providers)).not.toContain('http://127.0.0.1:57321')
  })
})
