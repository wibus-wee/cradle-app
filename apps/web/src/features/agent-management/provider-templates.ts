import type { ApiProviderKind } from '~/features/agent-runtime/types'

export interface ProviderPresetAuthMethod {
  id: string
  label: string
}

export interface ProviderPresetEndpointProfile {
  id: string
  label: string
  wireKind: ApiProviderKind
  defaultBaseUrl?: string
}

export interface ProviderPreset {
  id: string
  name: string
  tagline: string
  providerKind: ApiProviderKind
  accent: string
  fields: PresetField[]
  defaults: Record<string, unknown>
  /** Secondary paragraph on the preset card; falls back to tagline. */
  description?: string
  /** Server-provided icon hint; falls back to the preset id. */
  iconSlug?: string
  providerId: string
  tier: 'first-class' | 'generic'
  authMethods: ProviderPresetAuthMethod[]
  endpointProfiles: ProviderPresetEndpointProfile[]
  featured?: boolean
}

interface PresetField {
  key: string
  label: string
  type: 'text' | 'password' | 'url'
  placeholder?: string
  mono?: boolean
}

const OPENAI_AUTH: ProviderPresetAuthMethod[] = [
  { id: 'apikey', label: 'API Key' },
  { id: 'chatgptAuthTokens', label: 'ChatGPT' },
  { id: 'personalAccessToken', label: 'PAT' },
  { id: 'bedrockApiKey', label: 'Bedrock' },
]

const ANTHROPIC_AUTH: ProviderPresetAuthMethod[] = [
  { id: 'apiKey', label: 'API Key' },
  { id: 'claudeAi', label: 'Claude.ai' },
]

const API_KEY_ONLY: ProviderPresetAuthMethod[] = [
  { id: 'apiKey', label: 'API Key' },
]

/** Local featured fallbacks while `/provider-presets` loads. */
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
    providerId: 'anthropic',
    tier: 'first-class',
    authMethods: ANTHROPIC_AUTH,
    endpointProfiles: [
      { id: 'anthropic', label: 'Endpoint', wireKind: 'anthropic', defaultBaseUrl: 'https://api.anthropic.com/v1' },
    ],
    featured: true,
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
    providerId: 'openai',
    tier: 'first-class',
    authMethods: OPENAI_AUTH,
    endpointProfiles: [
      { id: 'openai', label: 'Endpoint', wireKind: 'openai-compatible', defaultBaseUrl: 'https://api.openai.com/v1' },
    ],
    featured: true,
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
    providerId: 'universal',
    tier: 'first-class',
    authMethods: API_KEY_ONLY,
    endpointProfiles: [
      { id: 'openai', label: 'OpenAI-compatible endpoint', wireKind: 'openai-compatible', defaultBaseUrl: '' },
      { id: 'anthropic', label: 'Anthropic-compatible endpoint', wireKind: 'anthropic', defaultBaseUrl: '' },
    ],
    featured: true,
  },
]

/** Auth methods for unbound profiles (no providerId). */
export function unboundAuthMethods(): ProviderPresetAuthMethod[] {
  return API_KEY_ONLY
}
