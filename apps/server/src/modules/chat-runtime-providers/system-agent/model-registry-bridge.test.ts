import { describe, expect, it } from 'vitest'

import {
  resolveSystemAgentConnection,
} from './model-registry-bridge'

describe('resolveSystemAgentConnection', () => {
  it('projects the OpenAI endpoint from a Universal provider target', () => {
    expect(resolveSystemAgentConnection({
      config: { baseUrl: null, provider: null },
      profileProviderKind: 'universal',
      rawConfigJson: JSON.stringify({
        openaiBaseUrl: 'http://127.0.0.1:1234/v1',
        anthropicBaseUrl: 'http://127.0.0.1:1234',
      }),
    })).toEqual({
      api: 'openai-completions',
      baseUrl: 'http://127.0.0.1:1234/v1',
      provider: 'openai',
    })
  })

  it('uses the endpoint for an explicitly selected provider', () => {
    expect(resolveSystemAgentConnection({
      config: { baseUrl: null, provider: 'anthropic' },
      profileProviderKind: 'universal',
      rawConfigJson: JSON.stringify({
        openaiBaseUrl: 'https://openai.example.test/v1',
        anthropicBaseUrl: 'https://anthropic.example.test/v1',
      }),
    })).toEqual({
      api: 'anthropic-messages',
      baseUrl: 'https://anthropic.example.test/v1',
      provider: 'anthropic',
    })
  })

  it('keeps an explicit baseUrl ahead of Universal endpoint fields', () => {
    expect(resolveSystemAgentConnection({
      config: { baseUrl: 'https://explicit.example.test/v1', provider: null },
      profileProviderKind: 'universal',
      rawConfigJson: JSON.stringify({
        openaiBaseUrl: 'https://openai.example.test/v1',
      }),
    }).baseUrl).toBe('https://explicit.example.test/v1')
  })
})
