/**
 * Provider Endpoint Template Registry
 *
 * Maps known provider API hostnames to pre-configured model lists.
 * Used to auto-populate custom models for providers that don't expose /v1/models,
 * or to give users a head start when importing a known provider.
 */

import type { ProviderKind } from '../provider-contracts/types'

export type AnthropicWireAuth = 'api-key' | 'bearer-token'

export interface ProviderEndpointTemplate {
  /** Stable identifier, e.g. 'deepseek' */
  id: string
  /** Human-readable display name */
  name: string
  /** API protocol kind */
  providerKind: ProviderKind
  /** Hostname patterns to match (exact or contains) */
  hostPatterns: string[]
  /** Optional URL path prefixes that must match after hostname matching */
  pathPrefixes?: string[]
  /** Endpoint-owned Anthropic wire auth behavior. This is runtime projection, not persisted config. */
  anthropicWireAuth?: AnthropicWireAuth
  /** Known models for this provider */
  models: Array<{ id: string, label: string }>
}

export const PROVIDER_ENDPOINT_TEMPLATES: ProviderEndpointTemplate[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    providerKind: 'openai-compatible',
    hostPatterns: ['api.deepseek.com'],
    models: [
      { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
      { id: 'deepseek-chat', label: 'DeepSeek Chat (Legacy)' },
      { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner (Legacy)' },
    ],
  },
  {
    id: 'xiaomi-mimo',
    name: 'Xiaomi MiMo',
    providerKind: 'openai-compatible',
    hostPatterns: ['xiaomimimo.com'],
    models: [
      { id: 'mimo-v2.5-pro', label: 'MiMo V2.5 Pro' },
      { id: 'mimo-v2.5', label: 'MiMo V2.5' },
    ],
  },
  {
    id: 'volcengine-ark-coding',
    name: 'Volcengine Ark Coding',
    providerKind: 'anthropic',
    hostPatterns: ['ark.cn-beijing.volces.com'],
    pathPrefixes: ['/api/coding'],
    anthropicWireAuth: 'bearer-token',
    models: [
      { id: 'glm-5.2', label: 'GLM 5.2' },
    ],
  },
]

function parseBaseUrl(baseUrl: string): URL | null {
  try {
    return new URL(baseUrl)
  }
  catch {
    return null
  }
}

function hostMatches(hostname: string, patterns: string[]): boolean {
  return patterns.some(pattern => hostname === pattern || hostname.endsWith(`.${pattern}`))
}

function pathMatches(pathname: string, prefixes: string[] | undefined): boolean {
  if (!prefixes || prefixes.length === 0) {
    return true
  }
  const normalizedPath = pathname.replace(/\/+$/, '') || '/'
  return prefixes.some((prefix) => {
    const normalizedPrefix = prefix.replace(/\/+$/, '') || '/'
    return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`)
  })
}

/**
 * Match a baseUrl against known provider endpoint templates.
 * Returns the matching template or null.
 */
export function matchProviderEndpoint(
  baseUrl: string,
  providerKind?: ProviderKind,
): ProviderEndpointTemplate | null {
  const url = parseBaseUrl(baseUrl)
  if (!url) { return null }
  const hostname = url.hostname.toLowerCase()

  for (const template of PROVIDER_ENDPOINT_TEMPLATES) {
    if (providerKind && template.providerKind !== providerKind) {
      continue
    }
    if (hostMatches(hostname, template.hostPatterns) && pathMatches(url.pathname, template.pathPrefixes)) {
      return template
    }
  }

  return null
}

export function resolveAnthropicWireAuth(baseUrl: string | null | undefined): AnthropicWireAuth {
  const normalizedBaseUrl = baseUrl?.trim()
  const template = normalizedBaseUrl
    ? matchProviderEndpoint(normalizedBaseUrl, 'anthropic')
    : null
  return template?.anthropicWireAuth ?? 'api-key'
}
