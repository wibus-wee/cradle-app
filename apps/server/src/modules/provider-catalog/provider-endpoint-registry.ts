/**
 * Provider Endpoint Template Registry
 *
 * Maps known provider API hostnames to pre-configured model lists.
 * Used to auto-populate custom models for providers that don't expose /v1/models,
 * or to give users a head start when importing a known provider.
 *
 * Templates derive from the preset overlay (single source of truth); only
 * overlay entries carrying defaultModels become endpoint templates.
 */

import type { ProviderKind } from '../provider-contracts/types'
import type { ProviderPresetOverlayEntry } from './provider-preset-overlay'
import { PROVIDER_PRESET_OVERLAY } from './provider-preset-overlay'

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

/**
 * Legacy display labels retained for bootstrapCustomModelsJson compatibility.
 * The overlay stores canonical model ids; labels stay here because they only
 * matter to this template projection.
 */
const ENDPOINT_MODEL_LABELS: Record<string, string> = {
  'deepseek-v4-flash': 'DeepSeek V4 Flash',
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  'deepseek-chat': 'DeepSeek Chat (Legacy)',
  'deepseek-reasoner': 'DeepSeek Reasoner (Legacy)',
  'mimo-v2.5-pro': 'MiMo V2.5 Pro',
  'mimo-v2.5': 'MiMo V2.5',
  'glm-5.2': 'GLM 5.2',
}

/**
 * Derive required path prefixes from the overlay base URL. A bare '/v1' suffix
 * stays optional so endpoints configured without it (e.g. 'https://api.deepseek.com')
 * keep matching; anything more specific (e.g. '/api/coding') must match.
 */
function pathPrefixesFromBaseUrl(baseUrl: string): string[] | undefined {
  try {
    const pathname = new URL(baseUrl).pathname.replace(/\/+$/, '')
    if (pathname === '' || pathname === '/v1') {
      return undefined
    }
    return [pathname]
  }
  catch {
    return undefined
  }
}

function toAnthropicWireAuth(
  wireAuth: ProviderPresetOverlayEntry['anthropicWireAuth'],
): AnthropicWireAuth | undefined {
  if (!wireAuth) {
    return undefined
  }
  return wireAuth === 'bearer-token' ? 'bearer-token' : 'api-key'
}

function toEndpointTemplate(entry: ProviderPresetOverlayEntry): ProviderEndpointTemplate {
  const pathPrefixes = pathPrefixesFromBaseUrl(entry.baseUrl)
  const anthropicWireAuth = toAnthropicWireAuth(entry.anthropicWireAuth)
  return {
    id: entry.id,
    name: entry.name,
    providerKind: entry.providerKind,
    hostPatterns: entry.hostnames,
    ...(pathPrefixes ? { pathPrefixes } : {}),
    ...(anthropicWireAuth ? { anthropicWireAuth } : {}),
    models: (entry.defaultModels ?? []).map(id => ({ id, label: ENDPOINT_MODEL_LABELS[id] ?? id })),
  }
}

export const PROVIDER_ENDPOINT_TEMPLATES: ProviderEndpointTemplate[] = PROVIDER_PRESET_OVERLAY
  .filter(entry => (entry.defaultModels?.length ?? 0) > 0)
  .map(toEndpointTemplate)

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
