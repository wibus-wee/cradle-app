import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildGenericContribution,
  getProviderContribution,
  listFirstClassContributions,
  unboundAuthMethods,
} from './provider-registry'

describe('provider-registry', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('registers openai with Codex auth methods and deepseek as dual-endpoint apiKey-only', () => {
    const openai = getProviderContribution('openai')
    expect(openai).toBeDefined()
    expect(openai?.authMethods.map(m => m.id)).toEqual([
      'apikey',
      'chatgptAuthTokens',
      'personalAccessToken',
      'bedrockApiKey',
    ])

    const deepseek = getProviderContribution('deepseek')
    expect(deepseek?.defaultWireKind).toBe('universal')
    expect(deepseek?.endpointProfiles).toHaveLength(2)
    expect(deepseek?.authMethods.map(m => m.id)).toEqual(['apiKey'])
    expect(deepseek?.authMethods.some(m => m.loginDriverId)).toBe(false)

    const moonshot = getProviderContribution('moonshot')
    expect(moonshot?.authMethods.map(m => m.id)).toEqual(['apiKey'])
    expect(moonshot?.endpointProfiles.map(p => p.defaultBaseUrl)).toEqual([
      'https://api.moonshot.cn/v1',
      'https://api.moonshot.cn/anthropic',
    ])
  })

  it('lists featured first-class contributions ahead of peers', () => {
    const list = listFirstClassContributions()
    expect(list.slice(0, 3).map(c => c.identity.id).sort()).toEqual([
      'anthropic',
      'openai',
      'universal',
    ].sort())
    expect(list.every(c => c.identity.tier === 'first-class')).toBe(true)
  })

  it('builds generic long-tail contributions as apiKey-only', () => {
    const generic = buildGenericContribution({
      id: 'acme-ai',
      name: 'Acme AI',
      baseUrl: 'https://api.acme.test/v1',
      wireKind: 'openai-compatible',
    })
    expect(generic.identity.tier).toBe('generic')
    expect(generic.authMethods).toEqual([
      { id: 'apiKey', label: 'API Key', fields: ['apiKey', 'baseUrl'] },
    ])
  })

  it('exposes unbound auth as apiKey-only', () => {
    expect(unboundAuthMethods().map(m => m.id)).toEqual(['apiKey'])
  })

  it('does not export a resolveProvider identity writer', async () => {
    const mod = await import('./provider-registry')
    expect('resolveProvider' in mod).toBe(false)
  })
})
