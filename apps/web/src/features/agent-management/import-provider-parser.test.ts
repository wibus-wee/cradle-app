import { describe, expect, it } from 'vitest'

import { parseProviderConfig } from './import-provider-parser'

function encodeBase64(text: string): string {
  return btoa(text)
}

describe('parseProviderConfig', () => {
  it('parses base64-encoded JSON provider snippets', () => {
    const result = parseProviderConfig(encodeBase64(JSON.stringify({
      apiKey: 'sk-test-json',
      baseUrl: 'https://gateway.example.test/v1',
    })))

    expect(result.token).toBe('sk-test-json')
    expect(result.urls).toEqual([
      { url: 'https://gateway.example.test/v1', kind: 'openai-compatible' },
    ])
    expect(result.providers).toEqual([
      {
        providerKind: 'openai-compatible',
        name: 'gateway.example.test',
        apiKey: 'sk-test-json',
        baseUrl: 'https://gateway.example.test/v1',
      },
    ])
  })

  it('parses base64-encoded export provider snippets', () => {
    const result = parseProviderConfig(encodeBase64([
      'export OPENAI_API_KEY=sk-test-export',
      'export OPENAI_BASE_URL=https://openai.example.test/v1',
    ].join('\n')))

    expect(result.token).toBe('sk-test-export')
    expect(result.providers).toEqual([
      {
        providerKind: 'openai-compatible',
        name: 'openai.example.test',
        apiKey: 'sk-test-export',
        baseUrl: 'https://openai.example.test/v1',
      },
    ])
  })

  it('parses base64-encoded labeled provider snippets without including labels in the token', () => {
    const result = parseProviderConfig('5Luk54mMc2stV1VsYld3dmdoeFpUWHVaS2k1NmlFcXJRVVk4MDU1VzRaa0N2c3VhQXNrbTNISHc55Zyw5Z2AaHR0cHM6Ly93d3cuc3VwZXJ0b2tlbi5sb2wvdjEvbWVzc2FnZXPmqKHlnovlkI1NaW5pTWF4LU0z')

    expect(result.token).toBe('sk-WUlbWwvghxZTXuZKi56iEqrQUY8055W4ZkCvsuaAskm3HHw9')
    expect(result.providers).toEqual([
      {
        providerKind: 'openai-compatible',
        name: 'www.supertoken.lol',
        apiKey: 'sk-WUlbWwvghxZTXuZKi56iEqrQUY8055W4ZkCvsuaAskm3HHw9',
        baseUrl: 'https://www.supertoken.lol/v1/messages',
      },
    ])
  })
})
