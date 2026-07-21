import { describe, expect, it } from 'vitest'

import { projectKimiProviderConfig } from './config'
import { createKimiWebHostFingerprint } from './host-fingerprint'

describe('kimi host fingerprint', () => {
  const providerConfig = projectKimiProviderConfig({
    id: 'target-a',
name: 'Target A',
enabled: true,
providerKind: 'openai-compatible',
    configJson: JSON.stringify({ baseUrl: 'https://example.test/v1', model: 'model-a' }),
    customModels: '[]',
iconSlug: null,
providerTargetKind: 'external',
providerTargetId: 'target-a',
  })

  it('changes for dynamic provider configuration and credentials', () => {
    const base = { command: 'kimi', providerTargetId: 'target-a', providerConfig, credential: 'token-one' }
    expect(createKimiWebHostFingerprint(base)).not.toBe(createKimiWebHostFingerprint({ ...base, credential: 'token-two' }))
    expect(createKimiWebHostFingerprint(base)).not.toBe(createKimiWebHostFingerprint({
      ...base,
      providerConfig: { ...providerConfig, baseUrl: 'https://other.test/v1' },
    }))
  })
})
