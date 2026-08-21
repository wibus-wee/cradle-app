/**
 * Provider Preset Catalog
 *
 * Merges the public models.dev registry (provider-level `api` and `doc`
 * plus per-model metadata) with the curated local overlay, then projects each
 * row through the Provider setup contribution registry. Auth methods and
 * endpoint profiles always come from contributions — never from WireShape alone.
 */

import type { ModelsDevModel, ModelsDevProvider } from '../model-registry/model-info-registry'
import { fetchModelsDevData } from '../model-registry/model-info-registry'
import type { ProviderKind } from '../provider-contracts/types'
import type { ProviderPresetOverlayEntry } from './provider-preset-overlay'
import { PROVIDER_PRESET_OVERLAY } from './provider-preset-overlay'
import {
  buildGenericContribution,
  getProviderContribution,
  listFirstClassContributions,
} from './provider-registry'

export interface ProviderPresetModel {
  id: string
  name?: string
  reasoning?: boolean
  toolCall?: boolean
  vision?: boolean
}

export interface ProviderPresetAuthMethod {
  id: string
  label: string
}

export interface ProviderPresetEndpointProfile {
  id: string
  label: string
  wireKind: ProviderKind
  defaultBaseUrl?: string
  optional?: boolean
}

export interface ProviderPreset {
  id: string
  name: string
  providerKind: ProviderKind
  baseUrl: string
  iconSlug?: string
  docsUrl?: string
  local: boolean
  requiresApiKey: boolean
  source: 'models.dev' | 'overlay' | 'builtin'
  providerId: string
  tier: 'first-class' | 'generic'
  featured?: boolean
  authMethods: ProviderPresetAuthMethod[]
  endpointProfiles: ProviderPresetEndpointProfile[]
  models: ProviderPresetModel[]
}

interface CatalogSeed {
  id: string
  name: string
  providerKind: ProviderKind
  baseUrl: string
  iconSlug?: string
  docsUrl?: string
  local: boolean
  requiresApiKey: boolean
  source: 'models.dev' | 'overlay'
  models: ProviderPresetModel[]
}

function projectModel(id: string, model: ModelsDevModel | undefined): ProviderPresetModel {
  if (!model) {
    return { id }
  }
  return {
    id,
    ...(model.name ? { name: model.name } : {}),
    ...(model.reasoning === true ? { reasoning: true } : {}),
    ...(model.tool_call === true ? { toolCall: true } : {}),
    ...(model.modalities?.input?.includes('image') ? { vision: true } : {}),
  }
}

function hostMatches(hostname: string, candidates: string[]): boolean {
  return candidates.some(candidate => hostname === candidate || hostname.endsWith(`.${candidate}`))
}

function apiHostname(provider: ModelsDevProvider): string | null {
  if (typeof provider.api !== 'string' || provider.api.length === 0) {
    return null
  }
  try {
    return new URL(provider.api).hostname.toLowerCase()
  }
  catch {
    return null
  }
}

/**
 * Match an overlay entry to a models.dev provider by id first, then by the
 * hostname of the provider's `api` URL. A models.dev provider without `api`
 * (e.g. groq) can only be claimed by id.
 */
function findModelsDevProvider(
  data: Record<string, ModelsDevProvider> | null,
  overlay: ProviderPresetOverlayEntry,
): [string, ModelsDevProvider] | null {
  if (!data) {
    return null
  }
  const byId = data[overlay.id]
  if (byId) {
    return [overlay.id, byId]
  }
  for (const [id, provider] of Object.entries(data)) {
    const hostname = apiHostname(provider)
    if (hostname && hostMatches(hostname, overlay.hostnames)) {
      return [id, provider]
    }
  }
  return null
}

function buildOverlaySeed(
  overlay: ProviderPresetOverlayEntry,
  provider: ModelsDevProvider | undefined,
): CatalogSeed {
  const registryModels = provider?.models ?? {}
  // Presets describe how to connect. They must never transport the provider's
  // full models.dev inventory to clients: live inventory belongs to the
  // configured provider target and is fetched through its models endpoint.
  const models = (overlay.defaultModels ?? [])
    .map(id => projectModel(id, registryModels[id]))
  const docsUrl = overlay.docsUrl ?? provider?.doc
  return {
    id: overlay.id,
    name: overlay.name,
    providerKind: overlay.providerKind,
    baseUrl: overlay.baseUrl,
    ...(overlay.iconSlug ? { iconSlug: overlay.iconSlug } : {}),
    ...(docsUrl ? { docsUrl } : {}),
    local: overlay.local ?? false,
    requiresApiKey: overlay.requiresApiKey ?? true,
    source: 'overlay',
    models,
  }
}

