/**
 * Provider setup contribution registry (lives in provider-catalog domain).
 *
 * First-class contributions own auth method lists and endpoint profiles.
 * Gallery long-tail rows use the generic template (apiKey only).
 */

import type {
  ProviderAuthMethodDeclaration,
  ProviderEndpointProfile,
  ProviderId,
  ProviderSetupContribution,
} from '../provider-contracts/provider-setup-contribution'
import type { ProviderKind } from '../provider-contracts/types'

const API_KEY: ProviderAuthMethodDeclaration = {
  id: 'apiKey',
  label: 'API Key',
  fields: ['apiKey'],
}

const OPENAI_AUTH: ProviderAuthMethodDeclaration[] = [
  { id: 'apikey', label: 'API Key', fields: ['apiKey', 'baseUrl'] },
  { id: 'chatgptAuthTokens', label: 'ChatGPT', fields: [], loginDriverId: 'codex-chatgpt' },
  { id: 'personalAccessToken', label: 'PAT', fields: ['apiKey'] },
  { id: 'bedrockApiKey', label: 'Bedrock', fields: ['apiKey', 'bedrockRegion'] },
]

const ANTHROPIC_AUTH: ProviderAuthMethodDeclaration[] = [
  { id: 'apiKey', label: 'API Key', fields: ['apiKey', 'baseUrl'] },
  { id: 'claudeAi', label: 'Claude.ai', fields: [] },
]

function singleEndpoint(
  wireKind: ProviderKind,
  defaultBaseUrl?: string,
): ProviderEndpointProfile[] {
  return [{
    id: wireKind === 'anthropic' ? 'anthropic' : 'openai',
    label: wireKind === 'anthropic' ? 'Anthropic endpoint' : 'Endpoint',
    wireKind,
    ...(defaultBaseUrl !== undefined ? { defaultBaseUrl } : {}),
  }]
}

function dualEndpoints(
  openaiBaseUrl: string,
  anthropicBaseUrl: string,
): ProviderEndpointProfile[] {
  return [
    { id: 'openai', label: 'OpenAI-compatible endpoint', wireKind: 'openai-compatible', defaultBaseUrl: openaiBaseUrl },
    { id: 'anthropic', label: 'Anthropic-compatible endpoint', wireKind: 'anthropic', defaultBaseUrl: anthropicBaseUrl },
  ]
}

function contribution(input: ProviderSetupContribution): ProviderSetupContribution {
  return input
}

const FIRST_CLASS: ProviderSetupContribution[] = [
  contribution({
    identity: {
      id: 'openai',
      name: 'OpenAI',
      tagline: 'OpenAI Responses API or Official Codex account',
      iconSlug: 'openai',
      featured: true,
      tier: 'first-class',
    },
    endpointProfiles: singleEndpoint('openai-compatible', 'https://api.openai.com/v1'),
    authMethods: OPENAI_AUTH,
    defaultAuthMethodId: 'apikey',
    defaultWireKind: 'openai-compatible',
    requiresApiKey: true,
  }),
  contribution({
    identity: {
      id: 'anthropic',
      name: 'Anthropic',
      tagline: 'Official Claude API or Anthropic message API',
      iconSlug: 'anthropic',
      featured: true,
      tier: 'first-class',
    },
    endpointProfiles: singleEndpoint('anthropic', 'https://api.anthropic.com/v1'),
    authMethods: ANTHROPIC_AUTH,
    defaultAuthMethodId: 'apiKey',
    defaultWireKind: 'anthropic',
    requiresApiKey: true,
  }),
  contribution({
    identity: {
      id: 'universal',
      name: 'Universal',
      tagline: 'Custom endpoint with OpenAI and Anthropic supported',
      featured: true,
      tier: 'first-class',
    },
    endpointProfiles: [
      { id: 'openai', label: 'OpenAI-compatible endpoint', wireKind: 'openai-compatible', defaultBaseUrl: '' },
      { id: 'anthropic', label: 'Anthropic-compatible endpoint', wireKind: 'anthropic', defaultBaseUrl: '' },
    ],
    authMethods: [{ id: 'apiKey', label: 'API Key', fields: ['apiKey', 'openaiBaseUrl', 'anthropicBaseUrl'] }],
    defaultAuthMethodId: 'apiKey',
    defaultWireKind: 'universal',
    requiresApiKey: true,
  }),
  // Dual-endpoint curated vendors (API Key only — no OAuth).
  contribution({
    identity: {
      id: 'deepseek',
      name: 'DeepSeek',
      tagline: 'https://api.deepseek.com/v1',
      iconSlug: 'deepseek',
      docsUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
      tier: 'first-class',
    },
    endpointProfiles: dualEndpoints(
      'https://api.deepseek.com/v1',
      'https://api.deepseek.com/anthropic',
    ),
    authMethods: [{ id: 'apiKey', label: 'API Key', fields: ['apiKey', 'openaiBaseUrl', 'anthropicBaseUrl'] }],
    defaultAuthMethodId: 'apiKey',
    defaultWireKind: 'universal',
    requiresApiKey: true,
  }),
  contribution({
    identity: {
      id: 'moonshot',
      name: 'Moonshot (Kimi)',
      tagline: 'https://api.moonshot.cn/v1',
      iconSlug: 'moonshot',
      docsUrl: 'https://platform.moonshot.cn/docs/api/chat',
      tier: 'first-class',
    },
    // CN openai host family; Anthropic path uses the same host (vendor dual-protocol).
    endpointProfiles: dualEndpoints(
      'https://api.moonshot.cn/v1',
      'https://api.moonshot.cn/anthropic',
    ),
    authMethods: [{ id: 'apiKey', label: 'API Key', fields: ['apiKey', 'openaiBaseUrl', 'anthropicBaseUrl'] }],
    defaultAuthMethodId: 'apiKey',
    defaultWireKind: 'universal',
    requiresApiKey: true,
  }),
]

