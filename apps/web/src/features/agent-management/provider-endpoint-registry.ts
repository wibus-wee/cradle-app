/**
 * Provider Endpoint Template Registry (frontend)
 *
 * Maps known provider API hostnames to pre-configured model lists.
 * Used to auto-populate custom models and show detection hints in the Import Dialog.
 *
 * Mirrors the server-side registry in
 * apps/server/src/modules/provider-catalog/provider-endpoint-registry.ts
 */

import type { ApiProviderKind } from '~/features/agent-runtime/types'

export interface ProviderEndpointTemplate {
  /** Stable identifier, e.g. 'deepseek' */
  id: string
  /** Human-readable display name */
  name: string
  /** API protocol kind */
  providerKind: ApiProviderKind
  /** Hostname patterns to match (exact or contains) */
  hostPatterns: string[]
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
]

function extractHostname(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).hostname.toLowerCase()
  }
  catch {
    return null
  }
}

/**
 * Match a baseUrl against known provider endpoint templates.
 * Returns the matching template or null.
 */
export function matchProviderEndpoint(baseUrl: string): ProviderEndpointTemplate | null {
  const hostname = extractHostname(baseUrl)
  if (!hostname) { return null }

  for (const template of PROVIDER_ENDPOINT_TEMPLATES) {
    for (const pattern of template.hostPatterns) {
      if (hostname === pattern || hostname.endsWith(`.${pattern}`)) {
        return template
      }
    }
  }

  return null
}
