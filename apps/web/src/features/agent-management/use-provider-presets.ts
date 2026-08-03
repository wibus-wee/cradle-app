import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { getProviderPresetsOptions } from '~/api-gen/@tanstack/react-query.gen'
import type { GetProviderPresetsResponse } from '~/api-gen/types.gen'

import type { ProviderPreset } from './provider-templates'
import { PROVIDER_PRESETS } from './provider-templates'

type ServerProviderPreset = GetProviderPresetsResponse[number]

function toUiPreset(preset: ServerProviderPreset): ProviderPreset {
  const fields: ProviderPreset['fields'] = [
    { key: 'baseUrl', label: 'Endpoint', type: 'url', placeholder: preset.baseUrl, mono: true },
  ]
  if (preset.requiresApiKey) {
    fields.push({ key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-...', mono: true })
  }
  const authMethods = preset.authMethods?.length
    ? preset.authMethods
    : [{ id: 'apiKey', label: 'API Key' }]
  const endpointProfiles = preset.endpointProfiles?.length
    ? preset.endpointProfiles
    : [{
        id: 'openai',
        label: 'Endpoint',
        wireKind: preset.providerKind,
        defaultBaseUrl: preset.baseUrl,
      }]
  return {
    id: preset.id,
    name: preset.name,
    tagline: preset.local ? 'Runs on your machine' : preset.baseUrl,
    description: preset.models.length > 0 ? `${preset.models.length} known models` : undefined,
    providerKind: preset.providerKind,
    accent: '',
    fields,
    defaults: {
      baseUrl: preset.baseUrl,
      ...(endpointProfiles.find(p => p.id === 'openai')?.defaultBaseUrl
        ? { openaiBaseUrl: endpointProfiles.find(p => p.id === 'openai')!.defaultBaseUrl }
        : {}),
      ...(endpointProfiles.find(p => p.id === 'anthropic')?.defaultBaseUrl
        ? { anthropicBaseUrl: endpointProfiles.find(p => p.id === 'anthropic')!.defaultBaseUrl }
        : {}),
    },
    iconSlug: preset.iconSlug,
    models: preset.models,
    providerId: preset.providerId ?? preset.id,
    tier: preset.tier ?? 'generic',
    authMethods,
    endpointProfiles,
    featured: preset.featured,
  }
}

/**
 * Merges the server-side provider catalog (`GET /provider-presets`) with the
 * three local wizard presets. Local presets keep their richer taglines and
 * auth flows while loading; server presets contribute baseUrl, authMethods,
 * endpointProfiles, and known model lists.
 */
export function useMergedProviderPresets(): { presets: ProviderPreset[], isLoading: boolean } {
  const query = useQuery(getProviderPresetsOptions())

  const presets = useMemo(() => {
    const serverPresets = query.data ?? []
    if (serverPresets.length === 0) {
      return PROVIDER_PRESETS
    }
    const localById = new Set(PROVIDER_PRESETS.map(p => p.id))
    const featuredLocal = PROVIDER_PRESETS.map((local) => {
      const remote = serverPresets.find(p => p.id === local.id)
      return remote
        ? {
            ...local,
            ...toUiPreset(remote),
            tagline: local.tagline,
            accent: local.accent,
            fields: local.fields,
          }
        : local
    })
    const rest = serverPresets
      .filter(p => !localById.has(p.id))
      .sort((a, b) => {
        if ((a.tier === 'first-class') !== (b.tier === 'first-class')) {
          return a.tier === 'first-class' ? -1 : 1
        }
        if ((a.source === 'overlay' || a.source === 'builtin') !== (b.source === 'overlay' || b.source === 'builtin')) {
          return (a.source === 'overlay' || a.source === 'builtin') ? -1 : 1
        }
        return a.name.localeCompare(b.name)
      })
      .map(toUiPreset)
    return [...featuredLocal, ...rest]
  }, [query.data])

  return { presets, isLoading: query.isLoading }
}
