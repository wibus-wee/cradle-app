import type { ProviderTarget } from '@cradle/db'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { getProviderContribution } from '../provider-catalog/provider-registry'
import type { ModelCapabilities, ProviderKind } from '../provider-contracts/types'
import * as ProviderTargets from '../provider-targets/service'

// ── types ──

export interface UpsertProfileInput {
  id: string
  name: string
  providerKind: ProviderKind
  enabled: boolean
  configJson: string
  credentialRef: string | null
  iconSlug?: string | null
  providerId?: string | null
}

export interface AgentProfile {
  id: string
  name: string
  providerKind: ProviderKind
  enabled: boolean
  configJson: string
  credentialRef: string | null
  customModels: string
  iconSlug: string | null
  providerId: string | null
  createdAt: number
  updatedAt: number
}

function toProfile(target: ProviderTarget): AgentProfile {
  return {
    id: target.id,
    name: target.displayName,
    providerKind: target.providerKind,
    enabled: target.enabled,
    configJson: target.connectionConfigJson,
    credentialRef: target.credentialRef,
    customModels: target.customModelsJson,
    iconSlug: target.iconSlug,
    providerId: target.providerId ?? null,
    createdAt: target.createdAt,
    updatedAt: target.updatedAt,
  }
}

// ── public API ──

const ModelCapabilitiesSchema = z.object({
  contextWindow: z.number().optional(),
  maxOutput: z.number().optional(),
  inputModalities: z.array(z.string()).optional(),
  outputModalities: z.array(z.string()).optional(),
  reasoning: z.boolean().optional(),
  reasoningEfforts: z.array(z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])).optional(),
  toolCall: z.boolean().optional(),
  temperature: z.boolean().optional(),
  structuredOutput: z.boolean().optional(),
  cost: z.object({
    input: z.number().optional(),
    output: z.number().optional(),
    cacheRead: z.number().optional(),
    cacheWrite: z.number().optional(),
  }).optional(),
  family: z.string().optional(),
  knowledgeCutoff: z.string().optional(),
  releaseDate: z.string().optional(),
  registryMatch: z.enum(['exact', 'fuzzy', 'manual', 'alias', 'unmatched']).optional(),
  registryModelId: z.string().optional(),
  registryModelLabel: z.string().optional(),
})

const CustomModelInputSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  capabilities: ModelCapabilitiesSchema.default({}),
})

export function listProfiles(): AgentProfile[] {
  return ProviderTargets.listStoredProviderTargets()
    .filter(target => target.kind === 'manual')
    .toSorted((a, b) => a.displayName.localeCompare(b.displayName))
    .map(toProfile)
}

export function getProfile(id: string): AgentProfile | null {
  const target = ProviderTargets.getProviderTarget(id)
  return target?.kind === 'manual' ? toProfile(target) : null
}

function assertManualProfileOperation(profileId: string): void {
  const existing = ProviderTargets.getProviderTarget(profileId)
  if (!existing || existing.kind === 'manual') {
    return
  }

  throw new AppError({
    code: 'invalid_profile_input',
    status: 400,
    message: 'External provider targets cannot be changed through profile routes',
    details: { profileId },
  })
}

export async function upsertProfile(input: UpsertProfileInput): Promise<AgentProfile> {
  assertManualProfileOperation(input.id)
  return toProfile(await ProviderTargets.upsertManualProviderTarget({
    id: input.id,
    displayName: input.name,
    providerKind: input.providerKind,
    enabled: input.enabled,
    connectionConfigJson: input.configJson,
    credentialRef: input.credentialRef,
    iconSlug: input.iconSlug,
    providerId: input.providerId,
  }))
}

/**
 * Explicitly bind a manual profile to a Provider contribution id.
 * Never infers identity from baseUrl. Optional applyEndpointDefaults rewrites
 * connection URLs from the contribution defaults when the client opts in.
 */
export async function bindProfileProvider(
  profileId: string,
  input: { providerId: string, applyEndpointDefaults?: boolean },
): Promise<AgentProfile> {
  assertManualProfileOperation(profileId)
  const existing = getProfile(profileId)
  if (!existing) {
    throw new AppError({
      code: 'profile_not_found',
      status: 404,
      message: 'Profile not found',
      details: { profileId },
    })
  }
  const providerId = input.providerId.trim()
  if (!providerId) {
    throw new AppError({
      code: 'invalid_profile_input',
      status: 400,
      message: 'providerId is required',
    })
  }

  const contribution = getProviderContribution(providerId)
  if (!contribution) {
    throw new AppError({
      code: 'invalid_profile_input',
      status: 400,
      message: `Unknown providerId: ${providerId}`,
      details: { providerId },
    })
  }

  let configJson = existing.configJson
  let providerKind = existing.providerKind
  if (input.applyEndpointDefaults) {
    providerKind = contribution.defaultWireKind
    const config = JSON.parse(existing.configJson) as Record<string, unknown>
    if (contribution.defaultWireKind === 'universal') {
      const openai = contribution.endpointProfiles.find(p => p.id === 'openai')?.defaultBaseUrl ?? ''
      const anthropic = contribution.endpointProfiles.find(p => p.id === 'anthropic')?.defaultBaseUrl ?? ''
      configJson = JSON.stringify({
        ...config,
        openaiBaseUrl: openai,
        anthropicBaseUrl: anthropic,
        baseUrl: openai || anthropic || null,
      })
    }
    else {
      const baseUrl = contribution.endpointProfiles[0]?.defaultBaseUrl ?? ''
      configJson = JSON.stringify({
        ...config,
        baseUrl: baseUrl || null,
      })
    }
  }

  return await upsertProfile({
    id: profileId,
    name: existing.name,
    providerKind,
    enabled: existing.enabled,
    configJson,
    credentialRef: existing.credentialRef,
    iconSlug: existing.iconSlug,
    providerId,
  })
}

export function updateIcon(profileId: string, iconSlug: string | null): AgentProfile {
  assertManualProfileOperation(profileId)
  return toProfile(ProviderTargets.updateProviderTargetIcon(profileId, iconSlug))
}

export async function removeProfile(id: string): Promise<void> {
  assertManualProfileOperation(id)
  await ProviderTargets.removeProviderTarget(id)
}

// ── custom models ──

export interface CustomModelEntry {
  id: string
  label: string
  capabilities: ModelCapabilities
}

export async function updateCustomModels(
  profileId: string,
  models: Array<{ id: string, label?: string, capabilities?: ModelCapabilities }>,
): Promise<CustomModelEntry[]> {
  const parsedModels = z.array(CustomModelInputSchema).parse(models)
  if (!getProfile(profileId)) {
    throw new AppError({
      code: 'profile_not_found',
      status: 404,
      message: 'Profile not found',
      details: { profileId },
    })
  }
  return ProviderTargets.updateProviderTargetCustomModels(profileId, parsedModels)
}
