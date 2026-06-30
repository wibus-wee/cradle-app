import type { ApiProviderKind } from '~/features/agent-runtime/types'

export interface ProviderPreset {
  id: string
  name: string
  tagline: string
  providerKind: ApiProviderKind
  accent: string
  fields: PresetField[]
  defaults: Record<string, unknown>
}

interface PresetField {
  key: string
  label: string
  type: 'text' | 'password' | 'url'
  placeholder?: string
  mono?: boolean
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    tagline: 'Official Claude API or Anthropic message API',
    providerKind: 'anthropic',
    accent: 'orange',
    fields: [
      { key: 'baseUrl', label: 'Endpoint', type: 'url', placeholder: 'https://api.anthropic.com/v1', mono: true },
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-ant-...', mono: true },
    ],
    defaults: { baseUrl: 'https://api.anthropic.com/v1' },
  },
  {
    id: 'openai',
    name: 'OpenAI',
    tagline: 'OpenAI Responses API or Official Codex account',
    providerKind: 'openai-compatible',
    accent: 'emerald',
    fields: [
      { key: 'baseUrl', label: 'Endpoint', type: 'url', placeholder: 'https://api.openai.com/v1', mono: true },
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-...', mono: true },
    ],
    defaults: { baseUrl: 'https://api.openai.com/v1' },
  },
  {
    id: 'universal',
    name: 'Universal',
    tagline: 'Custom endpoint with OpenAI and Anthropic supported',
    providerKind: 'universal',
    accent: 'violet',
    fields: [
      { key: 'baseUrl', label: 'Endpoint', type: 'url', placeholder: 'https://api.example.com/v1', mono: true },
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-...', mono: true },
    ],
    defaults: { baseUrl: '' },
  },
]
