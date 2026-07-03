import { runtimeAuditLog } from '@cradle/db'
import { z } from 'zod'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import { enrichModelsFromRegistryMappings } from '../model-registry/model-info-registry'
import * as ModelRegistry from '../model-registry/service'
import { listRuntimeOwnedProviderTargetModels } from '../provider-contracts/runtime-compatibility'
import type { ModelDescriptor, ProviderKind, ProviderRequest } from '../provider-contracts/types'
import type { ResolvedProviderTarget } from '../provider-targets/service'
import { resolveProviderTarget } from '../provider-targets/service'
import * as Secrets from '../secrets/service'
import * as Workspace from '../workspace/service'
import { getProviderCatalog } from './catalog'
import { projectProviderModelListCapabilities } from './model-capabilities'

// ── provider body parsing ──

const NullableProviderRefSchema = z
  .string()
  .trim()
  .min(1)
  .nullish()
  .transform((value) => {
    if (value === undefined || value === null) {
      return null
    }
    return value
  })

export const ProviderRequestSchema = z
  .object({
    providerKind: z.enum(['openai-compatible', 'anthropic', 'universal']),
    label: z.string().min(1),
    config: z.record(z.string(), z.unknown()),
    secretRef: NullableProviderRefSchema,
    profileId: NullableProviderRefSchema,
    providerTargetKind: z.enum(['manual', 'external']).nullable().optional(),
    providerTargetId: NullableProviderRefSchema,
    workspaceId: NullableProviderRefSchema,
  })
  .transform(parsed => ({
    providerKind: parsed.providerKind,
    label: parsed.label,
    configJson: JSON.stringify(parsed.config),
    secretRef: parsed.secretRef,
    profileId: parsed.profileId,
    providerTargetKind: parsed.providerTargetKind ?? null,
    providerTargetId: parsed.providerTargetId,
    workspaceId: parsed.workspaceId,
    sourceApp: null,
  }))

const CustomModelSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
  })
  .transform(model => ({
    ...model,
    capabilities: {},
  }))

const CustomModelsJsonSchema = z
  .string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.array(CustomModelSchema))

const DefaultModelConfigJsonSchema = z
  .string()
  .transform(raw => JSON.parse(raw))
  .pipe(z.object({
    model: z.string().trim().min(1).optional(),
  }).passthrough())

const RuntimeAuditProfileInputSchema = z.object({
  profileId: z.string().nullable().default(null),
  providerTargetKind: z.enum(['manual', 'external']).nullable().default(null),
  providerTargetId: z.string().nullable().default(null),
})

function requestedProviderTarget(
  input: Pick<ProviderRequest, 'providerTargetKind' | 'providerTargetId' | 'profileId'>,
) {
  if (input.providerTargetId) {
    return {
      id: input.providerTargetId,
      ...(input.providerTargetKind ? { kind: input.providerTargetKind } : {}),
    }
  }
  return input.profileId ? { id: input.profileId, kind: 'manual' as const } : null
}

function resolveEffectiveProviderRequest(input: ProviderRequest) {
  const target = requestedProviderTarget(input)
  if (!target) {
    return {
      target: null,
      resolved: null,
      request: input,
    }
  }

  const resolved = resolveProviderTarget(target)
  return {
    target,
    resolved,
    request: {
      providerKind: resolved.providerKind,
      label: resolved.label,
      configJson: resolved.configJson,
      secretRef: resolved.credentialRef,
      profileId: resolved.id,
      providerTargetKind: resolved.target.kind,
      providerTargetId: resolved.target.id,
      sourceApp: resolved.sourceMetadata?.app ?? null,
    } satisfies ProviderRequest,
  }
}

// ── list models ──

