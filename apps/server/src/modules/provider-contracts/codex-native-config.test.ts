import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import protocolManifest from '../chat-runtime-providers/codex/app-server-protocol/MANIFEST.json'
import schema from './codex-config-schema/config.schema.json'
import manifest from './codex-config-schema/MANIFEST.json'
import { CODEX_MANAGED_CONFIG_KEYS, parseCodexNativeConfig } from './codex-native-config'

describe('codex native configuration', () => {
  it('pins the schema and its digest to the vendored protocol release', () => {
    expect(protocolManifest.generatorVersion).toBe(`codex-cli ${manifest.version}`)
    expect(manifest.sha256).toBe(
      createHash('sha256')
        .update(`${JSON.stringify(schema, null, 2)}\n`)
        .digest('hex'),
    )
    expect(manifest.source).toContain(`/${manifest.releaseTag}/`)
  })

  it('preserves explicit false and leaves absent defaults unset', () => {
    expect(
      parseCodexNativeConfig({ features: { multi_agent: false }, web_search: 'indexed' }),
    ).toEqual({ features: { multi_agent: false }, web_search: 'indexed' })
    expect(parseCodexNativeConfig({})).toEqual({})
  })

  it('rejects unknown fields, invalid values and nested nulls', () => {
    for (const value of [
      { invented: true },
      { web_search: 'sometimes' },
      { features: { invented: true } },
      { features: { multi_agent: 'false' } },
      { service_tier: null },
    ]) {
      expect(() => parseCodexNativeConfig(value)).toThrow()
    }
  })

  it.each(CODEX_MANAGED_CONFIG_KEYS)('rejects managed field %s', (key) => {
    expect(() => parseCodexNativeConfig({ [key]: {} })).toThrow()
  })
})