function singleProfileFirstClass(input: {
  id: ProviderId
  name: string
  wireKind: ProviderKind
  baseUrl: string
  iconSlug?: string
  docsUrl?: string
  local?: boolean
  requiresApiKey?: boolean
}): ProviderSetupContribution {
  return contribution({
    identity: {
      id: input.id,
      name: input.name,
      tagline: input.local ? 'Runs on your machine' : input.baseUrl,
      ...(input.iconSlug ? { iconSlug: input.iconSlug } : {}),
      ...(input.docsUrl ? { docsUrl: input.docsUrl } : {}),
      ...(input.local ? { local: true } : {}),
      tier: 'first-class',
    },
    endpointProfiles: singleEndpoint(input.wireKind, input.baseUrl),
    authMethods: input.requiresApiKey === false
      ? [{ id: 'apiKey', label: 'API Key', fields: ['apiKey', 'baseUrl'] }]
      : [{ ...API_KEY, fields: ['apiKey', 'baseUrl'] }],
    defaultAuthMethodId: 'apiKey',
    defaultWireKind: input.wireKind,
    requiresApiKey: input.requiresApiKey ?? true,
  })
}

const OVERLAY_SINGLE: ProviderSetupContribution[] = [
  singleProfileFirstClass({
    id: 'xiaomi-mimo',
    name: 'Xiaomi MiMo',
    wireKind: 'openai-compatible',
    baseUrl: 'https://api.xiaomimimo.com/v1',
    iconSlug: 'xiaomimimo',
    docsUrl: 'https://platform.xiaomimimo.com/#/docs',
  }),
  singleProfileFirstClass({
    id: 'volcengine-ark-coding',
    name: 'Volcengine Ark Coding',
    wireKind: 'anthropic',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
    iconSlug: 'volcengine',
  }),
  singleProfileFirstClass({
    id: 'zhipu',
    name: 'Zhipu GLM',
    wireKind: 'openai-compatible',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    iconSlug: 'zhipu',
    docsUrl: 'https://docs.bigmodel.cn/cn/guide/start/introduction',
  }),
  singleProfileFirstClass({
    id: 'openrouter',
    name: 'OpenRouter',
    wireKind: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    iconSlug: 'openrouter',
    docsUrl: 'https://openrouter.ai/models',
  }),
  singleProfileFirstClass({
    id: 'siliconflow',
    name: 'SiliconFlow',
    wireKind: 'openai-compatible',
    baseUrl: 'https://api.siliconflow.cn/v1',
    iconSlug: 'siliconcloud',
    docsUrl: 'https://cloud.siliconflow.com/models',
  }),
  singleProfileFirstClass({
    id: 'groq',
    name: 'Groq',
    wireKind: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    iconSlug: 'groq',
    docsUrl: 'https://console.groq.com/docs/models',
  }),
  singleProfileFirstClass({
    id: 'ollama',
    name: 'Ollama',
    wireKind: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    iconSlug: 'ollama',
    docsUrl: 'https://ollama.com',
    local: true,
    requiresApiKey: false,
  }),
  singleProfileFirstClass({
    id: 'lmstudio',
    name: 'LM Studio',
    wireKind: 'openai-compatible',
    baseUrl: 'http://localhost:1234/v1',
    iconSlug: 'lmstudio',
    docsUrl: 'https://lmstudio.ai/models',
    local: true,
    requiresApiKey: false,
  }),
]

const byId = new Map<ProviderId, ProviderSetupContribution>()

function register(entry: ProviderSetupContribution): void {
  byId.set(entry.identity.id, entry)
}

for (const entry of [...FIRST_CLASS, ...OVERLAY_SINGLE]) {
  register(entry)
}

/** Generic template for models.dev long-tail gallery rows. */
export function buildGenericContribution(input: {
  id: ProviderId
  name: string
  baseUrl: string
  wireKind: ProviderKind
  iconSlug?: string
  docsUrl?: string
  local?: boolean
}): ProviderSetupContribution {
  return contribution({
    identity: {
      id: input.id,
      name: input.name,
      tagline: input.local ? 'Runs on your machine' : input.baseUrl,
      ...(input.iconSlug ? { iconSlug: input.iconSlug } : {}),
      ...(input.docsUrl ? { docsUrl: input.docsUrl } : {}),
      ...(input.local ? { local: true } : {}),
      tier: 'generic',
    },
    endpointProfiles: singleEndpoint(input.wireKind, input.baseUrl),
    authMethods: [{ id: 'apiKey', label: 'API Key', fields: ['apiKey', 'baseUrl'] }],
    defaultAuthMethodId: 'apiKey',
    defaultWireKind: input.wireKind,
    requiresApiKey: true,
  })
}

export function getProviderContribution(id: ProviderId): ProviderSetupContribution | null {
  return byId.get(id) ?? null
}

export function listFirstClassContributions(): ProviderSetupContribution[] {
  return [...byId.values()].toSorted((a, b) => {
    const af = a.identity.featured ? 0 : 1
    const bf = b.identity.featured ? 0 : 1
    if (af !== bf) {
      return af - bf
    }
    return a.identity.name.localeCompare(b.identity.name)
  })
}

export function listProviderContributionIds(): ProviderId[] {
  return [...byId.keys()].toSorted()
}

export function unboundAuthMethods(): ProviderAuthMethodDeclaration[] {
  return [{ id: 'apiKey', label: 'API Key', fields: ['apiKey', 'baseUrl', 'openaiBaseUrl', 'anthropicBaseUrl'] }]
}