export async function listModels(input: ProviderRequest & { workspaceId?: string | null }): Promise<ModelDescriptor[]> {
  const workspacePath = input.workspaceId ? Workspace.getLocalWorkspacePath(input.workspaceId) ?? undefined : undefined
  const runtimeOwnedModels = await listRuntimeOwnedProviderTargetModels({
    providerTargetId: input.providerTargetId,
    workspacePath,
  })
  if (runtimeOwnedModels) {
    return projectProviderModelListCapabilities(runtimeOwnedModels.map(model => ({
      id: model.id,
      label: model.label,
      providerKind: model.providerKind,
      capabilities: model.capabilities,
    })))
  }

  const effective = resolveEffectiveProviderRequest(input)
  const provider = requireProvider(effective.request.providerKind)

  let models: ModelDescriptor[] = []
  try {
    models = await provider.listModels(effective.request, {
      readSecret: secretRef => Secrets.readSecret(secretRef),
      updateSecretValue: (secretRef, secret) => Secrets.updateSecretValue(secretRef, secret),
    })
    recordModelList({
      profileId: effective.request.profileId,
      providerTargetKind: effective.resolved?.kind ?? null,
      providerTargetId: effective.target?.id ?? null,
      providerKind: effective.request.providerKind,
      subject: effective.request.label,
      count: models.length,
    })
  }
 catch (error) {
    if (!effective.resolved) {
      throw mapOperationalError(error)
    }
    if (!hasCustomModels(effective.resolved.customModelsJson)) {
      const defaultModels = defaultModelsForProviderListFailure(effective.resolved, effective.request.providerKind, error)
      if (defaultModels) {
        models = defaultModels
      }
      else {
        throw mapOperationalError(error)
      }
    }
  }

  if (effective.resolved?.customModelsJson) {
    const customModels = CustomModelsJsonSchema.parse(effective.resolved.customModelsJson)
    const upstreamIds = new Set(models.map(m => m.id))
    for (const cm of customModels) {
      if (!upstreamIds.has(cm.id)) {
        models.push({
          id: cm.id,
          label: cm.label,
          providerKind: effective.request.providerKind,
          capabilities: cm.capabilities,
        })
      }
    }
  }

  models = await enrichModelsFromRegistryMappings(models, ModelRegistry.listMappingEntries())

  return projectProviderModelListCapabilities(models)
}

// ── audit persistence (merged from store) ──

function recordModelList(input: {
  profileId?: string | null
  providerTargetKind?: 'manual' | 'external' | null
  providerTargetId?: string | null
  providerKind: ProviderKind
  subject: string
  count: number
}): void {
  const auditInput = RuntimeAuditProfileInputSchema.parse(input)
  db()
    .insert(runtimeAuditLog)
    .values({
      providerTargetId: auditInput.providerTargetId,
      providerKind: input.providerKind,
      action: 'listModels',
      subject: input.subject,
      details: JSON.stringify({ count: input.count }),
    })
    .run()
}

// ── helpers ──

function requireProvider(providerKind: ProviderKind) {
  const catalog = getProviderCatalog()
  const provider = catalog.get(providerKind)
  if (!provider) {
    throw new AppError({
      code: 'provider_not_available',
      status: 501,
      message: `Provider is not available: ${providerKind}`,
      details: { providerKind },
    })
  }
  return provider
}

function hasCustomModels(customModelsJson: string | null | undefined): boolean {
  if (!customModelsJson) {
    return false
  }
  const parsed = CustomModelsJsonSchema.safeParse(customModelsJson)
  return parsed.success && parsed.data.length > 0
}

function defaultModelsForProviderListFailure(
  target: ResolvedProviderTarget,
  providerKind: ProviderKind,
  error: unknown,
): ModelDescriptor[] | null {
  if (!canUseTargetModelFallback(error)) {
    return null
  }
  const model = readDefaultModel(target.configJson) ?? readDefaultModel(target.connectionConfigJson)
  return model
    ? [{
        id: model,
        label: model,
        providerKind,
        capabilities: {},
      }]
    : null
}

function canUseTargetModelFallback(error: unknown): boolean {
  return !(error instanceof AppError) || error.status >= 500
}

function readDefaultModel(configJson: string): string | null {
  const parsed = DefaultModelConfigJsonSchema.safeParse(configJson)
  return parsed.success ? parsed.data.model ?? null : null
}

function mapOperationalError(error: unknown): Error {
  if (error instanceof AppError) {
    return error
  }
  const message = error instanceof Error ? error.message : String(error)
  if (message === 'CRADLE_CREDENTIAL_SECRET is not configured') {
    return new AppError({
      code: 'secret_not_configured',
      status: 500,
      message: 'CRADLE_CREDENTIAL_SECRET is required to manage secrets',
    })
  }
  return error instanceof Error ? error : new Error(message)
}