function buildModelsDevSeed(id: string, provider: ModelsDevProvider): CatalogSeed {
  return {
    id,
    name: provider.name ?? id,
    // models.dev providers with an `api` URL are OpenAI-compatible unless they ship the Anthropic SDK.
    providerKind: provider.npm === '@ai-sdk/anthropic' ? 'anthropic' : 'openai-compatible',
    baseUrl: provider.api ?? '',
    ...(provider.doc ? { docsUrl: provider.doc } : {}),
    local: false,
    requiresApiKey: true,
    source: 'models.dev',
    // models.dev metadata remains owned by Model Registry. Provider presets do
    // not duplicate that inventory into the setup surface.
    models: [],
  }
}

function projectFromContribution(
  seed: CatalogSeed | null,
  contributionId: string,
): ProviderPreset | null {
  const contribution = getProviderContribution(contributionId)
    ?? (seed
      ? buildGenericContribution({
          id: seed.id,
          name: seed.name,
          baseUrl: seed.baseUrl,
          wireKind: seed.providerKind,
          ...(seed.iconSlug ? { iconSlug: seed.iconSlug } : {}),
          ...(seed.docsUrl ? { docsUrl: seed.docsUrl } : {}),
          ...(seed.local ? { local: true } : {}),
        })
      : null)
  if (!contribution) {
    return null
  }

  const endpointProfiles: ProviderPresetEndpointProfile[] = contribution.endpointProfiles.map(profile => ({
    id: profile.id,
    label: profile.label,
    wireKind: profile.wireKind,
    ...(profile.defaultBaseUrl !== undefined ? { defaultBaseUrl: profile.defaultBaseUrl } : {}),
    ...(profile.optional !== undefined ? { optional: profile.optional } : {}),
  }))
  const primaryBaseUrl = endpointProfiles.find(p => p.defaultBaseUrl)?.defaultBaseUrl
    ?? seed?.baseUrl
    ?? ''

  return {
    id: contribution.identity.id,
    name: seed?.name ?? contribution.identity.name,
    providerKind: contribution.defaultWireKind,
    baseUrl: primaryBaseUrl,
    ...(seed?.iconSlug ?? contribution.identity.iconSlug
      ? { iconSlug: seed?.iconSlug ?? contribution.identity.iconSlug }
      : {}),
    ...(seed?.docsUrl ?? contribution.identity.docsUrl
      ? { docsUrl: seed?.docsUrl ?? contribution.identity.docsUrl }
      : {}),
    local: seed?.local ?? contribution.identity.local ?? false,
    requiresApiKey: contribution.requiresApiKey ?? seed?.requiresApiKey ?? true,
    source: seed?.source ?? 'builtin',
    providerId: contribution.identity.id,
    tier: contribution.identity.tier,
    ...(contribution.identity.featured ? { featured: true } : {}),
    authMethods: contribution.authMethods.map(method => ({
      id: method.id,
      label: method.label,
    })),
    endpointProfiles,
    models: seed?.models ?? [],
  }
}

export async function collectProviderPresets(): Promise<ProviderPreset[]> {
  const data = await fetchModelsDevData()
  const seeds: CatalogSeed[] = []
  const consumedProviderIds = new Set<string>()

  for (const overlay of PROVIDER_PRESET_OVERLAY) {
    const match = findModelsDevProvider(data, overlay)
    if (match) {
      consumedProviderIds.add(match[0])
    }
    seeds.push(buildOverlaySeed(overlay, match?.[1]))
  }

  if (data) {
    const remaining = Object.entries(data)
      .filter(([id, provider]) => !consumedProviderIds.has(id) && apiHostname(provider) !== null)
      .sort((a, b) => (a[1].name ?? a[0]).localeCompare(b[1].name ?? b[0]))
    for (const [id, provider] of remaining) {
      seeds.push(buildModelsDevSeed(id, provider))
    }
  }

  const byId = new Map<string, ProviderPreset>()
  for (const seed of seeds) {
    const projected = projectFromContribution(seed, seed.id)
    if (projected) {
      byId.set(projected.id, projected)
    }
  }

  // Featured / first-class contributions that are not overlay/models.dev rows
  // (openai, anthropic, universal) still appear in the gallery.
  for (const contribution of listFirstClassContributions()) {
    if (byId.has(contribution.identity.id)) {
      continue
    }
    const projected = projectFromContribution(null, contribution.identity.id)
    if (projected) {
      byId.set(projected.id, projected)
    }
  }

  return [...byId.values()].toSorted((a, b) => {
    const af = a.featured ? 0 : 1
    const bf = b.featured ? 0 : 1
    if (af !== bf) {
      return af - bf
    }
    if ((a.tier === 'first-class') !== (b.tier === 'first-class')) {
      return a.tier === 'first-class' ? -1 : 1
    }
    return a.name.localeCompare(b.name)
  })
}
